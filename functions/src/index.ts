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
import { alreadyAskedMessage } from './domain/appointments'
import {
  effectivePermissions,
  isAllowed,
  readOverrides,
  readPermissions,
  refusalFor,
  OPEN_TO_PATIENTS,
  type PatientAction,
  type PatientPermissions,
} from './domain/permissions'
import {
  alreadyWaiting,
  cleanProposal,
  validateProposal,
  DESCRIPTION_MAX,
  TITLE_MAX,
  type ActivityProposal,
} from './domain/proposals'
import { PLANNING_HORIZON_DAYS, agendaWeek, firstBookableDay, suggestSlot } from './domain/agenda'
import { leaveRefusal, normalizeLeaves, withoutLeave, type Leave } from './domain/leave'
import { phrase } from './domain/francais'
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
  localDateOf,
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

/**
 * Le réglage, gardé une demi-minute en mémoire.
 *
 * Il est consulté avant chacun des quatre gestes du patient, et il change une ou deux
 * fois par an : le relire à chaque inscription reviendrait à payer un aller-retour pour
 * une réponse qu'on connaît déjà. Une instance chaude sert ainsi vingt clics sans une
 * seule lecture.
 *
 * Le prix est une demi-minute de retard sur un changement de réglage. C'est un réglage
 * d'organisation, pas un verrou de sécurité : personne ne le modifie en espérant qu'il
 * prenne effet dans la seconde, et l'écran d'administration le dit.
 */
const DUREE_DU_REGLAGE_MS = 30_000
let reglageEnCache: { lu: number; permissions: PatientPermissions } | null = null

async function patientPermissions(): Promise<PatientPermissions> {
  const maintenant = Date.now()
  if (reglageEnCache !== null && maintenant - reglageEnCache.lu < DUREE_DU_REGLAGE_MS) {
    return reglageEnCache.permissions
  }
  try {
    const brut = (await db().collection(COLLECTIONS.config).doc('app').get()).data()?.['patientActions']
    const permissions = readPermissions(brut)
    reglageEnCache = { lu: maintenant, permissions }
    return permissions
  } catch (error) {
    // Un réglage qu'on n'arrive pas à lire ne doit jamais fermer une porte : une base
    // momentanément injoignable priverait tout le monde de tout, sans que personne ne
    // l'ait décidé. On ne met pas ce repli en cache — la prochaine tentative réessaiera.
    logger.warn('Réglage des gestes du patient illisible : tout reste ouvert', { error })
    return { ...OPEN_TO_PATIENTS }
  }
}

/**
 * Ce qu'une personne peut faire, tout compte fait.
 *
 * C'est ici que le réglage mord. L'écran cache les boutons fermés, mais un écran se
 * contourne : si la vérification ne vivait que là, le réglage serait un décor.
 *
 * Deux sources, et la seconde l'emporte là où elle existe : la règle du service, gardée
 * en mémoire, et le réglage particulier de cette personne — une lecture, qu'on peut
 * souvent mener de front avec celles que la fonction fait déjà. Le réglage particulier
 * absent laisse la règle du service s'appliquer, aujourd'hui et quand elle changera.
 *
 * `dejaLu` sert quand l'appelant vient de lire ce document pour une autre raison.
 */
async function patientMay(
  action: PatientAction,
  patientUid: string,
  dejaLu?: FirebaseFirestore.DocumentSnapshot,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const [service, particulier] = await Promise.all([
    patientPermissions(),
    dejaLu !== undefined
      ? Promise.resolve(dejaLu)
      : db()
          .collection(COLLECTIONS.patientActions)
          .doc(patientUid)
          .get()
          .catch(() => null),
  ])
  const finales = effectivePermissions(service, readOverrides(particulier?.data() ?? null))
  return isAllowed(finales, action) ? { ok: true } : { ok: false, message: refusalFor(action) }
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
  // Le service a-t-il ouvert ce geste aux patients ? La question part avec la recherche
  // de chevauchement : elles ne s'apprennent rien l'une à l'autre.
  const [ouvert, conflits] = await Promise.all([
    patientMay('register', patient.uid),
    conflictsFor(db(), patient.uid, occurrenceId),
  ])
  if (!ouvert.ok) return { ok: false, reason: 'closed', message: ouvert.message }

  const avis = patientConflictNotice(conflits)
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
  const ouvert = await patientMay('unregister', patient.uid)
  if (!ouvert.ok) return { ok: false, message: ouvert.message }
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
  return unregisterTx(db(), { occurrenceId, patientUid, by: 'staff' })
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
  const occurrence = snapshot.data() as { facilitatorId?: string; ledByPatient?: boolean } | undefined
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
    | { facilitatorId?: string; facilitator?: string; ledByPatient?: boolean }
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
  /*
    Noter une présence ne donne pas la place.

    On l'avait fait : une personne en liste d'attente notée présente passait confirmée.
    Mais la feuille d'appel se touche du doigt, quinze prénoms à la suite, sur une
    tablette posée en salle — et un appui de travers faisait alors passer quelqu'un devant
    tous ceux qui attendaient, sans retour possible : « Présent — annuler » efface la
    présence, pas la promotion. La place se donne d'un geste séparé et explicite.
  */

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
 * Fin de séjour. Le code cesse de fonctionner, la personne sort des listes, et les
 * places qu'elle retenait pour les séances à venir sont rendues.
 *
 * Ce dernier point manquait, et il coûtait des places à d'autres : la personne était
 * partie, mais son inscription de jeudi tenait toujours un siège sur douze, la liste
 * d'attente n'avançait pas, et plus aucun écran ne permettait de l'en retirer — elle
 * avait disparu des listes où l'on désinscrit. Une séance affichait « complet » pour
 * quelqu'un qui n'était plus là.
 *
 * Le passé ne bouge pas : qui était présent à la séance de lundi l'a été, et une feuille
 * d'appel déjà remplie ne se réécrit pas.
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

  const rendues = await libereLesPlacesAVenir(uid)

  return {
    ok: true,
    message:
      rendues === 0
        ? 'Le séjour est clôturé. Le code ne fonctionne plus.'
        : rendues === 1
          ? 'Le séjour est clôturé. Le code ne fonctionne plus. Une place retenue a été rendue.'
          : `Le séjour est clôturé. Le code ne fonctionne plus. ${rendues} places retenues ont été rendues.`,
  }
})

