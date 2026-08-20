/**
 * Ports : la seule chose que l'interface connaît du monde extérieur.
 * Deux adapters les implémentent — `mock/` (écran de démonstration, tests)
 * et, au lot L1, `firestore/`. Aucun composant n'importe `firebase/*`.
 */
import type { Category, LocalDate, Location, Occurrence, Registration, Unit } from '../domain/types'

export interface CatalogRepository {
  listLocations(): Promise<Location[]>
  listCategories(): Promise<Category[]>
  listUnits(): Promise<Unit[]>
}

export interface OccurrenceRepository {
  /** Le calendrier n'a besoin que de cette requête : une fenêtre de dates locales. */
  listBetween(from: LocalDate, to: LocalDate): Promise<Occurrence[]>
  get(occurrenceId: string): Promise<Occurrence | null>
}

export type MyRegistration = {
  occurrence: Occurrence
  status: 'confirmed' | 'waitlist'
  /** Position dans la liste d'attente, à partir de 1. */
  position: number | null
}

export type RegisterResult =
  | { ok: true; status: 'confirmed' | 'waitlist'; position: number | null }
  | { ok: false; reason: string; message: string }

export interface RegistrationService {
  /** Uniquement les inscriptions du patient connecté. Jamais celles des autres. */
  listMine(): Promise<MyRegistration[]>
  statusFor(occurrenceId: string): Promise<MyRegistration | null>
  register(occurrenceId: string): Promise<RegisterResult>
  unregister(occurrenceId: string): Promise<{ ok: boolean; message: string }>
}

/** Réservé au personnel : la liste des inscrits n'est jamais lisible côté patient. */
export interface StaffRegistrationService {
  roster(occurrenceId: string): Promise<{ confirmed: Registration[]; waitlist: Registration[] }>
}

export type PatientSession = {
  patientUid: string | null
  firstName: string | null
}

export interface SessionService {
  current(): PatientSession
  /** Échange un code court contre une session. Côté Firestore, ce sera une Cloud Function. */
  signInWithCode(code: string): Promise<{ ok: true } | { ok: false; message: string }>
  signOut(): Promise<void>
}

export type AppRepository = {
  catalog: CatalogRepository
  occurrences: OccurrenceRepository
  registrations: RegistrationService
  session: SessionService
}
