/**
 * Ports de l'espace soignant. Comme pour le patient, l'interface ne connaît que ceci —
 * jamais Firebase. Deux adapters les implémentent : `firestore/` et `mock/`.
 */
import type { Activity, LocalDate, Occurrence, RegistrationStatus } from '../domain/types'

export type StaffRole = 'staff' | 'admin'

export type StaffIdentity = {
  uid: string | null
  email: string | null
  firstName: string | null
  role: StaffRole | null
}

export interface StaffSessionService {
  current(): StaffIdentity
  signIn(email: string, password: string): Promise<{ ok: true } | { ok: false; message: string }>
  signOut(): Promise<void>
}

/** Ce qu'un soignant saisit. L'identifiant et la série sont attribués à l'enregistrement. */
export type ActivityDraft = Omit<Activity, 'id' | 'seriesId'> & { id?: string; seriesId?: string }

/** Ce que la génération a fait, pour pouvoir le dire au soignant en toutes lettres. */
export type GenerationReport = {
  created: number
  updated: number
  preserved: number
  cancelled: number
  removed: number
}

/** Portée d'une modification, comme dans un agenda classique. */
export type EditScope = 'occurrence' | 'following' | 'series'

export type RosterLine = {
  patientUid: string
  firstName: string
  serviceId: string | null
  status: Exclude<RegistrationStatus, 'cancelled'>
  position: number | null
}

export interface StaffRepository {
  listActivities(): Promise<Activity[]>
  getActivity(activityId: string): Promise<Activity | null>

  /**
   * Enregistre l'activité **et** matérialise ses occurrences sur la fenêtre glissante.
   * Sur le plan gratuit, il n'y a pas de Cloud Function pour le faire : c'est cet appel
   * qui s'en charge, avec exactement les mêmes fonctions pures du domaine.
   */
  saveActivity(draft: ActivityDraft): Promise<{ activityId: string; report: GenerationReport }>

  /** Désactive une activité : ses occurrences futures sans inscrit disparaissent, les autres sont annulées. */
  setActivityActive(activityId: string, isActive: boolean): Promise<GenerationReport>

  /** Duplique une activité existante, en la laissant inactive tant qu'elle n'est pas relue. */
  duplicateActivity(activityId: string): Promise<string>

  /** Le calendrier du personnel : tout le programme, sans filtre de service. */
  listOccurrences(from: LocalDate, to: LocalDate): Promise<Occurrence[]>

  /** Annulation en deux clics, avec motif. Jamais une suppression. */
  cancelOccurrence(occurrenceId: string, reason: string): Promise<void>
  restoreOccurrence(occurrenceId: string): Promise<void>

  /** Liste des inscrits. Vide tant que les inscriptions ne sont pas en service. */
  roster(occurrenceId: string): Promise<RosterLine[]>
}

/** Réservé à l'administrateur : ajouter un lieu, un service, une catégorie. */
export interface CatalogAdminService {
  saveLocation(location: { id: string; name: string; accessNotes?: string; building?: string; isActive: boolean }): Promise<void>
  saveService(service: { id: string; name: string; isActive: boolean }): Promise<void>
  saveCategory(category: { id: string; name: string; icon: string; colorToken: string }): Promise<void>
}

export type StaffApp = {
  session: StaffSessionService
  repository: StaffRepository
  catalogAdmin: CatalogAdminService
}