/**
 * Rend les places qu'une personne retenait sur les séances qui n'ont pas encore eu lieu.
 *
 * Chaque désinscription passe par la transaction habituelle : c'est elle qui fait monter
 * le premier de la liste d'attente et qui tient les compteurs à jour. Une séance qui
 * échoue n'empêche pas les autres — le séjour est clôturé de toute façon, et laisser la
 * moitié des places prises serait pire que tout.
 */
async function libereLesPlacesAVenir(patientUid: string): Promise<number> {
  const maintenant = Date.now()
  const inscriptions = await db()
    .collection(COLLECTIONS.registrations)
    .where('patientUid', '==', patientUid)
    .get()
  const aVenir = inscriptions.docs
    .map((document) => document.data() as { occurrenceId?: string; status?: string })
    .filter((ligne) => ligne.status === 'confirmed' || ligne.status === 'waitlist')
    .map((ligne) => ligne.occurrenceId)
    .filter((occurrenceId): occurrenceId is string => typeof occurrenceId === 'string')
    .filter((occurrenceId) => {
      const debut = debutDeLaSeance(occurrenceId)
      return debut !== null && debut.getTime() >= maintenant
    })

  let rendues = 0
  for (const occurrenceId of new Set(aVenir)) {
    const resultat = await unregisterTx(db(), { occurrenceId, patientUid, by: 'staff' }).catch(() => ({ ok: false }))
    if (resultat.ok) rendues += 1
  }
  return rendues
}

/**
 * L'heure de début d'une séance, lue dans son identifiant.
 *
 * Les identifiants d'occurrence sont déterministes — `{activityId}_{yyyyMMddTHHmm}` — ce
 * qui évite de relire chaque séance pour savoir si elle est passée. Rend `null` si
 * l'identifiant n'a pas cette forme : on ne touche alors à rien.
 */
