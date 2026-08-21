/**
 * Ports de l'espace soignant. Comme pour le patient, l'interface ne connaît que ceci —
 * jamais Firebase. Deux adapters les implémentent : `firestore/` et `mock/`.
 */
import type { CatalogKind, CatalogRemoval } from '../domain/catalog'
import type {
  Activity,
  Appointment,
  LocalDate,
  LocalTime,
  Occurrence,
  RegistrationStatus,
} from '../domain/types'

/** Le planning d'une personne : son prénom, et ce à quoi elle est inscrite cette semaine. */
export type PatientPlanning = {
  patientUid: string
  firstName: string
  serviceId: string
  lines: Array<{ occurrenceId: string; status: 'confirmed' | 'waitlist' }>
}

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

/** Un patient, tel que le personnel le voit : un prénom, un service. Rien d'autre. */
export type StaffPatient = {
  uid: string
  firstName: string
  serviceId: string
  /** Fin de validité du code. Passée cette date, la personne sort des listes. */
  expiresAt?: Date
}

/**
 * Un code fraîchement créé. Il n'est **renvoyé qu'une fois** : seule son empreinte est
 * conservée. Perdu, il ne se retrouve pas — on en délivre un nouveau.
 */
export type NewPatientCode = {
  uid: string
  firstName: string
  code: string
  /** Découpé en groupes de trois, pour être lu et recopié sans erreur. */
  printableCode: string
  expiresAt: Date
}

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

  /**
   * Supprime une activité et ses séances si personne ne s'y est jamais inscrit ; la
   * retire du programme sinon. C'est le serveur qui tranche, seul à voir les inscriptions.
   */
  deleteActivity(activityId: string): Promise<CatalogRemoval>

  /** Le calendrier du personnel : tout le programme, sans filtre de service. */
  listOccurrences(from: LocalDate, to: LocalDate): Promise<Occurrence[]>

  /** Annulation en deux clics, avec motif. Jamais une suppression. */
  /**
   * Les plannings de la semaine pour tout un service, un par personne — de quoi imprimer
   * la pile à la fin de la réunion du lundi. Les inscriptions ne sont pas lisibles côté
   * client : c'est le serveur qui les rassemble.
   */
  weekPlannings(from: LocalDate, to: LocalDate, serviceId?: string): Promise<PatientPlanning[]>

  cancelOccurrence(occurrenceId: string, reason: string): Promise<void>
  restoreOccurrence(occurrenceId: string): Promise<void>

  /** Liste des inscrits. Vide tant que les inscriptions ne sont pas en service. */
  roster(occurrenceId: string): Promise<RosterLine[]>

  /**
   * Les patients, pour la réunion du lundi. Prénom et service uniquement.
   * La liste est toujours restreinte à ce dont le soignant a besoin à l'écran.
   */
  listPatients(): Promise<StaffPatient[]>

  /**
   * Inscription prise par un soignant, pour un patient. C'est le geste central de la
   * réunion de début de semaine : le patient n'a rien à faire, et retrouve l'activité
   * dans son calendrier s'il ouvre l'application.
   */
  registerPatient(
    occurrenceId: string,
    patientUid: string,
  ): Promise<{ ok: boolean; status?: 'confirmed' | 'waitlist'; message: string }>

  unregisterPatient(occurrenceId: string, patientUid: string): Promise<{ ok: boolean; message: string }>

  /**
   * Crée un patient et son code d'accès. Le strict minimum est enregistré :
   * un prénom et un service.
   */
  createPatient(firstName: string, serviceId: string): Promise<NewPatientCode>

  /** Nouveau code pour une personne existante — feuille perdue, code oublié. */
  regenerateCode(patientUid: string): Promise<NewPatientCode>

  /**
   * Fin de séjour : le code cesse de fonctionner et la personne sort des listes.
   * Ses inscriptions passées ne sont pas touchées ; la purge s'en chargera.
   */
  endStay(patientUid: string): Promise<{ ok: boolean; message: string }>

  /** La file des demandes de rendez-vous, les plus anciennes d'abord. */
  listAppointments(): Promise<Appointment[]>

  /** Le soignant consulte l'agenda, puis fixe. C'est lui, jamais le patient. */
  scheduleAppointment(
    appointmentId: string,
    rendezVous: { date: LocalDate; time: LocalTime; durationMin: number; withWhom: string; locationId?: string },
  ): Promise<{ ok: boolean; message: string }>

  /**
   * Un rendez-vous fixé d'emblée, sans demande préalable. Beaucoup de patients ne se
   * serviront jamais de l'application : ils demandent de vive voix, et le soignant note.
   */
  createAppointment(rendezVous: {
    patientUid: string
    kindId: string
    date: LocalDate
    time: LocalTime
    durationMin: number
    withWhom: string
    locationId?: string
  }): Promise<{ ok: boolean; message: string }>

  cancelAppointment(appointmentId: string, reason: string): Promise<{ ok: boolean; message: string }>
}

/** Réservé à l'administrateur : ajouter un lieu, un service, une catégorie. */
export interface CatalogAdminService {
  saveLocation(location: { id: string; name: string; accessNotes?: string; building?: string; isActive: boolean }): Promise<void>
  saveService(service: { id: string; name: string; isActive: boolean }): Promise<void>
  saveCategory(category: { id: string; name: string; icon: string; colorToken: string; isActive?: boolean }): Promise<void>

  /**
   * Retire une entrée. Supprimée si rien ne l'utilise, simplement retirée des listes
   * sinon — la décision revient au serveur, seul à voir toutes les données.
   */
  removeEntry(kind: CatalogKind, id: string): Promise<CatalogRemoval>
}

export type StaffApp = {
  session: StaffSessionService
  repository: StaffRepository
  catalogAdmin: CatalogAdminService
}
