import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { onDocumentWritten } from 'firebase-functions/v2/firestore'
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import { defineSecret } from 'firebase-functions/params'
import { setGlobalOptions } from 'firebase-functions/v2/options'
import { logger } from 'firebase-functions'

import { requireAdmin, requirePatient, requireStaff, requireString } from './lib/auth'
import { CODE_LENGTH, formatCodeForPrint, generateCode, hashCode, newPatientUid } from './lib/codes'
import { auth, COLLECTIONS, db, docToOccurrence } from './lib/firestore'
import { generationWindow, regenerateActivity, regenerateAll } from './lib/occurrences'
import { assertNotRateLimited, clearFailures, recordFailure } from './lib/rateLimit'
import {
  appointmentConflictsFor,
  busyBetween,
  conflictsFor,
  myRegistrationsFor,
  promoteTx,
  registerTx,
  rosterFor,
  unregisterTx,
} from './lib/registration'
import { patientConflictNotice, type BusyEntry } from './domain/conflicts'
import { agendaWeek, suggestSlot } from './domain/agenda'
import { attendanceRefusal, canMarkAttendance } from './domain/attendance'
import {
  AUTO_DURATION_MIN,
  AUTO_HORIZON_DAYS,
  autoAcceptMessage,
  findFirstSlot,
  type BusySlot,
} from './domain/autoAccept'
import {
  addLocalDays,
  addMinutes,
  formatFullWhen,
  instantOf,
  localTimeOf,
  todayLocalDate,
} from './domain/time'
import {
  planActivityRemoval,
  planForcedRemoval,
  planRemoval,
  type CatalogKind,
} from './domain/catalog'
import type { AvailabilityWindow, LocalDate } from './domain/types'

/**
 * Bruxelles : les fonctions vivent au plus près des données et des utilisateurs.
 *
 * `maxInstances` est délibérément bas. Chaque instance réserve un CPU, et le quota de
 * CPU par région d'un projet neuf se compte en dizaines : dix-huit fonctions à dix
 * instances en réclameraient cent quatre-vingts, et une partie d'entre elles échoue
 * alors à se créer. Trois suffisent très largement — un hôpital de 133 lits, c'est
 * quelques dizaines d'appels par jour, jamais simultanés.
 */
/*
  Où tournent les fonctions, et combien de demandes une même instance sert à la fois.

  C'est ce dernier point qui décidait de la lenteur, et il était invisible. Sans processeur
  entier, une instance de fonction ne traite **qu'une demande à la fois** : c'est la règle
  de Cloud Run, et la mémoire par défaut donne un peu plus d'un demi-processeur. En
  réunion, où l'on clique dix prénoms à la suite, les dix appels partaient ensemble — donc
  vers dix instances, dont neuf devaient démarrer. Un démarrage prend plusieurs secondes.

  D'où les deux secondes par clic, les appuis qui « ne marchent pas » et qu'on répète, et
  l'appel de réveil qui ne servait presque à rien : il réveillait une instance, la
  deuxième demande en réclamait une autre, froide.

  Un processeur entier, et vingt demandes servies de front : la même instance, déjà
  chaude, absorbe toute la réunion. On paie le temps de calcul, pas l'attente — une
  instance au repos ne coûte rien — et vingt clics partagent désormais une seconde
  d'instance au lieu d'en réserver vingt. Cela reste très en dessous du gratuit.
*/
setGlobalOptions({
  region: 'europe-west1',
  maxInstances: 3,
  memory: '512MiB',
  cpu: 1,
  concurrency: 20,
})

/**
 * Le poivre qui dérive les empreintes des codes patients. Un secret n'est pas
 * automatiquement lisible : il faut le déclarer sur chaque fonction qui en a besoin,
 * sans quoi `process.env.CODE_PEPPER` reste vide et la dérivation échoue. On ne le
 * monte que sur les trois fonctions qui touchent aux codes — nulle part ailleurs.
 */
const CODE_PEPPER = defineSecret('CODE_PEPPER')

const DEFAULT_RETENTION_DAYS = 90
const DEFAULT_CODE_VALIDITY_DAYS = 60

async function readConfig<T>(field: string, fallback: T): Promise<T> {
  const snapshot = await db().collection(COLLECTIONS.config).doc('app').get()
  const value = snapshot.data()?.[field]
  return (value as T) ?? fallback
}

// ---------------------------------------------------------------------------
// Génération des occurrences
// ---------------------------------------------------------------------------

/**
 * Une activité change : ses occurrences sont recalculées sur la fenêtre glissante.
 * `mergeOccurrences` protège les exceptions saisies par les soignants et n'efface
 * jamais une occurrence portant des inscriptions.
 *
 * Le déclencheur passe par Eventarc. Sur certaines machines de développement, l'émulateur
 * n'arrive pas à l'enregistrer et refuse alors de démarrer ; `LEUZE_NO_FIRESTORE_TRIGGER=1`
 * permet de lancer les émulateurs sans lui. La régénération reste disponible par l'appel
 * `regenerateSeries`, et la variable n'est jamais définie en production.
 */
export const onActivityWritten =
  process.env.LEUZE_NO_FIRESTORE_TRIGGER === '1'
    ? undefined
    : onDocumentWritten('activities/{activityId}', async (event) => {
        const activityId = event.params.activityId
        const report = await regenerateActivity(db(), activityId)
        logger.info('Occurrences régénérées', { activityId, ...report })
      })

/** Chaque nuit : la fenêtre de 12 semaines est repoussée d'un jour. */
export const extendOccurrenceWindow = onSchedule(
  { schedule: '0 3 * * *', timeZone: 'Europe/Brussels' },
  async () => {
    const report = await regenerateAll(db())
    logger.info('Fenêtre de génération repoussée', { ...generationWindow(), ...report })
  },
)

/**
 * Régénération forcée après une modification « cette occurrence et les suivantes » :
 * à partir de la date indiquée, les exceptions saisies sont écrasées.
 */
export const regenerateSeries = onCall(async (request: CallableRequest) => {
  requireStaff(request)
  const activityId = requireString(request.data?.activityId, 'activityId')
  const overrideFrom = request.data?.overrideFrom as LocalDate | undefined
  return regenerateActivity(db(), activityId, overrideFrom ? { overrideFrom } : {})
})

// ---------------------------------------------------------------------------
// Inscriptions — toujours dans une transaction
// ---------------------------------------------------------------------------

export const register = onCall(async (request: CallableRequest) => {
  const patient = requirePatient(request)

  // Réveil : voir `staffRegister`. La fiche d'activité le demande en s'affichant — on la
  // lit bien avant d'appuyer sur « Je m'inscris », et le bouton ne paie plus le démarrage.
  if (request.data?.warm === true) return { ok: true, warmed: true }

  const occurrenceId = requireString(request.data?.occurrenceId, 'occurrenceId')

  /*
    Un rendez-vous déjà fixé interdit de s'inscrire par-dessus : quelqu'un a bloqué du
    temps pour cette personne, et c'est le rendez-vous qui sauterait. Une autre activité
    au même moment ne bloque pas — on arrive parfois en retard, et personne n'en fait un
    drame — mais elle est dite.

    Le contrôle vit ici et non dans la transaction : il lit d'autres documents que ceux
    qu'elle verrouille, et une transaction qui lit trop finit par échouer sous la
    concurrence. Le risque assumé est mince : deux écritures simultanées pourraient créer
    un chevauchement, ce qu'un soignant corrigera d'un geste.
  */
  const avis = patientConflictNotice(await conflictsFor(db(), patient.uid, occurrenceId))
  if (avis !== null && avis.blocking) {
    return { ok: false, reason: 'conflict', message: avis.message }
  }

  const resultat = await registerTx(db(), {
    occurrenceId,
    patientUid: patient.uid,
    by: 'patient',
    serviceId: patient.serviceId,
  })
  // L'avertissement voyage avec le succès : l'inscription est prise, et la personne sait
  // qu'elle a deux choses en même temps.
  return avis !== null && resultat.ok ? { ...resultat, warning: avis.message } : resultat
})

