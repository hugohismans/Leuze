/**
 * Ports de l'espace soignant. Comme pour le patient, l'interface ne connaît que ceci —
 * jamais Firebase. Deux adapters les implémentent : `firestore/` et `mock/`.
 */
import type { CatalogKind, CatalogRemoval } from '../domain/catalog'
import type { Account } from '../domain/impersonation'
import type {
  Activity,
  Appointment,
  AvailabilityWindow,
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
  /** L'intervenant auquel ce compte est relié : c'est ce qui ouvre l'appel et « Mon planning ». */
  practitionerId: string | null
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

/** Ce qui occupe déjà quelqu'un au moment visé, tel que le serveur le rapporte. */
export type TimeConflict = { label: string; kind: 'activity' | 'appointment'; start: Date; end: Date }

/**
 * De quoi poser un rendez-vous sans rien deviner : la semaine croisée de l'intervenant
 * et du patient, et un créneau proposé.
 *
 * Le croisement est fait par le serveur : le navigateur n'a pas à recevoir l'agenda d'un
 * collègue pour trouver un trou. Les libellés sont rendus à qui a le droit de les lire —
 * ailleurs, c'est « Occupé ».
 */
export type AppointmentPlanning = {
  availability: AvailabilityWindow[]
  week: {
    localDate: LocalDate
    windows: AvailabilityWindow[]
    free: { from: LocalTime; to: LocalTime }[]
    taken: TimeConflict[]
  }[]
  suggestion: { localDate: LocalDate; time: LocalTime; matchesPreference: boolean } | null
}

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
  /** Renseignée seulement pour qui a le droit de faire l'appel. */
  attendance?: 'present' | 'absent'
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
   *
   * `force` supprime tout, inscriptions comprises et sans retour possible : c'est le
   * geste réservé à ce qui n'aurait jamais dû exister. L'écran l'a demandé en nommant ce
   * qui allait disparaître.
   */
  deleteActivity(activityId: string, options?: { force?: boolean }): Promise<CatalogRemoval>

  /**
   * Supprime une séance et ses inscriptions — celle-là seule. À ne pas confondre avec
   * l'annulation, qui laisse la séance visible et barrée, avec son motif.
   */
  deleteOccurrence(occurrenceId: string): Promise<{ ok: boolean; message: string }>

  /** Le calendrier du personnel : tout le programme, sans filtre de service. */
  listOccurrences(from: LocalDate, to: LocalDate): Promise<Occurrence[]>

  /**
   * Les plannings de la semaine pour tout un service, un par personne — de quoi imprimer
   * la pile à la fin de la réunion du lundi. Les inscriptions ne sont pas lisibles côté
   * client : c'est le serveur qui les rassemble.
   */
  weekPlannings(from: LocalDate, to: LocalDate, serviceId?: string): Promise<PatientPlanning[]>

  /** Annulation en deux clics, avec motif. Jamais une suppression. */
  cancelOccurrence(occurrenceId: string, reason: string): Promise<void>
  restoreOccurrence(occurrenceId: string): Promise<void>

  /** La liste des inscrits, et le droit d'y faire l'appel. */
  roster(occurrenceId: string): Promise<{ lines: RosterLine[]; canMarkAttendance: boolean }>

  /**
   * L'appel. Inscrit d'office la personne qui se présente sans l'être : c'est le cas
   * courant, pas l'exception.
   */
  markAttendance(
    occurrenceId: string,
    patientUid: string,
    attendance: 'present' | 'absent' | null,
  ): Promise<{ ok: boolean; message: string }>

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
    /**
     * `overCapacity` : le soignant assume un dépassement du nombre de places, après que
     * l'écran le lui a demandé. Sans lui, la personne passe en liste d'attente ou est
     * refusée, comme pour tout le monde.
     *
     * `overrideConflict` : il assume de même un chevauchement d'horaire — la personne a
     * déjà une activité ou un rendez-vous à ce moment-là. Sans lui, le serveur refuse et
     * rend la liste de ce qui tombe en même temps, pour que l'écran puisse demander.
     */
    options?: { overCapacity?: boolean; overrideConflict?: boolean },
  ): Promise<{
    ok: boolean
    status?: 'confirmed' | 'waitlist'
    message: string
    /** Renseigné quand l'inscription est refusée faute de confirmation du chevauchement. */
    conflicts?: TimeConflict[]
  }>

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
    rendezVous: {
      date: LocalDate
      time: LocalTime
      durationMin: number
      withWhom: string
      practitionerId?: string
      locationId?: string
    },
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
    practitionerId?: string
    locationId?: string
  }): Promise<{ ok: boolean; message: string }>

  cancelAppointment(appointmentId: string, reason: string): Promise<{ ok: boolean; message: string }>

  /**
   * La semaine croisée d'un intervenant et d'un patient, avec un créneau proposé.
   * `patientUid` est facultatif : sans lui, on ne regarde que l'agenda de l'intervenant.
   */
  appointmentPlanning(query: {
    practitionerId: string
    patientUid?: string
    preference?: 'matin' | 'apres-midi' | 'peu-importe'
    durationMin?: number
    from?: LocalDate
  }): Promise<AppointmentPlanning>
}