function debutDeLaSeance(occurrenceId: string): Date | null {
  const marque = occurrenceId.slice(occurrenceId.lastIndexOf('_') + 1)
  if (!/^\d{8}T\d{4}$/.test(marque)) return null
  const jour = `${marque.slice(0, 4)}-${marque.slice(4, 6)}-${marque.slice(6, 8)}`
  const heure = `${marque.slice(9, 11)}:${marque.slice(11, 13)}`
  return instantOf(jour, heure)
}

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
  /*
    L'agenda croisé commence demain, jamais aujourd'hui.

    Il commençait aujourd'hui, et rien ici ne connaît l'heure qu'il est : il a donc
    proposé un rendez-vous le jour même à neuf heures trente alors qu'il en était
    quatorze. L'acceptation automatique appliquait déjà cette règle de son côté ; les
    deux chemins disent désormais la même chose.

    La semaine affichée part du même jour : montrer aujourd'hui inviterait à y poser un
    rendez-vous, ce qui est exactement ce qu'on veut éviter.
  */
  const depart =
    typeof request.data?.from === 'string'
      ? (request.data.from as LocalDate)
      : firstBookableDay(todayLocalDate())

  const [fiche, conges] = await Promise.all([
    db().collection(COLLECTIONS.practitioners).doc(practitionerId).get(),
    congesDe(practitionerId),
  ])
  if (!fiche.exists) throw new HttpsError('not-found', "Cette personne n'a pas été trouvée.")
  const plages = Array.isArray(fiche.data()?.['availability'])
    ? (fiche.data()!['availability'] as AvailabilityWindow[])
    : []

  const jusque = addLocalDays(depart, PLANNING_HORIZON_DAYS)

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
    horizonDays: PLANNING_HORIZON_DAYS,
    durationMin,
    // Un jour de congé ne propose rien, quelles que soient les plages annoncées.
    leaves: conges,
  })

  /*
    Trois semaines, et non une seule.

    Le créneau proposé est cherché sur trois semaines : le rendre sur sept jours laissait
    la possibilité qu'il soit proposé sans figurer dans la liste, ce qui rend impossible
    d'en choisir un autre le même jour. Les lectures, elles, portaient déjà sur trois
    semaines — c'est le même agenda, découpé plus loin. L'écran n'en déroule que la
    semaine qui vient ; le reste s'ouvre à la demande.
  */
  const jours: LocalDate[] = []
  for (let i = 0; i < PLANNING_HORIZON_DAYS; i += 1) jours.push(addLocalDays(depart, i))
  const semaine = agendaWeek(jours, plages, [...occupeIntervenant, ...occupePatient], durationMin, conges)

  return {
    availability: plages,
    week: semaine.map((jour) => ({
      localDate: jour.localDate,
      onLeave: jour.onLeave,
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
    La personne demandée, quand le patient en a nommé une.

    Souvent il ne veut pas « un psychiatre » mais celui qu'il connaît, et le lui refuser
    c'est le renvoyer au bouche-à-oreille. Le nom n'est pas une promesse : la demande
    reste une demande, et c'est l'équipe — la personne nommée ou la bulle — qui fixe.

    Vérifié ici et pas seulement à l'écran : un écran se contourne, pas une fonction.
  */
  const demande = request.data?.practitionerId
  const practitionerId = typeof demande === 'string' && demande.trim() !== '' ? demande.trim() : null



  /*
    Trois questions indépendantes, posées ensemble : le motif existe-t-il, la personne
    a-t-elle déjà une demande en cours, et reste-t-il une place quelque part ?

    Elles s'enchaînaient — motif, puis demandes, puis la recherche de créneau qui lisait
    elle-même le catalogue et les agendas l'un après l'autre. Aucune ne dépend des autres.
    Chercher une place pour rien, quand la demande est un doublon, ne coûte que des
    lectures ; faire attendre quelqu'un d'inquiet coûte plus cher.
  */
  const aujourdHui = todayLocalDate()
  const [ouvert, motif, deja, place, fiche] = await Promise.all([
    patientMay('requestAppointment', patient.uid),
    db().collection(COLLECTIONS.appointmentKinds).doc(kindId).get(),
    db()
      .collection(COLLECTIONS.appointments)
      .where('patientUid', '==', patient.uid)
      .where('kindId', '==', kindId)
      .get(),
    premierePlaceLibre(kindId, preference, patient.serviceId, practitionerId, patient.uid),
    practitionerId === null
      ? Promise.resolve(null)
      : db().collection(COLLECTIONS.practitioners).doc(practitionerId).get(),
  ])
  if (!ouvert.ok) return { ok: false, scheduled: false, message: ouvert.message }

  const kind = motif.data()
  if (!motif.exists || kind?.['isActive'] !== true) {
    throw new HttpsError(
      'failed-precondition',
      "Ce motif de rendez-vous n'existe plus. Demandez à un soignant.",
    )
  }

  /*
    La personne demandée doit exister, tenir ce motif, et passer dans l'unité du patient.

    Les trois se vérifient ensemble parce qu'ils disent la même chose : cette personne
    peut-elle réellement recevoir ce patient ? Proposer un nom qui ne le peut pas, ce
    serait promettre un rendez-vous qui n'aura pas lieu. Le message reste en français
    simple : il remonte jusqu'à l'écran d'un patient.
  */
  if (practitionerId !== null) {
    const donnees = fiche?.data()
    const sert =
      donnees?.['audience'] !== 'services' ||
      (Array.isArray(donnees['serviceIds']) && donnees['serviceIds'].includes(patient.serviceId))
    if (fiche?.exists !== true || donnees?.['isActive'] !== true || donnees['kindId'] !== kindId || !sert) {
      throw new HttpsError(
        'failed-precondition',
        "Cette personne ne peut pas vous recevoir. Choisissez-en une autre, ou laissez l'équipe choisir.",
      )
    }
  }

  /*
    Une seule demande à la fois pour un même professionnel.

    Sans cela, quelqu'un d'inquiet qui appuie trois fois se retrouverait avec trois
    rendez-vous — et, depuis l'acceptation automatique, trois créneaux réellement pris
    dans l'agenda de quelqu'un. Le garde-fou vaut mieux ici que dans l'écran : l'écran
    peut être contourné, pas la fonction.
  */
  const enCours = deja.docs.find((d) => {
    const data = d.data()
    if (data['status'] === 'requested') return true
    const jour = data['localDate'] as LocalDate | undefined
    return data['status'] === 'scheduled' && jour !== undefined && jour >= aujourdHui
  })
  if (enCours !== undefined) {
    /*
      « Vous avez déjà un rendez-vous prévu avec cette personne » s'écrivait même pour une
      simple demande en attente, et même quand aucune personne n'avait été choisie — la
      garde porte sur le motif, pas sur quelqu'un. La phrase dit maintenant laquelle des
      deux situations on lui oppose.
    */
    const nom = (motif.data()?.['name'] as string | undefined) ?? ''
    return {
      ok: false,
      scheduled: false,
      message: alreadyAskedMessage(
        [{ id: kindId, name: nom, icon: '', isActive: true }],
        kindId,
        enCours.data()['status'] === 'requested' ? 'requested' : 'scheduled',
      ),
    }
  }

  const base = {
    patientUid: patient.uid,
    kindId,
    preference,
    createdAt: Timestamp.now(),
    /*
      Le nom demandé est porté par la demande elle-même.

      C'est lui qui la fait arriver dans la file de la personne nommée : un intervenant
      ne reçoit que les rendez-vous qui portent son identifiant — les règles le disent, et
      la requête aussi. Sans ce champ, la demande n'aurait été vue que par la bulle.
    */
    ...(practitionerId === null ? {} : { practitionerId }),
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
  serviceId: string,
  practitionerId: string | null,
  patientUid: string,
): Promise<{ practitionerId: string; name: string; slot: NonNullable<ReturnType<typeof findFirstSlot>> } | null> {
  // Le catalogue des intervenants tient en quelques dizaines de lignes : on le lit en
  // entier plutôt que de demander un index pour trois égalités.
  type Fiche = {
    id: string
    name?: string
    kindId?: string
    isActive?: boolean
    autoAccept?: boolean
    audience?: 'all' | 'services'
    serviceIds?: string[]
    availability?: AvailabilityWindow[]
  }
  const intervenants = await db().collection(COLLECTIONS.practitioners).get()
  const candidats: Fiche[] = intervenants.docs
    .map((d) => ({ ...(d.data() as Omit<Fiche, 'id'>), id: d.id }))
    .filter((p) => p.isActive === true && p.autoAccept === true && p.kindId === kindId)
    // Quelqu'un qui ne passe pas dans cette unité ne peut pas recevoir ce patient : lui
    // donner une place tout de suite serait poser un rendez-vous qui n'aura pas lieu.
    .filter((p) => p.audience !== 'services' || (p.serviceIds ?? []).includes(serviceId))
    /*
      Une personne a été demandée : elle seule, ou personne.

      Se rabattre sur un collègue parce qu'il a de la place ferait exactement le
      contraire de ce qui vient d'être demandé, et sans le dire. Sans place chez elle,
      la demande rejoint la file — c'est elle qui fixera, ou la bulle.
    */
    .filter((p) => practitionerId === null || p.id === practitionerId)
    .filter((p) => Array.isArray(p.availability) && p.availability.length > 0)
    .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '', 'fr'))
  if (candidats.length === 0) return null

  // Jamais aujourd'hui : voir `firstBookableDay`. La règle vit dans le domaine, et non
  // recopiée ici — c'est en la recopiant à moitié qu'elle a fini par manquer ailleurs.
  const depart = firstBookableDay(todayLocalDate())
  const jusque = addLocalDays(depart, AUTO_HORIZON_DAYS)

  /*
    Les agendas des candidats se lisent tous en même temps.

    On les parcourait l'un après l'autre en s'arrêtant au premier qui avait de la place :
    économe en lectures, coûteux en attente — avec trois psychiatres, c'étaient trois
    allers-retours en file avant que le patient n'ait sa réponse. On lit tout d'un coup et
    l'on garde le premier dans l'ordre, qui est le même qu'avant.
  */
  // Les congés des candidats, lus en même temps que leurs agendas : un jour d'absence
  // ne doit pas retenir de place, même quand la plage du jour est libre.
  const congesDesCandidats = await Promise.all(candidats.map((candidat) => congesDe(candidat.id)))

  /*
    Ce que le patient a déjà.

    L'acceptation automatique posait tranquillement un rendez-vous par-dessus l'atelier
    auquel la personne était inscrite : « Ma semaine » affichait les deux au même moment,
    sans un mot, et c'est elle qui devait choisir. Un soignant qui fixe à la main recevait
    déjà cet agenda ; la machine n'a aucune raison d'être moins prudente.
  */
  const occupePatient: BusySlot[] = (await busyBetween(db(), patientUid, depart, jusque)).map(
    (entree) => ({
      localDate: localDateOf(entree.start),
      from: localTimeOf(entree.start),
      to: localTimeOf(entree.end),
    }),
  )

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
      patientBusy: occupePatient,
      preference,
      from: depart,
      horizonDays: AUTO_HORIZON_DAYS,
      durationMin: AUTO_DURATION_MIN,
      leaves: congesDesCandidats[index] ?? [],
    })
    if (slot !== null) {
      return { practitionerId: candidat.id, name: candidat.name ?? 'un professionnel', slot }
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Les idées des patients
// ---------------------------------------------------------------------------

/**
 * Proposer une activité.
 *
 * Le programme se construit pour les patients ; rien n'oblige à ce qu'il se construise
 * sans eux. Quelqu'un qui sait jouer aux échecs, qui tricote ou qui connaît un jeu peut
 * proposer une séance, et l'animer s'il s'en sent capable et si l'équipe est d'accord.
 *
 * L'écriture ne peut pas venir du navigateur. Deux raisons, et les règles Firestore
 * l'interdisent : la longueur des textes se vérifie ici — un champ libre est le
 * réceptacle naturel du contenu clinique, et on le tient court — et l'on ne dépose
 * qu'une idée à la fois, sans quoi une file où la même personne en met dix cesse d'être
 * lue, aux dépens des autres.
 *
 * Le prénom est recopié sur l'idée : la collection des patients n'est lisible par aucun
 * client, pas même par l'administrateur, et il doit pourtant savoir à qui il répond.
 */
export const proposeActivity = onCall(async (request: CallableRequest) => {
  const patient = requirePatient(request)
  // Réveil : voir `register`. L'écran le demande en s'affichant — on écrit deux phrases
  // avant d'appuyer, ce qui laisse tout le temps.
  if (request.data?.warm === true) return { ok: true, warmed: true }

  const brouillon = cleanProposal({
    title: requireString(request.data?.title, 'title', TITLE_MAX),
    description: requireString(request.data?.description, 'description', DESCRIPTION_MAX),
    wantsToLead: request.data?.wantsToLead === true,
  })
  const valide = validateProposal(brouillon)
  if (!valide.ok) return { ok: false, message: valide.message }

  // Les idées de cette personne, et sa fiche : deux lectures indépendantes.
  const [ouvert, siennes, fiche] = await Promise.all([
    patientMay('proposeActivity', patient.uid),
    db().collection(COLLECTIONS.proposals).where('patientUid', '==', patient.uid).get(),
    db().collection(COLLECTIONS.patients).doc(patient.uid).get(),
  ])
  if (!ouvert.ok) return { ok: false, message: ouvert.message }
  const dejaEnAttente = alreadyWaiting(
    siennes.docs.map((d) => ({
      ...(d.data() as Omit<ActivityProposal, 'id' | 'createdAt'>),
      id: d.id,
      createdAt: new Date(0),
    })),
    patient.uid,
  )
  if (dejaEnAttente) {
    return {
      ok: false,
      message: 'Vous avez déjà une idée en attente. Un soignant va la lire, puis vous pourrez en proposer une autre.',
    }
  }

  const reference = db().collection(COLLECTIONS.proposals).doc()
  await reference.set({
    patientUid: patient.uid,
    patientFirstName: (fiche.data()?.['firstName'] as string | undefined) ?? 'Prénom inconnu',
    serviceId: patient.serviceId ?? '',
    title: brouillon.title,
    description: brouillon.description,
    wantsToLead: brouillon.wantsToLead,
    status: 'proposed',
    createdAt: Timestamp.now(),
  })

  return { ok: true, id: reference.id, message: 'Votre idée est envoyée. Un soignant va la lire.' }
})

/**
 * Répondre à une idée : la retenir, ou non.
 *
 * Réservé à l'administrateur — c'est lui qui construit le programme. Un refus demande un
 * motif : « non » sans raison décourage plus sûrement que le refus lui-même, et la
 * personne qui a proposé lira cette phrase telle quelle.
 *
 * La même idée peut être décidée deux fois avec le même verdict : c'est ainsi que
 * l'activité créée à partir d'une idée acceptée vient s'y rattacher, une fois qu'elle
 * existe. Changer d'avis après coup, en revanche, ne se fait pas ici.
 */
export const decideProposal = onCall(async (request: CallableRequest) => {
  const staff = requireAdmin(request)
  const proposalId = requireString(request.data?.proposalId, 'proposalId')
  const decision = request.data?.decision
  if (decision !== 'accepted' && decision !== 'declined') {
    throw new HttpsError('invalid-argument', 'Répondez « accepted » ou « declined ».')
  }
  const activityId = typeof request.data?.activityId === 'string' ? request.data.activityId : null
  const motif =
    typeof request.data?.declineReason === 'string' ? request.data.declineReason.trim().slice(0, 300) : ''
  if (decision === 'declined' && motif.length < 3) {
    return {
      ok: false,
      message: 'Dites en une phrase pourquoi cette idée n’est pas retenue. Elle sera lue telle quelle.',
    }
  }

  const reference = db().collection(COLLECTIONS.proposals).doc(proposalId)
  const snapshot = await reference.get()
  if (!snapshot.exists) return { ok: false, message: "Cette idée n'existe plus." }
  const dejaDecidee = snapshot.data()?.['status'] as string | undefined
  if (dejaDecidee !== 'proposed' && dejaDecidee !== decision) {
    return { ok: false, message: 'Cette idée a déjà reçu une réponse.' }
  }

  await reference.set(
    {
      status: decision,
      decidedAt: Timestamp.now(),
      decidedBy: staff.uid,
      ...(decision === 'declined' ? { declineReason: motif } : {}),
      ...(activityId === null ? {} : { activityId }),
    },
    { merge: true },
  )

  return {
    ok: true,
    message:
      decision !== 'accepted'
        ? 'Réponse enregistrée. La personne lira votre phrase.'
        : /*
            « Créez l'activité » s'affichait encore après l'avoir créée : la décision est
            enregistrée à la fin de l'enregistrement, et son message recouvrait celui de
            la création.
          */
          activityId === null
          ? 'Idée retenue. Créez l’activité : le titre et la description sont recopiés.'
          : 'Idée retenue, et l’activité est créée. La personne qui l’a proposée le lira.',
  }
})

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
 * Une séance supprimée définitivement devient une exception de la série.
 *
 * Sans cela, elle revenait au premier enregistrement suivant de l'activité — au même
 * jour, à la même heure — et la suppression n'avait été définitive que pour les
 * inscriptions. On supprime une séance parce qu'elle ne doit pas avoir lieu ; changer
 * ensuite le lieu de l'activité la ramenait au programme des patients.
 *
 * Une activité ponctuelle n'a pas de récurrence à laquelle accrocher l'exception : on la
 * retire du programme, ce qui revient au même — elle n'avait qu'une séance.
 */
async function oublierCeJour(activityId: string, localDate: string): Promise<void> {
  if (activityId === '' || localDate === '') return
  const reference = db().collection(COLLECTIONS.activities).doc(activityId)
  const snapshot = await reference.get()
  if (!snapshot.exists) return
  const donnees = snapshot.data() ?? {}
  const recurrence = donnees['recurrence'] as { skipDates?: string[] } | null | undefined
  if (recurrence === null || recurrence === undefined) {
    await reference.update({ isActive: false })
    return
  }
  const sautees = recurrence.skipDates ?? []
  if (sautees.includes(localDate)) return
  await reference.update({ recurrence: { ...recurrence, skipDates: [...sautees, localDate].sort() } })
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
  await oublierCeJour(
    (donnees['activityId'] as string | undefined) ?? '',
    (donnees['localDate'] as string | undefined) ?? '',
  )

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

/**
 * L'unité de soins à laquelle un compte du personnel se rattache.
 *
 * L'hôpital n'a pas un poste d'administration mais plusieurs : une bulle par unité —
 * La Couturelle, La Joncquerelle, Le Mazurel… Chacune s'occupe de ses patients. Sans
 * ce réglage, chaque écran s'ouvrait sur l'hôpital entier et il fallait re-choisir son
 * unité partout, à chaque fois, sur chaque poste.
 *
 * Ce n'est **pas un droit** : le compte garde exactement ce qu'il avait, et une case à
 * l'écran lui rend l'hôpital entier. Une cloison véritable se poserait dans le jeton et
 * dans les règles, jamais dans un champ que l'écran peut ignorer.
 *
 * Chacun règle le sien, et personne d'autre : ce n'est pas une attribution de poste,
 * c'est le réglage de son propre écran. L'écriture passe tout de même par ici — le
 * document `staff/` porte le rôle, et un document que le navigateur peut écrire n'est
 * plus une référence.
 */
export const setMyUnit = onCall(async (request: CallableRequest) => {
  const staff = requireStaff(request)
  const brut = request.data?.serviceId
  const serviceId = typeof brut === 'string' && brut.trim() !== '' ? brut.trim() : null

  if (serviceId !== null) {
    // Un identifiant qui ne correspond à rien viderait tous les écrans sans rien dire.
    const service = await db().collection(COLLECTIONS.services).doc(serviceId).get()
    if (!service.exists) {
      throw new HttpsError('not-found', "Cette unité n'existe pas. Choisissez-en une dans la liste.")
    }
  }

  await db()
    .collection(COLLECTIONS.staff)
    .doc(staff.uid)
    .set({ serviceId, updatedAt: FieldValue.serverTimestamp() }, { merge: true })

  return {
    ok: true,
    message:
      serviceId === null
        ? "Votre compte n'est plus rattaché à une unité : vous voyez tout l'hôpital."
        : 'Votre unité est enregistrée.',
  }
})

// ---------------------------------------------------------------------------
// Les congés du personnel
// ---------------------------------------------------------------------------

/**
 * Qui peut déclarer un congé pour qui.
 *
 * Chacun le sien — il est le premier à savoir quand il s'absente — et l'administrateur
 * pour tout le monde, parce qu'une absence se sait parfois à la bulle avant d'être
 * saisie par l'intéressé. C'est le même partage que pour les disponibilités.
 */
function exigeDroitSurLesConges(request: CallableRequest, practitionerId: string): void {
  const staff = requireStaff(request)
  if (staff.role === 'admin' || staff.practitionerId === practitionerId) return
  throw new HttpsError(
    'permission-denied',
    "Vous ne pouvez déclarer un congé que pour vous-même. Demandez à un administrateur.",
  )
}

/** Les congés enregistrés pour une personne, remis en ordre. */
async function congesDe(practitionerId: string): Promise<Leave[]> {
  const document = await db().collection(COLLECTIONS.leaves).doc(practitionerId).get()
  const brut = document.data()?.['leaves']
  return normalizeLeaves(Array.isArray(brut) ? (brut as Leave[]) : [])
}

/**
 * Ce qu'un congé bousculerait : les rendez-vous déjà fixés pendant ces jours-là.
 *
 * On les nomme avant de rien faire. Déclarer une absence est un geste courant ; effacer
 * sans le dire la date que trois personnes attendaient ne doit pas l'être.
 */
async function rendezVousPendant(
  practitionerId: string,
  leave: Leave,
): Promise<{ id: string; patientUid: string; localDate: LocalDate; start?: Date; end?: Date }[]> {
  const snapshot = await db()
    .collection(COLLECTIONS.appointments)
    .where('practitionerId', '==', practitionerId)
    .where('status', '==', 'scheduled')
    .where('localDate', '>=', leave.from)
    .where('localDate', '<=', leave.to)
    .get()
  const maintenant = Date.now()
  return snapshot.docs
    .map((document) => {
      const data = document.data()
      const debut = data['start'] as Timestamp | undefined
      const fin = data['end'] as Timestamp | undefined
      return {
        id: document.id,
        patientUid: (data['patientUid'] as string | undefined) ?? '',
        localDate: (data['localDate'] as LocalDate | undefined) ?? leave.from,
        ...(debut === undefined ? {} : { start: debut.toDate() }),
        ...(fin === undefined ? {} : { end: fin.toDate() }),
      }
    })
    // Un rendez-vous déjà passé n'a pas à retourner dans la file : il a eu lieu.
    .filter((rendezVous) => {
      const fin = rendezVous.end ?? rendezVous.start
      return fin === undefined || fin.getTime() >= maintenant
    })
}

/**
 * Le motif inscrit sur une séance annulée par un congé.
 *
 * « L'animateur est absent », et non « Congé » : c'est la personne inscrite qui le lira,
 * et le vocabulaire est déjà celui de l'application — un rendez-vous rouvert lui dit
 * exactement la même chose. Ce motif figure d'ailleurs déjà dans la liste que l'écran
 * d'annulation propose : on n'en invente pas un second pour dire la même chose.
 */
const MOTIF_ABSENCE = "L'animateur est absent"

/**
 * Ce que la période porte, en une phrase.
 *
 * Le nombre d'abord, la nature ensuite : « 3 séances et 1 rendez-vous » se lit d'un
 * coup d'œil, là où « des activités et des rendez-vous » oblige à aller compter plus bas.
 */
function cePeriodePorte(rendezVous: number, seances: number): string {
  const bouts: string[] = []
  // « que vous animez » s'écrivait même quand un administrateur déclare le congé de
  // quelqu'un d'autre, ce qui est le cas courant.
  if (seances > 0) {
    bouts.push(
      seances === 1 ? 'une séance animée par cette personne' : `${seances} séances animées par cette personne`,
    )
  }
  if (rendezVous > 0) bouts.push(rendezVous === 1 ? 'un rendez-vous fixé' : `${rendezVous} rendez-vous fixés`)
  return `Ce congé tombe sur ${bouts.join(' et ')}.`
}

/**
 * Déclarer un congé.
 *
 * En deux temps quand des rendez-vous sont déjà fixés pendant ces jours-là : le premier
 * appel ne modifie rien et rend la liste de ce qui serait bousculé ; l'écran la montre,
 * et c'est un humain qui tranche. Le second appel, avec `force`, enregistre et rouvre.
 *
 * « Rouvrir » plutôt qu'« annuler » : le patient a demandé à voir quelqu'un, et cette
 * demande tient toujours — c'est la date qui ne tient plus. La demande retourne donc
 * dans la file, avec le nom de la personne, et sera refixée. L'annuler obligerait le
 * patient à tout recommencer pour une absence dont il n'est pour rien.
 *
 * Les activités animées pendant le congé sont **comptées, jamais touchées** : une séance
 * a des inscrits, et l'annuler est une décision qui se prend séance par séance, avec un
 * motif. L'écran dit combien il y en a ; c'est déjà ce qu'on oublie.
 */
export const declareLeave = onCall(async (request: CallableRequest) => {
  const practitionerId = requireString(request.data?.practitionerId, 'practitionerId')
  exigeDroitSurLesConges(request, practitionerId)

  const leave: Leave = {
    from: requireString(request.data?.from, 'from', 10),
    to: requireString(request.data?.to, 'to', 10),
  }
  const refus = leaveRefusal(leave, todayLocalDate())
  if (refus !== null) throw new HttpsError('invalid-argument', refus)

  const fiche = await db().collection(COLLECTIONS.practitioners).doc(practitionerId).get()
  if (!fiche.exists) throw new HttpsError('not-found', "Cette personne n'a pas été trouvée.")

  const [enCours, seances] = await Promise.all([
    rendezVousPendant(practitionerId, leave),
    db()
      .collection(COLLECTIONS.occurrences)
      .where('localDate', '>=', leave.from)
      .where('localDate', '<=', leave.to)
      .get(),
  ])
  /*
    Les séances que cette personne anime pendant le congé.

    Elles n'étaient que comptées, et seulement quand un rendez-vous déclenchait déjà
    l'avertissement : déclarer un congé sur une journée qui ne portait qu'un atelier ne
    demandait donc rien du tout, et l'atelier restait au programme sans personne pour
    l'animer. Constaté en service.
  */
  /*
    Seulement les séances qui n'ont pas encore eu lieu.

    « Annuler » veut dire « n'aura pas lieu » : une séance de ce matin a eu lieu, et les
    personnes qui y sont allées n'ont pas à lire qu'elle a été annulée. Le cas se pose dès
    qu'un congé a commencé — on tombe malade sans prévenir, et c'est le lendemain qu'on
    le déclare.
  */
  const maintenant = Date.now()
  const animees = seances.docs
    .filter((d) => {
      const data = d.data()
      const fin = (data['end'] as Timestamp | undefined) ?? (data['start'] as Timestamp | undefined)
      if (fin !== undefined && fin.toMillis() < maintenant) return false
      return data['facilitatorId'] === practitionerId && data['status'] === 'scheduled'
    })
    .map((d) => {
      const data = d.data()
      const debut = data['start'] as Timestamp | undefined
      const fin = data['end'] as Timestamp | undefined
      return {
        occurrenceId: d.id,
        title: (data['title'] as string | undefined) ?? 'Activité',
        localDate: (data['localDate'] as LocalDate | undefined) ?? leave.from,
        confirmedCount: (data['confirmedCount'] as number | undefined) ?? 0,
        ...(debut === undefined ? {} : { start: debut.toDate().toISOString() }),
        ...(fin === undefined ? {} : { end: fin.toDate().toISOString() }),
      }
    })
    .sort((a, b) => a.localDate.localeCompare(b.localDate))

  if ((enCours.length > 0 || animees.length > 0) && request.data?.force !== true) {
    // On ne touche à rien : l'écran nomme ce qui va bouger, et un humain confirme.
    const prenoms = await Promise.all(
      enCours.map(async (rendezVous) => {
        const patient = await db().collection(COLLECTIONS.patients).doc(rendezVous.patientUid).get()
        return (patient.data()?.['firstName'] as string | undefined) ?? 'Prénom inconnu'
      }),
    )
    return {
      ok: false,
      needsConfirmation: true,
      activityCount: animees.length,
      sessions: animees,
      conflicts: enCours.map((rendezVous, rang) => ({
        appointmentId: rendezVous.id,
        firstName: prenoms[rang] ?? 'Prénom inconnu',
        localDate: rendezVous.localDate,
        start: rendezVous.start?.toISOString(),
        end: rendezVous.end?.toISOString(),
      })),
      message: cePeriodePorte(enCours.length, animees.length),
    }
  }

  /*
    Annuler les séances est un choix, laissé à qui déclare le congé.

    Coché, c'est le cas courant : personne ne les anime plus. Décoché, c'est qu'un
    collègue les assure — l'application n'a aucun moyen de le deviner, et annuler une
    séance à laquelle des gens sont inscrits ne se fait pas par défaut sans le dire.

    Le motif est « L'animateur est absent », et non « Congé » : c'est ce que la personne
    inscrite lira, et le vocabulaire est déjà celui de l'application — un rendez-vous
    rouvert lui dit exactement la même chose.
  */
  const annulerLesSeances = request.data?.cancelSessions === true
  const aAnnuler = annulerLesSeances ? animees : []

  const suivants = normalizeLeaves([...(await congesDe(practitionerId)), leave])
  const batch = db().batch()
  batch.set(
    db().collection(COLLECTIONS.leaves).doc(practitionerId),
    { leaves: suivants, updatedAt: FieldValue.serverTimestamp() },
    { merge: true },
  )
  for (const seance of aAnnuler) {
    batch.update(db().collection(COLLECTIONS.occurrences).doc(seance.occurrenceId), {
      status: 'cancelled',
      cancellationReason: MOTIF_ABSENCE,
      // La séance a été touchée à la main : une régénération de la série l'épargne.
      overridden: true,
      // Annulée par une décision humaine, et non par la régénération : elle ne se
      // rétablit pas toute seule quand la série repasse dessus.
      autoCancelled: false,
      // C'est ce congé-ci qui l'a barrée : le retirer la rétablira, et lui seul.
      cancelledByLeave: true,
    })
  }
  for (const rendezVous of enCours) {
    batch.update(db().collection(COLLECTIONS.appointments).doc(rendezVous.id), {
      status: 'requested',
      /*
        La date s'efface, le reste demeure. Le nom de la personne surtout : c'est lui qui
        ramène la demande dans sa file — et rouvrir une demande pour qu'elle n'atterrisse
        nulle part ne vaudrait pas mieux que l'annuler.
      */
      start: FieldValue.delete(),
      end: FieldValue.delete(),
      localDate: FieldValue.delete(),
      withWhom: FieldValue.delete(),
      locationId: FieldValue.delete(),
      autoAccepted: FieldValue.delete(),
      // Ce que le patient lira, à la place d'une date disparue sans explication.
      reopenedForLeave: true,
    })
  }
  await batch.commit()

  logger.info('Congé déclaré', {
    practitionerId,
    from: leave.from,
    to: leave.to,
    rouverts: enCours.length,
    seancesAnnulees: aAnnuler.length,
  })

  return {
    ok: true,
    reopened: enCours.length,
    cancelledSessions: aAnnuler.length,
    activityCount: animees.length,
    message: congeEnregistre(enCours.length, aAnnuler.length),
  }
})

/** Ce que la déclaration a réellement fait, en une phrase. */
function congeEnregistre(rouverts: number, seances: number): string {
  const bouts: string[] = []
  if (seances > 0) {
    bouts.push(seances === 1 ? 'Une séance est annulée' : `${seances} séances sont annulées`)
  }
  if (rouverts > 0) {
    bouts.push(
      rouverts === 1
        ? 'un rendez-vous est remis dans la file et doit être refixé'
        : `${rouverts} rendez-vous sont remis dans la file et doivent être refixés`,
    )
  }
  if (bouts.length === 0) {
    return 'Le congé est enregistré. Aucun rendez-vous ne sera proposé sur ces jours.'
  }
  // La majuscule se remet ici : les morceaux sont fabriqués en minuscule, et
  // « Le congé est enregistré. un rendez-vous… » se lisait mal.
  return `Le congé est enregistré. ${phrase(bouts.join(', et '))}.`
}

/**
 * Retirer un congé.
 *
 * Les séances que ce congé avait annulées sont rétablies. Elles restaient barrées, avec
 * le motif « L'animateur est absent », alors que l'animateur n'était plus en congé — et
 * le message ne parlait que des rendez-vous, laissant croire que tout le reste était
 * revenu à la normale. Un soignant qui se trompe de personne ou de dates doit pouvoir
 * revenir en arrière.
 *
 * Seules celles-là : une séance annulée pour une autre raison, ou par quelqu'un d'autre,
 * n'a rien à voir avec ce congé. Et seules celles à venir : rétablir une séance de la
 * semaine dernière ne rétablit rien.
 *
 * Les rendez-vous rouverts, eux, ne se referment pas : ils sont retournés dans la file,
 * quelqu'un s'en occupe peut-être déjà, et les remettre à leur ancienne date sans
 * prévenir ferait deux rendez-vous là où il n'en faut qu'un. Ce qu'un congé a déplacé se
 * refixe à la main.
 */
export const removeLeave = onCall(async (request: CallableRequest) => {
  const practitionerId = requireString(request.data?.practitionerId, 'practitionerId')
  exigeDroitSurLesConges(request, practitionerId)
  const leave: Leave = {
    from: requireString(request.data?.from, 'from', 10),
    to: requireString(request.data?.to, 'to', 10),
  }

  const suivants = withoutLeave(await congesDe(practitionerId), leave)
  await db()
    .collection(COLLECTIONS.leaves)
    .doc(practitionerId)
    .set({ leaves: suivants, updatedAt: FieldValue.serverTimestamp() }, { merge: true })

  const retablies = await retablirLesSeancesDuConge(practitionerId, leave)
  const seances =
    retablies === 0
      ? ''
      : retablies === 1
        ? ' Une séance annulée pour ce congé est rétablie.'
        : ` ${retablies} séances annulées pour ce congé sont rétablies.`

  return {
    ok: true,
    message: `Le congé est retiré.${seances} Les rendez-vous déjà remis dans la file y restent : ils se refixent à la main.`,
  }
})

/** Vrai quand cette activité figure toujours au programme. */
async function activiteAuProgramme(activityId: string): Promise<boolean> {
  const fiche = await db().collection(COLLECTIONS.activities).doc(activityId).get()
  return fiche.exists && (fiche.data() ?? {})['isActive'] !== false
}

/** Rétablit les séances à venir que ce congé avait barrées, et rend leur nombre. */
async function retablirLesSeancesDuConge(practitionerId: string, leave: Leave): Promise<number> {
  const aujourdHui = todayLocalDate()
  const maintenant = Date.now()
  const depart = leave.from > aujourdHui ? leave.from : aujourdHui
  if (depart > leave.to) return 0

  const seances = await db()
    .collection(COLLECTIONS.occurrences)
    .where('localDate', '>=', depart)
    .where('localDate', '<=', leave.to)
    .get()

  /*
    Par paquets, comme partout ailleurs : Firestore refuse au-delà de cinq cents
    opérations par lot, et un congé d'un mois sur une activité quotidienne les dépasse.
  */
  const aRetablir: FirebaseFirestore.DocumentReference[] = []
  for (const document of seances.docs) {
    const data = document.data() as {
      status?: string
      cancellationReason?: string
      facilitatorId?: string
      cancelledByLeave?: boolean
      activityId?: string
      start?: Timestamp
      end?: Timestamp
    }
    if (data.status !== 'cancelled') continue
    /*
      Le passé ne se rétablit pas plus qu'il ne s'annule : la déclaration épargne déjà
      les séances terminées à l'instant près, et non à la journée.
    */
    const fin = (data.end as Timestamp | undefined) ?? (data.start as Timestamp | undefined)
    if (fin !== undefined && fin.toMillis() < maintenant) continue
    /*
      L'activité doit toujours être au programme.

      Congé posé sur une séance, activité retirée du programme pendant l'absence, puis
      congé retiré : la séance réapparaissait dans le calendrier des patients, pour une
      activité que l'équipe avait décidé d'arrêter.
    */
    const activityId = (data.activityId as string | undefined) ?? ''
    if (activityId !== '' && !(await activiteAuProgramme(activityId))) continue
    // La marque, et non le texte du motif : « L'animateur est absent » est aussi l'un
    // des motifs que le bouton « Annuler cette séance » propose.
    if (data.cancelledByLeave !== true) continue
    if (data.facilitatorId !== practitionerId) continue
    /*
      La séance rentre dans sa série, et n'en sort pas.

      `overridden` et `autoCancelled` se retirent tous les deux, comme au rétablissement
      à la main. Sans cela, la séance rétablie restait marquée « modifiée isolément » :
      elle gardait à jamais l'ancien titre, l'ancien lieu et l'ancienne heure.
    */
    aRetablir.push(document.ref)
  }
  for (let i = 0; i < aRetablir.length; i += 400) {
    const lot = db().batch()
    for (const reference of aRetablir.slice(i, i + 400)) {
      lot.update(reference, {
        status: 'scheduled',
        cancellationReason: FieldValue.delete(),
        overridden: false,
        autoCancelled: false,
        cancelledByLeave: FieldValue.delete(),
      })
    }
    await lot.commit()
  }
  return aRetablir.length
}

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