export const unregister = onCall(async (request: CallableRequest) => {
  const patient = requirePatient(request)
  // Réveil : voir `register`. La fiche d'activité réveille les deux — on peut l'ouvrir
  // pour s'inscrire comme pour se désinscrire.
  if (request.data?.warm === true) return { ok: true, warmed: true }
  const occurrenceId = requireString(request.data?.occurrenceId, 'occurrenceId')
  return unregisterTx(db(), { occurrenceId, patientUid: patient.uid })
})

/** Les inscriptions du patient connecté, avec sa position en liste d'attente. */
export const myRegistrations = onCall(async (request: CallableRequest) => {
  const patient = requirePatient(request)
  return { registrations: await myRegistrationsFor(db(), patient.uid) }
})

/** Le soignant inscrit quelqu'un à sa place — un patient sans borne, une demande orale. */
/**
 * Inscription prise par un soignant. Il peut assumer un dépassement du nombre de places —
 * l'équipe décide parfois qu'on peut être neuf pour huit, elle connaît la salle et le
 * groupe. L'écran le lui a demandé avant d'en arriver là.
 */
export const staffRegister = onCall(async (request: CallableRequest) => {
  requireStaff(request)

  /*
    Réveil.

    Une fonction qui n'a pas servi depuis un quart d'heure s'arrête ; le premier appel
    suivant paie le démarrage — quelques secondes, pendant lesquelles l'écran semble mort.
    En réunion, ce premier appel tombe toujours au pire moment : le premier prénom.

    L'écran envoie donc un appel vide en s'ouvrant, pendant qu'on lit la liste. Il ne fait
    rien, il ne touche à rien, il ne coûte qu'une invocation — et le clic qui suit trouve
    la fonction debout.
  */
  if (request.data?.warm === true) return { ok: true, warmed: true }

  const occurrenceId = requireString(request.data?.occurrenceId, 'occurrenceId')
  const patientUid = requireString(request.data?.patientUid, 'patientUid')
  const overCapacity = request.data?.overCapacity === true
  const overrideConflict = request.data?.overrideConflict === true

  /*
    Rien n'est interdit au soignant : il connaît la situation, il peut déplacer le
    rendez-vous. Mais il doit le savoir avant d'inscrire, pas le découvrir le jour même.
    L'écran le lui demande, puis renvoie la même demande avec `overrideConflict`.

    Seuls les rendez-vous arrêtent le geste. On avait d'abord fait s'arrêter l'application
    sur n'importe quel chevauchement — y compris deux activités qui se recouvrent d'un
    quart d'heure, ce qui est le cas courant d'un programme chargé. En réunion, cela
    donnait une question à chaque prénom, et une réunion qui n'avance plus. Deux activités
    en même temps, on le voit sur la feuille et l'on s'arrange ; un rendez-vous, non.
  */
  if (!overrideConflict) {
    const conflits = await appointmentConflictsFor(db(), patientUid, occurrenceId)
    if (conflits.length > 0) {
      return {
        ok: false,
        reason: 'conflict',
        message: 'Cette personne a déjà quelque chose à ce moment-là.',
        conflicts: conflits.map((c) => ({
          label: c.label,
          kind: c.kind,
          start: c.start.toISOString(),
          end: c.end.toISOString(),
        })),
      }
    }
  }

  return registerTx(db(), { occurrenceId, patientUid, by: 'staff', overCapacity })
})

export const staffUnregister = onCall(async (request: CallableRequest) => {
  requireStaff(request)
  const occurrenceId = requireString(request.data?.occurrenceId, 'occurrenceId')
  const patientUid = requireString(request.data?.patientUid, 'patientUid')
  return unregisterTx(db(), { occurrenceId, patientUid })
})

export const staffPromote = onCall(async (request: CallableRequest) => {
  requireStaff(request)
  const occurrenceId = requireString(request.data?.occurrenceId, 'occurrenceId')
  const patientUid = requireString(request.data?.patientUid, 'patientUid')
  return promoteTx(db(), { occurrenceId, patientUid })
})

/**
 * Les plannings de la semaine, pour tout un service : un par personne.
 *
 * C'est ce qu'on imprime à la fin de la réunion du lundi, pour que chacun reparte avec
 * sa feuille. Les personnes sans aucune inscription en reçoivent une aussi : une grille
 * vide se remplit à la main, et c'est mieux que rien du tout.
 *
 * Les rendez-vous individuels n'y figurent pas. Une pile de feuilles imprimée d'un coup
 * passe de main en main : y écrire « rendez-vous avec le psychiatre » reviendrait à le
 * dire à qui trie la pile. Chacun retrouve les siens sur son propre écran.
 */
export const staffWeekPlannings = onCall(async (request: CallableRequest) => {
  requireStaff(request)
  const from = requireString(request.data?.from, 'from', 10)
  const to = requireString(request.data?.to, 'to', 10)
  // Sans service : tout le monde. L'écran des patients s'en sert pour dire, d'un coup
  // d'œil, qui est en activité et qui est libre.
  const brut = request.data?.serviceId
  const serviceId = typeof brut === 'string' && brut.length > 0 ? brut : null

  const maintenant = Date.now()
  const collection = db().collection(COLLECTIONS.patients)
  /*
    Les personnes et les séances de la semaine ne dépendent pas les unes des autres :
    elles se lisent ensemble. On les attendait l'une après l'autre, et cet écran est
    celui qu'on ouvre à la fin de la réunion, quand tout le monde attend sa feuille.
  */
  const [patientsSnapshot, occurrences] = await Promise.all([
    serviceId === null ? collection.get() : collection.where('serviceId', '==', serviceId).get(),
    db()
      .collection(COLLECTIONS.occurrences)
      .where('localDate', '>=', from)
      .where('localDate', '<=', to)
      .get(),
  ])
  const patients = patientsSnapshot.docs
    .map((document) => {
      const data = document.data() as { firstName?: string; serviceId?: string; expiresAt?: Timestamp }
      return {
        patientUid: document.id,
        firstName: data.firstName ?? 'Prénom inconnu',
        serviceId: data.serviceId ?? '',
        // Un séjour terminé ne reçoit plus de feuille.
        expiresAtMs: data.expiresAt?.toMillis() ?? Number.MAX_SAFE_INTEGER,
      }
    })
    .filter((patient) => patient.expiresAtMs > maintenant)
  if (patients.length === 0) return { plannings: [] }

  // `in` accepte trente valeurs : on interroge par paquets — tous en même temps. Les
  // paquets s'attendaient les uns les autres, ce qui faisait dix allers-retours pour une
  // semaine chargée là où un seul suffit.
  const parPatient = new Map<string, Array<{ occurrenceId: string; status: 'confirmed' | 'waitlist' }>>()
  const identifiants = occurrences.docs.map((d) => d.id)
  const paquets: string[][] = []
  for (let i = 0; i < identifiants.length; i += 30) paquets.push(identifiants.slice(i, i + 30))
  const lots = await Promise.all(
    paquets.map((paquet) =>
      db().collection(COLLECTIONS.registrations).where('occurrenceId', 'in', paquet).get(),
    ),
  )
  for (const trouvees of lots) {
    for (const document of trouvees.docs) {
      const data = document.data() as { patientUid?: string; occurrenceId?: string; status?: string }
      if (data.status !== 'confirmed' && data.status !== 'waitlist') continue
      if (typeof data.patientUid !== 'string' || typeof data.occurrenceId !== 'string') continue
      const lignes = parPatient.get(data.patientUid) ?? []
      lignes.push({ occurrenceId: data.occurrenceId, status: data.status })
      parPatient.set(data.patientUid, lignes)
    }
  }

  return {
    plannings: patients
      .sort((a, b) => a.firstName.localeCompare(b.firstName, 'fr'))
      .map(({ expiresAtMs: _fin, ...patient }) => ({
        ...patient,
        lines: parPatient.get(patient.patientUid) ?? [],
      })),
  }
})

/**
 * Les patients, pour la réunion du lundi : prénom et service, rien d'autre.
 * `patients` n'est lisible par aucun client — cette fonction est le seul chemin.
 */
