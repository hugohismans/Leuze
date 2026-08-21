import { getApp, initializeApp, type App } from 'firebase-admin/app'
import { getAuth, type Auth } from 'firebase-admin/auth'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import type { DocumentData, DocumentSnapshot, Firestore } from 'firebase-admin/firestore'
import type { Activity, Occurrence, Registration } from '../domain/types'

/**
 * Réexporté pour que les tests écrivent leurs jeux d'essai avec *le même* `Timestamp`
 * que les fonctions : deux copies de `firebase-admin` produisent des instances que
 * Firestore refuse de sérialiser.
 */
export { Timestamp }

let cached: Firestore | null = null

/**
 * L'application d'administration par défaut, créée si elle n'existe pas encore.
 *
 * Ne jamais décider d'après `getApps()`. Dès qu'un appel est authentifié, le SDK des
 * fonctions initialise sa propre application — nommée `__FIREBASE_FUNCTIONS_SDK__` —
 * pour vérifier le jeton. `getApps()` cesse alors d'être vide alors que l'application
 * *par défaut*, elle, n'existe toujours pas : `getFirestore()` échouait sur « The
 * default Firebase app does not exist ». D'où un symptôme déroutant — toutes les
 * fonctions appelées par une personne connectée échouaient, les appels anonymes non.
 */
function defaultApp(): App {
  try {
    return getApp()
  } catch {
    return initializeApp()
  }
}

export function db(): Firestore {
  if (cached) return cached
  cached = getFirestore(defaultApp())
  // Les champs facultatifs du domaine (`facilitator`, `cancellationReason`) sont
  // `undefined` plutôt qu'absents : sans cette option, Firestore refuserait l'écriture.
  cached.settings({ ignoreUndefinedProperties: true })
  return cached
}

/** Même précaution que `db()` : l'authentification passe par l'application par défaut. */
export function auth(): Auth {
  return getAuth(defaultApp())
}

export const COLLECTIONS = {
  activities: 'activities',
  occurrences: 'occurrences',
  registrations: 'registrations',
  patients: 'patients',
  patientCodes: 'patientCodes',
  staff: 'staff',
  services: 'services',
  locations: 'locations',
  categories: 'categories',
  practitioners: 'practitioners',
  appointments: 'appointments',
  config: 'config',
} as const

/** Le domaine parle en `Date`, Firestore en `Timestamp`. La conversion vit ici, à la frontière. */

export function occurrenceToDoc(occurrence: Occurrence): DocumentData {
  const { start, end, ...rest } = occurrence
  return { ...rest, start: Timestamp.fromDate(start), end: Timestamp.fromDate(end) }
}

export function docToOccurrence(snapshot: DocumentSnapshot): Occurrence {
  const data = snapshot.data() as DocumentData
  return {
    ...(data as Omit<Occurrence, 'start' | 'end'>),
    id: snapshot.id,
    start: (data.start as Timestamp).toDate(),
    end: (data.end as Timestamp).toDate(),
  }
}

export function registrationToDoc(registration: Registration): DocumentData {
  const { createdAt, queuedAt, ...rest } = registration
  return { ...rest, createdAt: Timestamp.fromDate(createdAt), queuedAt: Timestamp.fromDate(queuedAt) }
}

export function docToRegistration(snapshot: DocumentSnapshot): Registration {
  const data = snapshot.data() as DocumentData
  return {
    ...(data as Omit<Registration, 'createdAt' | 'queuedAt'>),
    id: snapshot.id,
    createdAt: (data.createdAt as Timestamp).toDate(),
    queuedAt: (data.queuedAt as Timestamp).toDate(),
  }
}

export function docToActivity(snapshot: DocumentSnapshot): Activity {
  return { ...(snapshot.data() as Activity), id: snapshot.id }
}
