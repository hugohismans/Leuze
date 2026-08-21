import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { onDocumentWritten } from 'firebase-functions/v2/firestore'
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import { defineSecret } from 'firebase-functions/params'
import { setGlobalOptions } from 'firebase-functions/v2/options'
import { logger } from 'firebase-functions'

import { requireAdmin, requirePatient, requireStaff, requireString } from './lib/auth'
import { CODE_LENGTH, formatCodeForPrint, generateCode, hashCode, newPatientUid } from './lib/codes'
import { auth, COLLECTIONS, db } from './lib/firestore'
import { generationWindow, regenerateActivity, regenerateAll } from './lib/occurrences'
import { assertNotRateLimited, clearFailures, recordFailure } from './lib/rateLimit'
import { myRegistrationsFor, promoteTx, registerTx, rosterFor, unregisterTx } from './lib/registration'
import { attendanceRefusal, canMarkAttendance } from './domain/attendance'
import { planActivityRemoval, planRemoval, type CatalogKind } from './domain/catalog'
import type { LocalDate } from './domain/types'

/**
 * Bruxelles : les fonctions vivent au plus près des données et des utilisateurs.
 *
 * `maxInstances` est délibérément bas. Chaque instance réserve un CPU, et le quota de
 * CPU par région d'un projet neuf se compte en dizaines : dix-huit fonctions à dix
 * instances en réclameraient cent quatre-vingts, et une partie d'entre elles échoue
 * alors à se créer. Trois suffisent très largement — un hôpital de 133 lits, c'est
 * quelques dizaines d'appels par jour, jamais simultanés.
 */
setGlobalOptions({ region: 'europe-west1', maxInstances: 3 })

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
  const occurrenceId = requireString(request.data?.occurrenceId, 'occurrenceId')
  return registerTx(db(), {
    occurrenceId,
    patientUid: patient.uid,
    by: 'patient',
    serviceId: patient.serviceId,
  })
})

export const unregister = onCall(async (request: CallableRequest) => {
  const patient = requirePatient(request)
  const occurrenceId = requireString(request.data?.occurrenceId, 'occurrenceId')
  return unregisterTx(db(), { occurrenceId, patientUid: patient.uid })
})

/** Les inscriptions du patient connecté, avec sa position en liste d'attente. */
export const myRegistrations = onCall(async (request: CallableRequest) => {
  const patient = requirePatient(request)
  return { registrations: await myRegistrationsFor(db(), patient.uid) }
})