export const staffPatients = onCall(async (request: CallableRequest) => {
  requireStaff(request)
  const snapshot = await db().collection(COLLECTIONS.patients).get()
  const maintenant = Date.now()
  const patients = snapshot.docs
    .map((document) => {
      const data = document.data() as { firstName?: string; serviceId?: string; expiresAt?: Timestamp }
      return {
        uid: document.id,
        firstName: data.firstName ?? 'Prénom inconnu',
        serviceId: data.serviceId ?? '',
        expiresAtMs: data.expiresAt?.toMillis() ?? Number.MAX_SAFE_INTEGER,
      }
    })
    // Un séjour terminé ne doit plus apparaître dans la liste de la réunion.
    .filter((patient) => patient.expiresAtMs > maintenant)
    .map(({ expiresAtMs, ...patient }) => ({
      ...patient,
      expiresAt: new Date(expiresAtMs).toISOString(),
    }))
    .sort((a, b) => a.firstName.localeCompare(b.firstName, 'fr'))

  return { patients }
})

/** Liste des inscrits : jamais lisible par un patient, jamais servie sans être soignant. */
export const staffRoster = onCall(async (request: CallableRequest) => {
  const staff = requireStaff(request)
  const occurrenceId = requireString(request.data?.occurrenceId, 'occurrenceId')
  const snapshot = await db().collection(COLLECTIONS.occurrences).doc(occurrenceId).get()
  const occurrence = snapshot.data() as { facilitatorId?: string } | undefined
  // L'appel n'est renvoyé qu'à qui a le droit de le faire : voir `canMarkAttendance`.
  const peutFaireAppel = occurrence !== undefined && canMarkAttendance(staff, occurrence)
  // La séance vient d'être lue : on la passe, plutôt que de la relire aussitôt.
  return {
    lines: await rosterFor(db(), occurrenceId, peutFaireAppel, snapshot),
    canMarkAttendance: peutFaireAppel,
  }
})

/**
 * L'appel : noter qu'une personne était là, ou qu'elle n'y était pas.
 *
 * Se fait sur papier jusqu'ici. La personne qui anime l'activité coche, et elle seule —
 * un administrateur aussi, sans quoi une absence bloquerait la feuille.
 *
 * Quelqu'un qui se présente sans s'être inscrit est accepté d'un même geste : on
 * l'inscrit puis on le note présent. C'est le cas courant, pas l'exception.
 */
export const markAttendance = onCall(async (request: CallableRequest) => {
  const staff = requireStaff(request)
  // Réveil : voir `staffRegister`. L'écran de l'appel le demande en s'ouvrant, pendant
  // qu'on lit la liste des inscrits — la première case cochée ne paie plus le démarrage.
  if (request.data?.warm === true) return { ok: true, warmed: true }
  const occurrenceId = requireString(request.data?.occurrenceId, 'occurrenceId')
  const patientUid = requireString(request.data?.patientUid, 'patientUid')
  const valeur = request.data?.attendance
  if (valeur !== 'present' && valeur !== 'absent' && valeur !== null) {
    throw new HttpsError('invalid-argument', 'La présence doit être « present », « absent » ou vide.')
  }

  /*
    La séance et l'inscription de la personne partent ensemble : savoir qui anime et
    savoir si la personne est déjà inscrite sont deux questions indépendantes.

    Et l'on ne relit plus l'inscription qu'on vient de créer. La même requête était faite
    deux fois de suite — une fois pour savoir s'il fallait inscrire, une fois pour
    retrouver le document à noter — même quand la première l'avait déjà trouvé. Sur une
    feuille d'appel, ce geste se répète dix ou quinze fois d'affilée.
  */
  const [occurrenceSnapshot, existantes] = await Promise.all([
    db().collection(COLLECTIONS.occurrences).doc(occurrenceId).get(),
    db()
      .collection(COLLECTIONS.registrations)
      .where('occurrenceId', '==', occurrenceId)
      .where('patientUid', '==', patientUid)
      .get(),
  ])
  const occurrence = occurrenceSnapshot.data() as
    | { facilitatorId?: string; facilitator?: string }
    | undefined
  if (occurrence === undefined) throw new HttpsError('not-found', "Cette activité n'a pas été trouvée.")
  if (!canMarkAttendance(staff, occurrence)) {
    throw new HttpsError('permission-denied', attendanceRefusal(occurrence))
  }

  const active = existantes.docs.find((d) => d.data()['status'] !== 'cancelled')

  let cibleId = active?.id
  if (cibleId === undefined) {
    // Personne venue spontanément : on l'inscrit, puis on la note. L'inscription passe
    // par la transaction habituelle — la capacité et la liste d'attente s'appliquent.
    const resultat = await registerTx(db(), { occurrenceId, patientUid, by: 'staff', walkIn: true })
    if (!resultat.ok) return resultat
    cibleId = resultat.registrationId
  }

  await db().collection(COLLECTIONS.registrations).doc(cibleId).set(
    {
      attendance: valeur,
      attendanceBy: valeur === null ? null : staff.uid,
      attendanceAt: valeur === null ? null : FieldValue.serverTimestamp(),
    },
    { merge: true },
  )

  return { ok: true, message: valeur === 'present' ? 'Noté présent.' : valeur === 'absent' ? 'Noté absent.' : 'Réponse effacée.' }
})

// ---------------------------------------------------------------------------
// Codes patients
// ---------------------------------------------------------------------------

/**
 * L'administrateur crée un code pour un patient. Le code en clair n'est renvoyé qu'ici,
 * une seule fois, pour être imprimé ou recopié : il n'est stocké nulle part.
 *
 * Réservé à l'administrateur, comme tout ce qui touche à la liste des personnes : faire
 * entrer quelqu'un dans l'application relève de l'admission, pas du quotidien du service.
 */
export const createPatientCode = onCall({ secrets: [CODE_PEPPER] }, async (request: CallableRequest) => {
  const staff = requireAdmin(request)
  const firstName = requireString(request.data?.firstName, 'prénom', 60)
  const serviceId = requireString(request.data?.serviceId, 'service', 60)

  const serviceSnapshot = await db().collection(COLLECTIONS.services).doc(serviceId).get()
  if (!serviceSnapshot.exists) throw new HttpsError('not-found', "Ce service n'existe pas.")

  const validityDays = await readConfig('codeValidityDays', DEFAULT_CODE_VALIDITY_DAYS)
  const expiresAt = Timestamp.fromMillis(Date.now() + validityDays * 86_400_000)
  const uid = newPatientUid()
  const code = generateCode(CODE_LENGTH)

  const batch = db().batch()
  batch.set(db().collection(COLLECTIONS.patients).doc(uid), {
    firstName,
    serviceId,
    createdAt: FieldValue.serverTimestamp(),
    expiresAt,
  })
  batch.set(db().collection(COLLECTIONS.patientCodes).doc(hashCode(code)), {
    uid,
    expiresAt,
    createdAt: FieldValue.serverTimestamp(),
    createdBy: staff.uid,
  })
  await batch.commit()

  return { uid, code, printableCode: formatCodeForPrint(code), expiresAt: expiresAt.toDate().toISOString() }
})

/**
 * Nouveau code pour un patient existant : la feuille est perdue, l'identité ne change
 * pas. Les anciens codes cessent aussitôt de fonctionner.
 *
 * Réservé à l'administrateur, et pas seulement par symétrie : le code est affiché en
 * clair à qui le demande. Qui peut en délivrer un peut donc ouvrir la session de cette
 * personne et voir son programme à sa place.
 */