/** Réservé à l'administrateur : ajouter un lieu, un service, une catégorie. */
export interface CatalogAdminService {
  saveLocation(location: { id: string; name: string; accessNotes?: string; building?: string; isActive: boolean }): Promise<void>
  saveService(service: { id: string; name: string; isActive: boolean }): Promise<void>
  saveCategory(category: { id: string; name: string; icon: string; colorToken: string; isActive?: boolean }): Promise<void>
  /**
   * Un motif de rendez-vous : « Le psychiatre », « Autre ». C'est ce que le patient lit
   * dans sa demande — une fonction, jamais une spécialité clinique, jamais une raison.
   */
  saveAppointmentKind(kind: { id: string; name: string; icon: string; isActive: boolean }): Promise<void>
  /**
   * Donne un accès à un intervenant, ou relie un compte existant. Le mot de passe
   * provisoire n'est renvoyé qu'à la création, et une seule fois.
   */
  createStaffAccount(
    email: string,
    practitionerId: string,
  ): Promise<{ ok: boolean; message: string; password?: string }>

  savePractitioner(practitioner: {
    id: string
    name: string
    role: string
    kindId?: string
    isActive: boolean
  }): Promise<void>

  /**
   * Les plages où quelqu'un reçoit, et elles seules.
   *
   * À part de `savePractitioner`, parce que le droit n'est pas le même : une personne du
   * personnel tient ses propres disponibilités à jour — elle seule sait quand elle est
   * là — sans pouvoir toucher au reste de sa fiche. Écrire la fiche entière serait refusé
   * par les règles.
   */
  saveAvailability(practitionerId: string, windows: AvailabilityWindow[]): Promise<void>

  /**
   * L'acceptation automatique des demandes de rendez-vous : chacun décide pour lui.
   *
   * Le droit est celui des plages — l'intéressé, ou l'administrateur. C'est cohérent :
   * accepter automatiquement n'a de sens qu'avec des plages déclarées, et les deux
   * réglages répondent à la même question, « quand est-ce que je reçois ? ».
   */
  setAutoAccept(practitionerId: string, autoAccept: boolean): Promise<void>

  /**
   * Retire une entrée. Supprimée si rien ne l'utilise, simplement retirée des listes
   * sinon — la décision revient au serveur, seul à voir toutes les données.
   */
  removeEntry(kind: CatalogKind, id: string): Promise<CatalogRemoval>
}

/**
 * « Voir à leur place » : ouvrir la session de quelqu'un d'autre pour vérifier ce qu'il
 * voit. Outil de mise au point, réservé à l'administrateur — le serveur le revérifie.
 */
export interface SuperAdminService {
  /** Les comptes auxquels on peut se substituer : le personnel, puis les patients. */
  listAccounts(): Promise<Account[]>

  /**
   * Ouvre la session de ce compte à la place de la sienne, et rend de quoi revenir.
   * `back` est à garder le temps de l'onglet, et pas une seconde de plus.
   */
  impersonate(
    uid: string,
  ): Promise<
    | { ok: true; label: string; kind: 'patient' | 'staff'; back: string }
    | { ok: false; message: string }
  >

  /** Reprend sa propre session à partir du jeton mis de côté. */
  resume(back: string): Promise<{ ok: boolean; message: string }>
}

export type StaffApp = {
  session: StaffSessionService
  repository: StaffRepository
  catalogAdmin: CatalogAdminService
  superAdmin: SuperAdminService
}