/** Le soignant inscrit quelqu'un à sa place — un patient sans borne, une demande orale. */
export const staffRegister = onCall(async (request: CallableRequest) => {
  requireStaff(request)
  const occurrenceId = requireString(request.data?.occurrenceId, 'occurrenceId')
  const patientUid = requireString(request.data?.patientUid, 'patientUid')
  return registerTx(db(), { occurrenceId, patientUid, by: 'staff' })
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
  const patientsSnapshot = await (serviceId === null
    ? collection.get()
    : collection.where('serviceId', '==', serviceId).get())
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

  const occurrences = await db()
    .collection(COLLECTIONS.occurrences)
    .where('localDate', '>=', from)
    .where('localDate', '<=', to)
    .get()

  // `in` accepte trente valeurs : on interroge par paquets.
  const parPatient = new Map<string, Array<{ occurrenceId: string; status: 'confirmed' | 'waitlist' }>>()
  const identifiants = occurrences.docs.map((d) => d.id)
  for (let i = 0; i < identifiants.length; i += 30) {
    const paquet = identifiants.slice(i, i + 30)
    const trouvees = await db()
      .collection(COLLECTIONS.registrations)
      .where('occurrenceId', 'in', paquet)
      .get()
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
  return { lines: await rosterFor(db(), occurrenceId, peutFaireAppel), canMarkAttendance: peutFaireAppel }
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
  const occurrenceId = requireString(request.data?.occurrenceId, 'occurrenceId')
  const patientUid = requireString(request.data?.patientUid, 'patientUid')
  const valeur = request.data?.attendance
  if (valeur !== 'present' && valeur !== 'absent' && valeur !== null) {
    throw new HttpsError('invalid-argument', 'La présence doit être « present », « absent » ou vide.')
  }

  const occurrenceSnapshot = await db().collection(COLLECTIONS.occurrences).doc(occurrenceId).get()
  const occurrence = occurrenceSnapshot.data() as
    | { facilitatorId?: string; facilitator?: string }
    | undefined
  if (occurrence === undefined) throw new HttpsError('not-found', "Cette activité n'a pas été trouvée.")
  if (!canMarkAttendance(staff, occurrence)) {
    throw new HttpsError('permission-denied', attendanceRefusal(occurrence))
  }

  const existantes = await db()
    .collection(COLLECTIONS.registrations)
    .where('occurrenceId', '==', occurrenceId)
    .where('patientUid', '==', patientUid)
    .get()
  const active = existantes.docs.find((d) => d.data()['status'] !== 'cancelled')

  if (active === undefined) {
    // Personne venue spontanément : on l'inscrit, puis on la note. L'inscription passe
    // par la transaction habituelle — la capacité et la liste d'attente s'appliquent.
    const resultat = await registerTx(db(), { occurrenceId, patientUid, by: 'staff', walkIn: true })
    if (!resultat.ok) return resultat
  }

  const aNoter = await db()
    .collection(COLLECTIONS.registrations)
    .where('occurrenceId', '==', occurrenceId)
    .where('patientUid', '==', patientUid)
    .get()
  const cible = aNoter.docs.find((d) => d.data()['status'] !== 'cancelled')
  if (cible === undefined) throw new HttpsError('failed-precondition', "L'inscription n'a pas été trouvée.")

  await cible.ref.set(
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
 * Échange d'un code contre une session. Le code n'est jamais comparé en clair et
 * n'est jamais l'objet d'une requête : son empreinte *est* l'identifiant du document.
 */
export const exchangeCode = onCall({ secrets: [CODE_PEPPER] }, async (request: CallableRequest) => {
  const raw = request.data?.code
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 32) {
    throw new HttpsError('invalid-argument', 'Saisissez le code inscrit sur votre feuille.')
  }
  const clientKey = request.rawRequest?.ip ?? 'inconnu'
  await assertNotRateLimited(clientKey)

  const codeSnapshot = await db().collection(COLLECTIONS.patientCodes).doc(hashCode(raw)).get()
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

  await clearFailures(clientKey)
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
  return { token, firstName: patient.firstName, serviceId: patient.serviceId }
})

/**
 * Supprime une activité, ses séances comprises — mais seulement si personne ne s'y est
 * jamais inscrit. Dès qu'une inscription existe, fût-elle annulée, l'activité est
 * seulement retirée du programme : la trace sert à répondre à « qui est venu ? », et une
 * inscription orpheline ne se rattacherait plus à rien.
 */
export const deleteActivity = onCall(async (request: CallableRequest) => {
  requireStaff(request)
  const activityId = requireString(request.data?.activityId, 'activityId', 200)

  const reference = db().collection(COLLECTIONS.activities).doc(activityId)
  const snapshot = await reference.get()
  if (!snapshot.exists) throw new HttpsError('not-found', "Cette activité n'existe plus.")
  const title = (snapshot.data()?.['title'] as string | undefined) ?? activityId

  const occurrences = await db()
    .collection(COLLECTIONS.occurrences)
    .where('activityId', '==', activityId)
    .get()

  // `in` accepte trente valeurs : on interroge par paquets plutôt que de faire confiance
  // aux compteurs dénormalisés, qui retombent à zéro après une annulation.
  let registrations = 0
  const identifiants = occurrences.docs.map((d) => d.id)
  for (let i = 0; i < identifiants.length && registrations === 0; i += 30) {
    const paquet = identifiants.slice(i, i + 30)
    const trouvees = await db()
      .collection(COLLECTIONS.registrations)
      .where('occurrenceId', 'in', paquet)
      .limit(50)
      .get()
    registrations += trouvees.size
  }

  const plan = planActivityRemoval(title, { registrations, sessions: occurrences.size })

  if (plan.action === 'deleted') {
    // Les séances d'abord : le déclencheur sur l'activité les régénérerait sinon.
    for (let i = 0; i < occurrences.docs.length; i += 400) {
      const batch = db().batch()
      for (const document of occurrences.docs.slice(i, i + 400)) batch.delete(document.ref)
      await batch.commit()
    }
    await reference.delete()
  } else {
    await reference.set({ isActive: false }, { merge: true })
  }

  logger.info('Activité retirée', { activityId, action: plan.action, registrations, sessions: occurrences.size })
  return plan
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
  if (kind !== 'location' && kind !== 'service' && kind !== 'category' && kind !== 'practitioner') {
    throw new HttpsError('invalid-argument', 'Genre inconnu.')
  }

  const collection =
    kind === 'location'
      ? COLLECTIONS.locations
      : kind === 'service'
        ? COLLECTIONS.services
        : kind === 'category'
          ? COLLECTIONS.categories
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

  const requeteActivites =
    champActivite === null
      ? db().collection(COLLECTIONS.activities).where('serviceIds', 'array-contains', id)
      : db().collection(COLLECTIONS.activities).where(champActivite, '==', id)
  const activites = await requeteActivites.limit(PLAFOND).get()

  const usage = {
    activities: activites.size,
    occurrences:
      champActivite === null
        ? await combien(db().collection(COLLECTIONS.occurrences).where('audienceKeys', 'array-contains', id))
        : await combien(db().collection(COLLECTIONS.occurrences).where(champActivite, '==', id)),
    patients:
      kind === 'service' ? await combien(db().collection(COLLECTIONS.patients).where('serviceId', '==', id)) : 0,
    appointments:
      kind === 'practitioner'
        ? await combien(db().collection(COLLECTIONS.appointments).where('practitionerId', '==', id))
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
    activityTitles: activites.docs.slice(0, 8).map((d) => (d.data()['title'] as string | undefined) ?? d.id),
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
  requireAdmin(request)
  const uid = requireString(request.data?.uid, 'uid')
  const role = request.data?.role
  if (role !== 'staff' && role !== 'admin' && role !== null) {
    throw new HttpsError('invalid-argument', 'Le rôle doit être « staff », « admin » ou vide.')
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