export const regeneratePatientCode = onCall({ secrets: [CODE_PEPPER] }, async (request: CallableRequest) => {
  const staff = requireAdmin(request)
  const uid = requireString(request.data?.patientUid, 'patientUid')

  const patientSnapshot = await db().collection(COLLECTIONS.patients).doc(uid).get()
  const patient = patientSnapshot.data() as { firstName?: string } | undefined
  if (patient === undefined) throw new HttpsError('not-found', "Cette personne n'existe pas.")

  const validityDays = await readConfig('codeValidityDays', DEFAULT_CODE_VALIDITY_DAYS)
  const expiresAt = Timestamp.fromMillis(Date.now() + validityDays * 86_400_000)
  const code = generateCode(CODE_LENGTH)

  const anciens = await db().collection(COLLECTIONS.patientCodes).where('uid', '==', uid).get()
  const batch = db().batch()
  anciens.docs.forEach((document) => batch.delete(document.ref))
  batch.set(db().collection(COLLECTIONS.patientCodes).doc(hashCode(code)), {
    uid,
    expiresAt,
    createdAt: FieldValue.serverTimestamp(),
    createdBy: staff.uid,
  })
  batch.update(db().collection(COLLECTIONS.patients).doc(uid), { expiresAt })
  await batch.commit()
  await auth().revokeRefreshTokens(uid).catch(() => undefined)

  return {
    uid,
    firstName: patient.firstName ?? '',
    code,
    printableCode: formatCodeForPrint(code),
    expiresAt: expiresAt.toDate().toISOString(),
  }
})

/**
 * Fin de séjour. Le code cesse de fonctionner et la personne sort des listes ; ses
 * inscriptions restent, la purge planifiée s'en chargera le moment venu.
 */
export const endPatientStay = onCall(async (request: CallableRequest) => {
  requireAdmin(request)
  const uid = requireString(request.data?.patientUid, 'patientUid')

  const codes = await db().collection(COLLECTIONS.patientCodes).where('uid', '==', uid).get()
  const batch = db().batch()
  codes.docs.forEach((document) => batch.delete(document.ref))
  batch.update(db().collection(COLLECTIONS.patients).doc(uid), { expiresAt: Timestamp.now() })
  await batch.commit()
  await auth().revokeRefreshTokens(uid).catch(() => undefined)

  return { ok: true, message: 'Le séjour est clôturé. Le code ne fonctionne plus.' }
})

/** Fin de séjour, code égaré : le code cesse de fonctionner, les inscriptions restent. */
export const revokePatientCode = onCall(async (request: CallableRequest) => {
  requireAdmin(request)
  const uid = requireString(request.data?.patientUid, 'patientUid')
  const codes = await db().collection(COLLECTIONS.patientCodes).where('uid', '==', uid).get()
  const batch = db().batch()
  codes.docs.forEach((document) => batch.delete(document.ref))
  await batch.commit()
  await auth().revokeRefreshTokens(uid).catch(() => undefined)
  return { revoked: codes.size }
})

/**
 * De quoi poser un rendez-vous sans rien deviner.
 *
 * Trois questions se posent en même temps au moment de fixer : quand cette personne
 * reçoit-elle, qu'a-t-elle déjà, et le patient est-il libre ? Y répondre depuis le
 * navigateur demanderait de lui donner les deux agendas — celui d'un collègue compris.
 * C'est donc le serveur qui les croise, et qui ne rend que ce qui sert : des heures, un
 * état libre ou pris, et un créneau proposé.
 *
 * Ce que chacun lit : l'administrateur voit les libellés — c'est lui qui répartit et qui
 * imprime. Un intervenant voit les siens, et pour le patient seulement « Occupé » : il
 * lui faut savoir quand, jamais quoi.
 */
export const appointmentPlanning = onCall(async (request: CallableRequest) => {
  const staff = requireStaff(request)
  const practitionerId = requireString(request.data?.practitionerId, 'practitionerId')
  const patientUid = typeof request.data?.patientUid === 'string' ? request.data.patientUid : null
  const preference = request.data?.preference
  const moment: 'matin' | 'apres-midi' | 'peu-importe' =
    preference === 'matin' || preference === 'apres-midi' ? preference : 'peu-importe'
  const durationMin = typeof request.data?.durationMin === 'number' ? request.data.durationMin : 30
  const depart = typeof request.data?.from === 'string' ? (request.data.from as LocalDate) : todayLocalDate()

  const fiche = await db().collection(COLLECTIONS.practitioners).doc(practitionerId).get()
  if (!fiche.exists) throw new HttpsError('not-found', "Cette personne n'a pas été trouvée.")
  const plages = Array.isArray(fiche.data()?.['availability'])
    ? (fiche.data()!['availability'] as AvailabilityWindow[])
    : []

  const jusque = addLocalDays(depart, 21)

  // L'agenda de l'intervenant : ses rendez-vous, et les activités qu'il anime.
  const [sesRendezVous, sesSeances] = await Promise.all([
    db()
      .collection(COLLECTIONS.appointments)
      .where('practitionerId', '==', practitionerId)
      .where('status', '==', 'scheduled')
      .where('localDate', '>=', depart)
      .where('localDate', '<=', jusque)
      .get(),
    db()
      .collection(COLLECTIONS.occurrences)
      .where('localDate', '>=', depart)
      .where('localDate', '<=', jusque)
      .get(),
  ])

  const sien = staff.role === 'admin' || staff.practitionerId === practitionerId
  const occupeIntervenant: BusyEntry[] = []
  for (const document of sesRendezVous.docs) {
    const data = document.data()
    const debut = data['start'] as Timestamp | undefined
    const fin = data['end'] as Timestamp | undefined
    if (debut === undefined || fin === undefined) continue
    occupeIntervenant.push({
      start: debut.toDate(),
      end: fin.toDate(),
      // Le motif d'un rendez-vous ne regarde que l'intéressé et l'administrateur.
      label: sien ? 'Rendez-vous' : 'Occupé',
      kind: 'appointment',
    })
  }
  for (const document of sesSeances.docs) {
    const occurrence = docToOccurrence(document)
    if (occurrence.facilitatorId !== practitionerId || occurrence.status === 'cancelled') continue
    occupeIntervenant.push({
      start: occurrence.start,
      end: occurrence.end,
      label: sien ? occurrence.title : 'Occupé',
      kind: 'activity',
    })
  }

  // Celui du patient : ce qu'il a, sans dire quoi à qui n'a pas à le savoir.
  const occupePatient: BusyEntry[] =
    patientUid === null
      ? []
      : (await busyBetween(db(), patientUid, depart, jusque)).map((entree) => ({
          ...entree,
          // Ce que fait un patient de sa journée ne regarde pas tout le personnel : on
          // dit quand il est pris, pas à quoi.
          label: staff.role === 'admin' ? entree.label : 'Occupé',
        }))

  const proposition = suggestSlot({
    windows: plages,
    practitionerBusy: occupeIntervenant,
    patientBusy: occupePatient,
    preference: moment,
    from: depart,
    horizonDays: 21,
    durationMin,
  })

  const jours: LocalDate[] = []
  for (let i = 0; i < 7; i += 1) jours.push(addLocalDays(depart, i))
  const semaine = agendaWeek(jours, plages, [...occupeIntervenant, ...occupePatient], durationMin)

  return {
    availability: plages,
    week: semaine.map((jour) => ({
      localDate: jour.localDate,
      windows: jour.windows,
      free: jour.free,
      taken: jour.taken.map((t) => ({
        label: t.label,
        kind: t.kind,
        start: t.start.toISOString(),
        end: t.end.toISOString(),
      })),
    })),
    suggestion: proposition,
  }
})

/**
 * La demande de rendez-vous d'un patient — et, quand la personne concernée l'a voulu,
 * sa mise à l'agenda immédiate.
 *
 * La demande ne pouvait pas rester une écriture du navigateur : décider s'il existe une
 * place libre suppose de lire l'agenda d'un intervenant, ce qu'un patient ne verra
 * jamais. La décision se prend donc ici, sur le serveur, et le patient reçoit une
 * réponse tout de suite au lieu d'attendre sans savoir.
 *
 * Sans acceptation automatique, rien ne change pour personne : la demande rejoint la
 * file, comme avant.
 */
