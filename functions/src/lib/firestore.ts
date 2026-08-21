import { initializeApp, getApps } from 'firebase-admin/app'
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

export function db(): Firestore {
  if (cached) return cached
  if (getApps().length === 0) initializeApp()
  cached = getFirestore()
  // Les champs facultatifs du domaine (`facilitator`, `cancellationReason`) sont
  // `undefined` plutôt qu'absents : sans cette option, Firestore refuserait l'écriture.
  cached.settings({ ignoreUndefinedProperties: true })
  return cached
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
