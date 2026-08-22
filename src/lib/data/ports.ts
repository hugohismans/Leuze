/**
 * Ports : la seule chose que l'interface connaît du monde extérieur.
 * Deux adapters les implémentent — `mock/` (écran de démonstration, tests)
 * et, au lot L1, `firestore/`. Aucun composant n'importe `firebase/*`.
 */
import type { ActivityProposal, ProposalDraft } from '../domain/proposals'
import type {
  Appointment,
  AppointmentKind,
  AppointmentPreference,
  Category,
  LocalDate,
  Location,
  Occurrence,
  Practitioner,
  Registration,
  Service,
} from '../domain/types'

export interface CatalogRepository {
  listLocations(): Promise<Location[]>
  listCategories(): Promise<Category[]>
  listServices(): Promise<Service[]>
  /** Les intervenants : psychiatre, kinésithérapeute, animateur. */
  listPractitioners(): Promise<Practitioner[]>
}

export interface OccurrenceRepository {
  /**
   * Le calendrier n'a besoin que de cette requête : une fenêtre de dates locales.
   * Le filtrage par service est fait **ici**, dans la couche de données — jamais dans
   * l'interface : côté Firestore, ce sera la requête `array-contains-any` doublée par
   * les règles de sécurité, si bien qu'une activité d'un autre service n'est même pas
   * transmise au navigateur du patient.
   */
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
  | {
      ok: true
      status: 'confirmed' | 'waitlist'
      position: number | null
      /**
       * Une autre activité tombe au même moment. L'inscription est prise — deux
       * activités qui se chevauchent, c'est souvent sans importance — mais la personne
       * doit le savoir. Un rendez-vous, lui, refuse l'inscription : voir `domain/conflicts`.
       */
      warning?: string
    }
  | { ok: false; reason: string; message: string }

export interface RegistrationService {
  /** Uniquement les inscriptions du patient connecté. Jamais celles des autres. */
  listMine(): Promise<MyRegistration[]>
  statusFor(occurrenceId: string): Promise<MyRegistration | null>
  register(occurrenceId: string): Promise<RegisterResult>
  unregister(occurrenceId: string): Promise<{ ok: boolean; message: string }>

  /**
   * Réveille la fonction d'inscription, sans rien inscrire.
   *
   * Même raison que pour la saisie du code : une fonction qui n'a pas servi depuis un
   * quart d'heure met plusieurs secondes à repartir, et ce retard tombe toujours sur la
   * personne qui appuie sur « Je m'inscris ». La fiche d'activité le demande en
   * s'affichant — on la lit bien avant de décider. Sans effet sur la démonstration.
   */
  warmRegistration(): Promise<void>
}

/** Réservé au personnel : la liste des inscrits n'est jamais lisible côté patient. */
export interface StaffRegistrationService {
  roster(occurrenceId: string): Promise<{ confirmed: Registration[]; waitlist: Registration[] }>
}

/**
 * Rendez-vous individuels, côté patient. Il demande à voir quelqu'un ; il ne fixe
 * jamais la date lui-même, et ne voit jamais les demandes des autres.
 */
export interface AppointmentService {
  listKinds(): Promise<AppointmentKind[]>
  listMine(): Promise<Appointment[]>
  /**
   * `scheduled` : la demande a trouvé une place toute seule, chez quelqu'un qui accepte
   * automatiquement. Le message dit alors quand ; sinon, il dit qu'un soignant répondra.
   */
  request(
    kindId: string,
    preference: AppointmentPreference,
  ): Promise<{ ok: boolean; message: string; scheduled?: boolean }>
  withdraw(appointmentId: string): Promise<{ ok: boolean; message: string }>

  /**
   * Réveille la fonction de demande, sans rien demander. L'écran le fait en s'affichant :
   * on choisit un motif et un moment de la journée avant d'appuyer, ce qui laisse tout
   * le temps. Sans effet sur la démonstration.
   */
  warmRequest(): Promise<void>
}

/**
 * Les idées d'activité, côté patient.
 *
 * On dépose, on relit la sienne, c'est tout. Aucune modification, aucune suppression :
 * une idée déposée appartient à la file, et la retirer ferait disparaître une réponse
 * déjà écrite par quelqu'un.
 */
export interface ProposalService {
  /** Mes idées, la plus récente d'abord. Jamais celles des autres. */
  listMine(): Promise<ActivityProposal[]>
  /**
   * Déposer une idée. Le serveur revérifie ce que l'écran a déjà vérifié — longueur des
   * textes, une seule idée en attente — parce qu'un écran peut être contourné.
   */
  submit(draft: ProposalDraft): Promise<{ ok: boolean; message: string }>
  /** Réveille la fonction, sans rien déposer. Voir `warmRegistration`. */
  warmProposal(): Promise<void>
}

export type PatientSession = {
  patientUid: string | null
  firstName: string | null
  /** Service du patient : décide de ce qu'il voit. `null` s'il n'est pas connecté. */
  serviceId: string | null
}

export interface SessionService {
  current(): PatientSession
  /** Échange un code court contre une session. Côté Firestore, ce sera une Cloud Function. */
  signInWithCode(code: string): Promise<{ ok: true } | { ok: false; message: string }>

  /**
   * Réveille la fonction qui échange un code contre une session, sans rien échanger.
   *
   * C'est là que l'attente coûtait le plus cher : quelqu'un tape son code, appuie, et
   * patiente une dizaine de secondes le temps qu'une fonction endormie redémarre.
   * L'écran du code le demande en s'affichant — saisir six caractères prend plus de
   * temps qu'un réveil. Sans effet sur la démonstration.
   */
  warmSignIn(): Promise<void>
  signOut(): Promise<void>
}

export type AppRepository = {
  catalog: CatalogRepository
  occurrences: OccurrenceRepository
  registrations: RegistrationService
  appointments: AppointmentService
  proposals: ProposalService
  session: SessionService
}