export const requestAppointment = onCall(async (request: CallableRequest) => {
  const patient = requirePatient(request)
  // Réveil : voir `register`. L'écran des rendez-vous le demande en s'affichant — on
  // choisit un motif et un moment de la journée avant d'appuyer.
  if (request.data?.warm === true) return { ok: true, warmed: true }
  const kindId = requireString(request.data?.kindId, 'kindId')
  const preference = request.data?.preference
  if (preference !== 'matin' && preference !== 'apres-midi' && preference !== 'peu-importe') {
    throw new HttpsError('invalid-argument', 'Choisissez un moment de la journée.')
  }

  /*
    Trois questions indépendantes, posées ensemble : le motif existe-t-il, la personne
    a-t-elle déjà une demande en cours, et reste-t-il une place quelque part ?

    Elles s'enchaînaient — motif, puis demandes, puis la recherche de créneau qui lisait
    elle-même le catalogue et les agendas l'un après l'autre. Aucune ne dépend des autres.
    Chercher une place pour rien, quand la demande est un doublon, ne coûte que des
    lectures ; faire attendre quelqu'un d'inquiet coûte plus cher.
  */
  const aujourdHui = todayLocalDate()
  const [motif, deja, place] = await Promise.all([
    db().collection(COLLECTIONS.appointmentKinds).doc(kindId).get(),
    db()
      .collection(COLLECTIONS.appointments)
      .where('patientUid', '==', patient.uid)
      .where('kindId', '==', kindId)
      .get(),
    premierePlaceLibre(kindId, preference),
  ])

  const kind = motif.data()
  if (!motif.exists || kind?.['isActive'] !== true) {
    throw new HttpsError(
      'failed-precondition',
      "Ce motif de rendez-vous n'existe plus. Demandez à un soignant.",
    )
  }

  /*
    Une seule demande à la fois pour un même professionnel.

    Sans cela, quelqu'un d'inquiet qui appuie trois fois se retrouverait avec trois
    rendez-vous — et, depuis l'acceptation automatique, trois créneaux réellement pris
    dans l'agenda de quelqu'un. Le garde-fou vaut mieux ici que dans l'écran : l'écran
    peut être contourné, pas la fonction.
  */
  const enCours = deja.docs.some((d) => {
    const data = d.data()
    if (data['status'] === 'requested') return true
    const jour = data['localDate'] as LocalDate | undefined
    return data['status'] === 'scheduled' && jour !== undefined && jour >= aujourdHui
  })
  if (enCours) {
    return {
      ok: false,
      scheduled: false,
      message: 'Vous avez déjà un rendez-vous prévu avec cette personne. Parlez-en à un soignant.',
    }
  }

  const base = {
    patientUid: patient.uid,
    kindId,
    preference,
    createdAt: Timestamp.now(),
  }

  if (place === null) {
    await db().collection(COLLECTIONS.appointments).add({ ...base, status: 'requested' })
    return {
      ok: true,
      scheduled: false,
      message: 'Votre demande est envoyée. Un soignant vous dira quand.',
    }
  }

  const debut = instantOf(place.slot.localDate, place.slot.time)
  const fin = addMinutes(debut, AUTO_DURATION_MIN)
  await db()
    .collection(COLLECTIONS.appointments)
    .add({
      ...base,
      status: 'scheduled',
      localDate: place.slot.localDate,
      start: Timestamp.fromDate(debut),
      end: Timestamp.fromDate(fin),
      withWhom: place.name,
      practitionerId: place.practitionerId,
      autoAccepted: true,
    })

  logger.info('Rendez-vous accepté automatiquement', {
    practitionerId: place.practitionerId,
    localDate: place.slot.localDate,
  })

  return {
    ok: true,
    scheduled: true,
    message: autoAcceptMessage(place.slot, formatFullWhen(place.slot.localDate, debut, fin), place.name),
  }
})

/**
 * La première place libre chez quelqu'un qui accepte automatiquement les demandes de ce
 * motif. `null` dès qu'il n'y en a pas — la demande rejoint alors la file, et c'est très
 * bien : personne n'a promis un rendez-vous à date fixe.
 */
async function premierePlaceLibre(
  kindId: string,
  preference: 'matin' | 'apres-midi' | 'peu-importe',
): Promise<{ practitionerId: string; name: string; slot: NonNullable<ReturnType<typeof findFirstSlot>> } | null> {
  // Le catalogue des intervenants tient en quelques dizaines de lignes : on le lit en
  // entier plutôt que de demander un index pour trois égalités.
  type Fiche = {
    id: string
    name?: string
    kindId?: string
    isActive?: boolean
    autoAccept?: boolean
    availability?: AvailabilityWindow[]
  }
  const intervenants = await db().collection(COLLECTIONS.practitioners).get()
  const candidats: Fiche[] = intervenants.docs
    .map((d) => ({ ...(d.data() as Omit<Fiche, 'id'>), id: d.id }))
    .filter((p) => p.isActive === true && p.autoAccept === true && p.kindId === kindId)
    .filter((p) => Array.isArray(p.availability) && p.availability.length > 0)
    .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '', 'fr'))
  if (candidats.length === 0) return null

  // Jamais aujourd'hui : un rendez-vous posé dans deux heures est un rendez-vous manqué.
  const depart = addLocalDays(todayLocalDate(), 1)
  const jusque = addLocalDays(depart, AUTO_HORIZON_DAYS)

  /*
    Les agendas des candidats se lisent tous en même temps.

    On les parcourait l'un après l'autre en s'arrêtant au premier qui avait de la place :
    économe en lectures, coûteux en attente — avec trois psychiatres, c'étaient trois
    allers-retours en file avant que le patient n'ait sa réponse. On lit tout d'un coup et
    l'on garde le premier dans l'ordre, qui est le même qu'avant.
  */
  const agendas = await Promise.all(
    candidats.map((candidat) =>
      db()
        .collection(COLLECTIONS.appointments)
        .where('practitionerId', '==', candidat.id)
        .where('status', '==', 'scheduled')
        .where('localDate', '>=', depart)
        .where('localDate', '<=', jusque)
        .get(),
    ),
  )

  for (const [index, candidat] of candidats.entries()) {
    const occupes: BusySlot[] = (agendas[index]?.docs ?? []).flatMap((d) => {
      const data = d.data()
      const debut = data['start'] as Timestamp | undefined
      const fin = data['end'] as Timestamp | undefined
      const jour = data['localDate'] as LocalDate | undefined
      if (debut === undefined || fin === undefined || jour === undefined) return []
      return [{ localDate: jour, from: localTimeOf(debut.toDate()), to: localTimeOf(fin.toDate()) }]
    })

    const slot = findFirstSlot({
      windows: candidat.availability ?? [],
      busy: occupes,
      preference,
      from: depart,
      horizonDays: AUTO_HORIZON_DAYS,
      durationMin: AUTO_DURATION_MIN,
    })
    if (slot !== null) {
      return { practitionerId: candidat.id, name: candidat.name ?? 'un professionnel', slot }
    }
  }
  return null
}

/**
 * Échange d'un code contre une session. Le code n'est jamais comparé en clair et
 * n'est jamais l'objet d'une requête : son empreinte *est* l'identifiant du document.
 */
export const exchangeCode = onCall({ secrets: [CODE_PEPPER] }, async (request: CallableRequest) => {
  /*
    Réveil, avant toute chose.

    C'est ici que le démarrage à froid coûtait le plus cher : quelqu'un tape son code,
    appuie, et attend une dizaine de secondes sans savoir si l'application l'a entendu.
    L'écran du code demande donc ce réveil en s'affichant — il faut plusieurs secondes
    pour saisir six caractères, largement de quoi rallumer la fonction.

    L'appel ne lit rien, ne touche à aucun secret, et ne compte pas dans la limite de
    tentatives : il n'y a pas de code à essayer.
  */
  if (request.data?.warm === true) return { warmed: true }

  const raw = request.data?.code
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 32) {
    throw new HttpsError('invalid-argument', 'Saisissez le code inscrit sur votre feuille.')
  }
  const clientKey = request.rawRequest?.ip ?? 'inconnu'
  /*
    La limite de tentatives et le code se lisent ensemble.

    Elles ne dépendent pas l'une de l'autre : l'une regarde une adresse, l'autre une
    empreinte. On les enchaînait, et c'est le moment de l'application où l'attente coûte
    le plus cher — quelqu'un tape six caractères sur une feuille et attend de savoir s'il
    a le droit d'entrer. Si la limite est atteinte, l'erreur remonte comme avant ; on aura
    lu un document pour rien, ce qui est sans conséquence.
  */
  const [, codeSnapshot] = await Promise.all([
    assertNotRateLimited(clientKey),
    db().collection(COLLECTIONS.patientCodes).doc(hashCode(raw)).get(),
  ])
  const codeData = codeSnapshot.data() as { uid: string; expiresAt: Timestamp } | undefined
  const expired = codeData !== undefined && codeData.expiresAt.toMillis() < Date.now()

  if (codeData === undefined || expired) {
    await recordFailure(clientKey)
    throw new HttpsError(
      'not-found',
      "Ce code n'est pas reconnu. Demandez un nouveau code à un soignant.",
    )
  }

  const patientSnapshot = await db().collection(COLLECTIONS.patients).doc(codeData.uid).get()
  const patient = patientSnapshot.data() as { firstName: string; serviceId: string } | undefined
  if (patient === undefined) {
    await recordFailure(clientKey)
    throw new HttpsError('not-found', "Ce code n'est pas reconnu. Demandez un nouveau code à un soignant.")
  }

  // L'effacement des tentatives ratées part maintenant, et l'on ne l'attend qu'à la fin :
  // il n'apprend rien à la signature du jeton, qui est le vrai temps de cette fonction.
  const effacement = clearFailures(clientKey)

  // Le service voyage dans le jeton : le patient ne peut pas le changer, et les règles
  // Firestore s'en servent pour filtrer le calendrier.
  //
  // La signature du jeton est demandée à Google : les fonctions n'ont pas de clé privée.
  // Si le droit de signer manque, l'échec est muet côté patient — d'où ce message, qui
  // dit quoi faire plutôt que « INTERNAL ». Voir `scripts/autoriser-jetons.sh`.
  let token: string
  try {
    token = await auth().createCustomToken(codeData.uid, {
      patient: true,
      serviceId: patient.serviceId,
    })
  } catch (error) {
    logger.error('Signature du jeton patient impossible', { error })
    throw new HttpsError(
      'internal',
      'La connexion n’a pas pu être ouverte. Prévenez la personne qui a installé l’application.',
    )
  }
  // Une écriture laissée en l'air peut être coupée quand la fonction rend la main : on
  // s'assure qu'elle a abouti. Elle est partie il y a longtemps, cela ne coûte rien.
  await effacement
  return { token, firstName: patient.firstName, serviceId: patient.serviceId }
})

/**
 * Supprime une activité et ses séances.
 *
 * Deux gestes, et il faut les distinguer.
 *
 * **Sans `force`** : l'activité n'est réellement effacée que si personne ne s'y est jamais
 * inscrit. Dès qu'une inscription existe, elle est seulement retirée du programme — la
 * trace sert à répondre à « qui est venu ? ».
 *
 * **Avec `force`** : tout part, inscriptions comprises. C'est demandé quand une activité
 * n'aurait jamais dû exister : la laisser barrée dans le calendrier de quelqu'un serait
 * pire que de la faire disparaître. L'écran a nommé ce qui allait être effacé avant d'en
 * arriver là, et le nombre est écrit au journal — c'est tout ce qui restera.
 *
 * Réservé à l'administrateur et à la personne qui anime l'activité : une suppression sans
 * retour n'est pas un geste que l'on confie à tout le monde.
 */
export const deleteActivity = onCall(async (request: CallableRequest) => {
  const staff = requireStaff(request)
  const activityId = requireString(request.data?.activityId, 'activityId', 200)
  const force = request.data?.force === true

  const reference = db().collection(COLLECTIONS.activities).doc(activityId)
  const snapshot = await reference.get()
  if (!snapshot.exists) throw new HttpsError('not-found', "Cette activité n'existe plus.")
  const donnees = snapshot.data() ?? {}
  const title = (donnees['title'] as string | undefined) ?? activityId
  const anime = (donnees['facilitatorId'] as string | undefined) ?? ''
  if (staff.role !== 'admin' && (anime === '' || anime !== staff.practitionerId)) {
    throw new HttpsError(
      'permission-denied',
      "Seul un administrateur, ou la personne qui anime cette activité, peut la supprimer.",
    )
  }

  const occurrences = await db()
    .collection(COLLECTIONS.occurrences)
    .where('activityId', '==', activityId)
    .get()

  // `in` accepte trente valeurs : on interroge par paquets plutôt que de faire confiance
  // aux compteurs dénormalisés, qui retombent à zéro après une annulation. Sans `force`,
  // une seule inscription suffit à trancher : on s'arrête là. Avec, il faut toutes les
  // retrouver pour les effacer.
  const inscriptions: FirebaseFirestore.QueryDocumentSnapshot[] = []
  const identifiants = occurrences.docs.map((d) => d.id)
  for (let i = 0; i < identifiants.length; i += 30) {
    if (!force && inscriptions.length > 0) break
    const paquet = identifiants.slice(i, i + 30)
    const trouvees = await db()
      .collection(COLLECTIONS.registrations)
      .where('occurrenceId', 'in', paquet)
      .get()
    inscriptions.push(...trouvees.docs)
  }
  // Ce qui coûte, et qu'il faut pouvoir nommer avant d'effacer : les séances déjà
  // passées portent une histoire, et les présences notées y répondent à « qui est venu ? ».
  const aujourdHui = new Date().toISOString().slice(0, 10)
  const registrations = inscriptions.length
  const usage = {
    registrations,
    sessions: occurrences.size,
    pastSessions: occurrences.docs.filter((d) => {
      const jour = d.data()['localDate'] as string | undefined
      return typeof jour === 'string' && jour < aujourdHui
    }).length,
    attendances: inscriptions.filter((d) => d.data()['attendance'] !== undefined).length,
  }

  const plan = force ? planForcedRemoval(title, usage) : planActivityRemoval(title, usage)

  if (plan.action === 'deleted') {
    // Les inscriptions d'abord, puis les séances : le déclencheur posé sur l'activité
    // régénérerait les secondes si l'activité partait avant elles.
    await supprimerParPaquets(force ? inscriptions.map((d) => d.ref) : [])
    await supprimerParPaquets(occurrences.docs.map((d) => d.ref))
    await reference.delete()
  } else {
    await reference.set({ isActive: false }, { merge: true })
  }

  logger.info('Activité retirée', { activityId, action: plan.action, force, ...usage })
  return plan
})

/** Firestore refuse au-delà de 500 opérations par lot : on découpe. */
async function supprimerParPaquets(references: FirebaseFirestore.DocumentReference[]): Promise<void> {
  for (let i = 0; i < references.length; i += 400) {
    const batch = db().batch()
    for (const reference of references.slice(i, i + 400)) batch.delete(reference)
    await batch.commit()
  }
}

/**
 * Supprime une séance et ses inscriptions — celle-là seule, les autres semaines restent.
 *
 * À ne pas confondre avec l'annulation, qui est le geste courant : une séance annulée
 * reste visible, barrée, avec son motif, et la personne inscrite comprend pourquoi elle
 * ne vient pas. Supprimer, c'est pour ce qui n'aurait jamais dû être créé — il ne reste
 * alors rien à expliquer, et une ligne barrée dans un calendrier serait un mystère.
 *
 * L'activité, elle, n'est pas touchée : c'est une exception de plus dans sa série.
 */
export const deleteOccurrence = onCall(async (request: CallableRequest) => {
  const staff = requireStaff(request)
  const occurrenceId = requireString(request.data?.occurrenceId, 'occurrenceId', 200)

  const reference = db().collection(COLLECTIONS.occurrences).doc(occurrenceId)
  const snapshot = await reference.get()
  if (!snapshot.exists) throw new HttpsError('not-found', "Cette séance n'existe plus.")
  const donnees = snapshot.data() ?? {}
  const anime = (donnees['facilitatorId'] as string | undefined) ?? ''
  if (staff.role !== 'admin' && (anime === '' || anime !== staff.practitionerId)) {
    throw new HttpsError(
      'permission-denied',
      "Seul un administrateur, ou la personne qui anime cette activité, peut supprimer une séance.",
    )
  }

  const inscriptions = await db()
    .collection(COLLECTIONS.registrations)
    .where('occurrenceId', '==', occurrenceId)
    .get()

  await supprimerParPaquets(inscriptions.docs.map((d) => d.ref))
  await reference.delete()

  const presences = inscriptions.docs.filter((d) => d.data()['attendance'] !== undefined).length
  logger.info('Séance supprimée', { occurrenceId, registrations: inscriptions.size, presences })
  const titre = (donnees['title'] as string | undefined) ?? 'Cette séance'
  const combien =
    inscriptions.size === 0
      ? "Personne n'y était inscrit."
      : inscriptions.size === 1
        ? 'Une inscription a été effacée.'
        : `${inscriptions.size} inscriptions ont été effacées.`
  const notees =
    presences === 0
      ? ''
      : presences === 1
        ? ' Une présence notée disparaît avec elle.'
        : ` ${presences} présences notées disparaissent avec elle.`
  return { ok: true, message: `La séance de « ${titre} » est supprimée. ${combien}${notees}` }
})

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

/**
 * Retire une entrée du catalogue. Le comptage se fait ici, pas dans le navigateur :
 * les personnes ne sont pas lisibles côté client, et une suppression décidée sur une
 * vue partielle laisserait des activités pointant vers un lieu disparu.
 *
 * `limit(…)` plutôt qu'un comptage exact : au-delà, le nombre affiché serait de toute
 * façon un ordre de grandeur, et la décision — supprimer ou retirer — ne change plus.
 */
export const removeCatalogEntry = onCall(async (request: CallableRequest) => {
  requireAdmin(request)
  const kind = requireString(request.data?.kind, 'kind', 20) as CatalogKind
  const id = requireString(request.data?.id, 'id', 100)
  const GENRES: CatalogKind[] = ['location', 'service', 'category', 'practitioner', 'appointmentKind']
  if (!GENRES.includes(kind)) {
    throw new HttpsError('invalid-argument', 'Genre inconnu.')
  }

  const collection =
    kind === 'location'
      ? COLLECTIONS.locations
      : kind === 'service'
        ? COLLECTIONS.services
        : kind === 'category'
          ? COLLECTIONS.categories
          : kind === 'appointmentKind'
            ? COLLECTIONS.appointmentKinds
            : COLLECTIONS.practitioners
  const reference = db().collection(collection).doc(id)
  const snapshot = await reference.get()
  if (!snapshot.exists) throw new HttpsError('not-found', "Cette entrée n'existe plus.")
  const name = (snapshot.data()?.['name'] as string | undefined) ?? id

  const champActivite =
    kind === 'location'
      ? 'locationId'
      : kind === 'category'
        ? 'categoryId'
        : kind === 'practitioner'
          ? 'facilitatorId'
          : null
  const PLAFOND = 50

  async function combien(requete: FirebaseFirestore.Query): Promise<number> {
    return (await requete.limit(PLAFOND).get()).size
  }

  // Un motif de rendez-vous ne se pose ni sur une activité ni sur une séance : il ne
  // vit que sur les rendez-vous. On ne va donc pas les interroger pour rien.
  const requeteActivites =
    kind === 'appointmentKind'
      ? null
      : champActivite === null
        ? db().collection(COLLECTIONS.activities).where('serviceIds', 'array-contains', id)
        : db().collection(COLLECTIONS.activities).where(champActivite, '==', id)
  const activites = requeteActivites === null ? null : await requeteActivites.limit(PLAFOND).get()

  const usage = {
    activities: activites?.size ?? 0,
    occurrences:
      kind === 'appointmentKind'
        ? 0
        : champActivite === null
          ? await combien(db().collection(COLLECTIONS.occurrences).where('audienceKeys', 'array-contains', id))
          : await combien(db().collection(COLLECTIONS.occurrences).where(champActivite, '==', id)),
    patients:
      kind === 'service' ? await combien(db().collection(COLLECTIONS.patients).where('serviceId', '==', id)) : 0,
    appointments:
      kind === 'practitioner'
        ? await combien(db().collection(COLLECTIONS.appointments).where('practitionerId', '==', id))
        : kind === 'appointmentKind'
          ? await combien(db().collection(COLLECTIONS.appointments).where('kindId', '==', id))
          : 0,
  }

  const plan = planRemoval(kind, name, usage)
  if (plan.action === 'deleted') await reference.delete()
  else await reference.set({ isActive: false }, { merge: true })

  logger.info('Entrée de catalogue retirée', { kind, id, action: plan.action, ...usage })
  // Nommer les activités concernées : c'est ce qu'il faut modifier pour pouvoir un jour
  // supprimer l'entrée pour de bon. Un décompte seul ne dit pas où aller.
  return {
    ...plan,
    activityTitles: (activites?.docs ?? [])
      .slice(0, 8)
      .map((d) => (d.data()['title'] as string | undefined) ?? d.id),
  }
})

// ---------------------------------------------------------------------------
// Comptes du personnel
// ---------------------------------------------------------------------------

/**
 * Donne un accès à un membre du personnel, et le relie à son intervenant.
 *
 * Tout le monde ne passe pas par la console Firebase : c'est ici que se crée un compte,
 * avec un mot de passe provisoire affiché **une seule fois**, comme un code patient. Si
 * le compte existe déjà, il est simplement relié — sans toucher au mot de passe.
 *
 * Le lien vit dans le jeton, pas dans un document : c'est lui qui ouvrira l'appel des
 * activités de cette personne.
 */
export const createStaffAccount = onCall(async (request: CallableRequest) => {
  requireAdmin(request)
  const email = requireString(request.data?.email, 'adresse électronique', 200).toLowerCase()
  const practitionerId = requireString(request.data?.practitionerId, 'intervenant', 100)

  const fiche = await db().collection(COLLECTIONS.practitioners).doc(practitionerId).get()
  if (!fiche.exists) throw new HttpsError('not-found', "Cet intervenant n'existe pas.")
  const nom = (fiche.data()?.['name'] as string | undefined) ?? ''

  const existant = await auth()
    .getUserByEmail(email)
    .catch(() => null)

  let motDePasse: string | null = null
  let uid: string
  if (existant === null) {
    // Lisible à voix haute et à recopier : même alphabet que les codes patients.
    motDePasse = `${generateCode(4)}-${generateCode(4)}`
    const cree = await auth().createUser({ email, password: motDePasse, displayName: nom })
    uid = cree.uid
  } else {
    uid = existant.uid
  }

  const claims = (existant?.customClaims ?? {}) as { role?: string }
  const role = claims.role === 'admin' ? 'admin' : 'staff'
  await auth().setCustomUserClaims(uid, { role, practitionerId })
  await db()
    .collection(COLLECTIONS.staff)
    .doc(uid)
    .set(
      { role, firstName: nom, practitionerId, isActive: true, updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    )
  // Le jeton en cours ne porte pas encore le lien : il faut se reconnecter.
  await auth().revokeRefreshTokens(uid)

  logger.info('Accès du personnel créé ou relié', { uid, practitionerId, cree: existant === null })
  return { uid, email, practitionerId, password: motDePasse }
})

// ---------------------------------------------------------------------------
// « Voir à leur place » — outil de mise au point, réservé à l'administrateur
// ---------------------------------------------------------------------------

/**
 * La liste des comptes auxquels on peut se substituer : les patients et le personnel.
 *
 * Rien de médical n'en sort — un prénom, un service, un poste, une adresse
 * professionnelle. C'est déjà ce que l'administrateur voit ailleurs dans l'application.
 */
export const listAccounts = onCall(async (request: CallableRequest) => {
  requireAdmin(request)
  const maintenant = Date.now()

  const patients = (await db().collection(COLLECTIONS.patients).get()).docs
    .map((document) => {
      const data = document.data() as { firstName?: string; serviceId?: string; expiresAt?: Timestamp }
      return {
        uid: document.id,
        label: data.firstName ?? 'Prénom inconnu',
        detail: data.serviceId ?? '',
        kind: 'patient' as const,
        expiresAtMs: data.expiresAt?.toMillis() ?? Number.MAX_SAFE_INTEGER,
      }
    })
    .filter((patient) => patient.expiresAtMs > maintenant)
    .map(({ expiresAtMs: _expiresAtMs, ...patient }) => patient)

  // Le personnel se lit dans Auth, pas dans `staff/` : le rôle qui fait autorité est le
  // jeton, et c'est aussi là que vit l'adresse de connexion.
  const comptes = await auth().listUsers(1000)
  const personnel = comptes.users
    .filter((utilisateur) => {
      const role = (utilisateur.customClaims ?? {})['role']
      return role === 'staff' || role === 'admin'
    })
    .map((utilisateur) => {
      const claims = (utilisateur.customClaims ?? {}) as { role?: string; practitionerId?: string }
      return {
        uid: utilisateur.uid,
        label: utilisateur.displayName ?? utilisateur.email ?? utilisateur.uid,
        detail: `${claims.role === 'admin' ? 'Administrateur' : 'Soignant'} · ${utilisateur.email ?? ''}`.trim(),
        kind: 'staff' as const,
        // De quoi savoir, à l'écran, qui est administrateur et à quel intervenant ce
        // compte est relié — sans avoir à lire une phrase pour le deviner.
        role: claims.role === 'admin' ? ('admin' as const) : ('staff' as const),
        ...(claims.practitionerId === undefined ? {} : { practitionerId: claims.practitionerId }),
      }
    })

  return { accounts: [...personnel, ...patients] }
})

/**
 * Ouvre une session à la place de quelqu'un, et met de côté de quoi revenir.
 *
 * C'est un outil de mise au point, assumé comme tel : préparer l'application demande de
 * créer des dizaines de comptes, puis de vérifier ce que chacun voit — un patient du
 * Mazurel n'a pas le même calendrier qu'un patient de la Ferme, et l'appel n'est ouvert
 * qu'à la personne qui anime l'activité. Retenir autant de mots de passe est intenable.
 *
 * Deux garde-fous, et pas un de plus : seul un administrateur peut appeler, et chaque
 * passage est écrit au journal, avec qui a pris la place de qui. Le jeton de retour est
 * un jeton pour le compte de l'administrateur lui-même — il ne donne donc rien de plus
 * que ce qu'il avait déjà — et il vit une heure, dans l'onglet seulement.
 *
 * Rien ici ne relâche les règles : la session ouverte est une vraie session, avec
 * exactement les droits de la personne. C'est précisément ce qu'on veut vérifier.
 */
export const impersonate = onCall(async (request: CallableRequest) => {
  const administrateur = requireAdmin(request)
  const uid = requireString(request.data?.uid, 'compte', 128)
  if (uid === administrateur.uid) {
    throw new HttpsError('invalid-argument', 'Vous êtes déjà à votre place.')
  }

  // Un patient n'a pas forcément de compte Auth : il n'en a un qu'une fois son code
  // saisi. Sa fiche, elle, existe dès sa création — c'est elle qui fait foi, et le
  // service voyage dans le jeton comme le fait `exchangeCode`.
  const fiche = await db().collection(COLLECTIONS.patients).doc(uid).get()
  const patient = fiche.data() as { firstName?: string; serviceId?: string } | undefined

  let claims: Record<string, unknown>
  let label: string
  let kind: 'patient' | 'staff'
  if (patient !== undefined) {
    claims = { patient: true, serviceId: patient.serviceId ?? '' }
    label = patient.firstName ?? 'Prénom inconnu'
    kind = 'patient'
  } else {
    const compte = await auth()
      .getUser(uid)
      .catch(() => null)
    if (compte === null) throw new HttpsError('not-found', "Ce compte n'existe pas.")
    // Les droits du personnel vivent sur le compte : ils reviendront d'eux-mêmes dans
    // le jeton. Rien à recopier ici.
    claims = {}
    label = compte.displayName ?? compte.email ?? uid
    kind = 'staff'
  }

  let token: string
  let back: string
  try {
    token = await auth().createCustomToken(uid, claims)
    back = await auth().createCustomToken(administrateur.uid)
  } catch (error) {
    logger.error('Signature du jeton impossible', { error })
    throw new HttpsError(
      'internal',
      "La session n'a pas pu être ouverte. Prévenez la personne qui a installé l'application.",
    )
  }

  logger.info('Session ouverte à la place de quelqu’un', {
    administrateur: administrateur.uid,
    cible: uid,
    kind,
  })
  return { token, back, label, kind, firstName: label }
})

export const setStaffRole = onCall(async (request: CallableRequest) => {
  const administrateur = requireAdmin(request)
  const uid = requireString(request.data?.uid, 'uid')
  const role = request.data?.role
  if (role !== 'staff' && role !== 'admin' && role !== null) {
    throw new HttpsError('invalid-argument', 'Le rôle doit être « staff », « admin » ou vide.')
  }
  /*
    On ne se retire pas ses propres droits.

    Un administrateur qui décoche sa propre case se retrouverait dehors, sans personne
    pour l'y remettre : il faudrait relancer un script depuis un terminal. Le refus est
    ici, sur le serveur, parce qu'une garde d'interface se contourne.
  */
  if (uid === administrateur.uid && role !== 'admin') {
    throw new HttpsError(
      'failed-precondition',
      'Vous ne pouvez pas retirer vos propres droits d’administrateur. Demandez-le à un autre administrateur.',
    )
  }

  const firstName = typeof request.data?.firstName === 'string' ? request.data.firstName : undefined
  const lien = request.data?.practitionerId
  const practitionerId = typeof lien === 'string' && lien !== '' ? lien : null

  // Le lien vers l'intervenant vit dans le jeton, comme le rôle : c'est lui qui décide
  // de l'appel, jamais un document Firestore.
  await auth().setCustomUserClaims(
    uid,
    role === null ? {} : { role, ...(practitionerId === null ? {} : { practitionerId }) },
  )
  await db()
    .collection(COLLECTIONS.staff)
    .doc(uid)
    .set(
      { role, firstName, practitionerId, isActive: role !== null, updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    )
  await auth().revokeRefreshTokens(uid)
  return { uid, role, practitionerId }
})

// ---------------------------------------------------------------------------
// Purge — RGPD : on ne garde que ce qui sert encore
// ---------------------------------------------------------------------------

async function deleteQuery(query: FirebaseFirestore.Query): Promise<number> {
  const snapshot = await query.limit(400).get()
  if (snapshot.empty) return 0
  const batch = db().batch()
  snapshot.docs.forEach((document) => batch.delete(document.ref))
  await batch.commit()
  return snapshot.size + (snapshot.size === 400 ? await deleteQuery(query) : 0)
}

export const purgeExpiredData = onSchedule(
  { schedule: '30 3 * * *', timeZone: 'Europe/Brussels' },
  async () => {
    const retentionDays = await readConfig('retentionDays', DEFAULT_RETENTION_DAYS)
    const cutoff = Timestamp.fromMillis(Date.now() - retentionDays * 86_400_000)
    const now = Timestamp.now()

    const registrations = await deleteQuery(
      db().collection(COLLECTIONS.registrations).where('createdAt', '<', cutoff),
    )
    const codes = await deleteQuery(
      db().collection(COLLECTIONS.patientCodes).where('expiresAt', '<', now),
    )
    const patients = await deleteQuery(
      db().collection(COLLECTIONS.patients).where('expiresAt', '<', cutoff),
    )
    const rateLimits = await deleteQuery(
      db().collection('rateLimits').where('firstFailureAt', '<', Timestamp.fromMillis(Date.now() - 86_400_000)),
    )

    logger.info('Purge effectuée', { retentionDays, registrations, codes, patients, rateLimits })
  },
)
