/**
 * Ports de l'espace soignant. Comme pour le patient, l'interface ne connaît que ceci —
 * jamais Firebase. Deux adapters les implémentent : `firestore/` et `mock/`.
 */
import type { Leave } from '../domain/leave'
import type { PatientActionOverrides, PatientPermissions } from '../domain/permissions'
import type { ActivityProposal } from '../domain/proposals'
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
    /** En congé ce jour-là : ni plage, ni créneau, et l'écran doit pouvoir le dire. */
    onLeave?: boolean
    windows: AvailabilityWindow[]
    free: { from: LocalTime; to: LocalTime }[]
    taken: TimeConflict[]
  }[]
  suggestion: { localDate: LocalDate; time: LocalTime; matchesPreference: boolean } | null
}

/**
 * Un rendez-vous que le congé ferait bouger, tel qu'on le montre avant de trancher.
 *
 * Le prénom y figure parce que c'est ce qui rend la décision possible : « trois
 * rendez-vous » ne dit rien, « Camille mardi à 10 h » se pèse.
 */
export type LeaveConflict = {
  appointmentId: string
  firstName: string
  localDate: LocalDate
  start?: string
  end?: string
}

/**
 * Ce que répond une déclaration de congé.
 *
 * Deux temps quand des rendez-vous sont déjà fixés : le premier appel ne modifie rien et
 * rend la liste ; l'écran la montre, un humain tranche, et le second appel enregistre.
 * `activityCount` compte les séances animées pendant le congé — comptées, jamais
 * touchées : une séance a des inscrits, et l'annuler se décide séance par séance.
 */
/**
 * Une séance que le congé fait tomber, telle qu'on la montre avant de trancher.
 *
 * Le nombre d'inscrits y figure parce que c'est lui qui fait hésiter : annuler un
 * atelier vide et annuler un atelier où onze personnes sont inscrites ne sont pas le
 * même geste.
 */
export type LeaveSession = {
  occurrenceId: string
  title: string
  localDate: LocalDate
  confirmedCount: number
  start?: string
  end?: string
}

export type LeaveOutcome = {
  ok: boolean
  message: string
  needsConfirmation?: boolean
  /** Les rendez-vous fixés pendant le congé. Ils retournent toujours dans la file. */
  conflicts?: LeaveConflict[]
  /** Les séances animées pendant le congé. Les annuler est un choix. */
  sessions?: LeaveSession[]
  reopened?: number
  cancelledSessions?: number
  activityCount?: number
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
  /**
   * Copier une activité. `source` évite une lecture : l'écran qui propose « Dupliquer »
   * a l'activité sous les yeux, et donc en mémoire.
   */
  duplicateActivity(activityId: string, source?: Activity): Promise<string>

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

  /**
   * Les idées déposées par les patients — toutes, pour l'administrateur qui répond.
   *
   * Lecture directe : les règles la lui accordent, et une lecture directe ne paie aucun
   * démarrage à froid. C'est répondre qui passe par une fonction.
   */
  listProposals(): Promise<ActivityProposal[]>

  /**
   * Répondre à une idée. Un refus demande un motif : « non » sans raison décourage plus
   * sûrement que le refus lui-même, et la personne lira cette phrase telle quelle.
   *
   * `activityId` rattache après coup l'activité née d'une idée retenue. La même idée peut
   * donc être décidée deux fois avec le même verdict — c'est ainsi qu'elle se complète.
   */
  decideProposal(
    proposalId: string,
    decision: 'accepted' | 'declined',
    options?: { declineReason?: string; activityId?: string },
  ): Promise<{ ok: boolean; message: string }>

  /**
   * L'unité à laquelle ce compte est rattaché, et la régler.
   *
   * Une bulle par unité de soins : celle de La Couturelle fixe les rendez-vous de La
   * Couturelle. Le réglage vit sur le compte et non dans le navigateur — un poste
   * remplacé, une connexion depuis un autre ordinateur, et il serait à refaire.
   *
   * Il n'accorde ni ne retire aucun droit : c'est ce que l'écran montre en arrivant,
   * et une case rend l'ensemble de l'hôpital. `null` veut dire « aucune unité ».
   */
  /**
   * Les congés du personnel, par intervenant.
   *
   * Une plage de disponibilité dit « je reçois le mardi », en semaine type ; elle ne
   * sait pas dire « sauf la semaine du 15 ». Le congé est cette exception datée, et
   * sans lui l'application proposait des rendez-vous en pleine absence.
   */
  readLeaves(): Promise<Record<string, Leave[]>>

  /**
   * Déclarer un congé. Sans `force`, ne modifie rien et rend ce qui serait bousculé.
   *
   * Chacun le sien, l'administrateur pour tout le monde — le même partage que pour les
   * disponibilités. Le serveur revérifie : un écran se contourne.
   */
  declareLeave(
    practitionerId: string,
    leave: Leave,
    options?: { force?: boolean; cancelSessions?: boolean },
  ): Promise<LeaveOutcome>

  /** Retirer un congé. Ce qu'il a rouvert reste dans la file : cela se refixe à la main. */
  removeLeave(practitionerId: string, leave: Leave): Promise<{ ok: boolean; message: string }>

  readMyUnit(): Promise<string | null>
  saveMyUnit(serviceId: string | null): Promise<{ ok: boolean; message: string }>

  /**
   * Ce que les patients ont le droit de faire, et le régler.
   *
   * Quatre gestes : s'inscrire, se retirer, demander un rendez-vous, proposer une
   * activité. Aucun service n'est obligé de les ouvrir tous, ni de les ouvrir tout de
   * suite — c'est une décision d'organisation, et elle ne devrait pas demander un
   * développeur. Réservé à l'administrateur.
   */
  readPatientPermissions(): Promise<PatientPermissions>
  savePatientPermissions(permissions: PatientPermissions): Promise<{ ok: boolean; message: string }>

  /**
   * Les réglages particuliers, par personne : ce qui diffère de la règle du service.
   *
   * Une clé absente veut dire « comme le service », et continue de le vouloir dire quand
   * le service change. C'est tout l'intérêt : recopier la règle générale sur chaque
   * personne donnerait des réglages figés, et fermer un geste pour le service n'aurait
   * alors d'effet sur personne.
   */
  readPatientActions(): Promise<Record<string, PatientActionOverrides>>
  savePatientActions(
    patientUid: string,
    overrides: PatientActionOverrides,
  ): Promise<{ ok: boolean; message: string }>

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
   * Donner sa place à quelqu'un de la liste d'attente, sans attendre qu'une place se
   * libère toute seule.
   *
   * La liste d'attente n'avance d'elle-même que si quelqu'un se désinscrit **dans
   * l'application**. Un désistement dit de vive voix — « finalement je ne viens pas »,
   * à la réunion ou dans le couloir — ne fait rien avancer : la place reste vide et la
   * personne suivante reste en attente sans le savoir. Ce geste-là existe pour ça.
   */
  promotePatient(occurrenceId: string, patientUid: string): Promise<{ ok: boolean; message: string }>

  /**
   * Réveille la fonction d'inscription, sans rien inscrire.
   *
   * Une fonction endormie met plusieurs secondes à repartir, et ce retard tombe toujours
   * sur le premier prénom de la réunion. L'écran l'appelle en s'ouvrant : le clic qui
   * suit ne paie plus le démarrage. Sans effet si tout est déjà chaud, et sans effet du
   * tout sur la démonstration.
   */
  warmRegistration(): Promise<void>

  /** Même chose pour l'appel : l'écran de la feuille de présence le demande en s'ouvrant. */
  warmAttendance(): Promise<void>

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
  /**
   * Fixer un rendez-vous, pour un patient d'ici ou pour une personne extérieure.
   *
   * L'un ou l'autre, jamais les deux : `patientUid` pour quelqu'un d'hospitalisé,
   * `externalName` — un prénom, rien d'autre — pour un ancien patient qu'un soignant
   * continue de recevoir. Le second n'a pas de compte : il ne verra rien de tout cela,
   * le rendez-vous ne vit que dans l'agenda du soignant.
   */
  createAppointment(rendezVous: {
    patientUid?: string
    externalName?: string
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

  /**
   * Donne ou retire les droits d'administrateur à un compte existant.
   *
   * Le rôle qui fait autorité est le jeton : le changer déconnecte la personne, qui
   * devra se reconnecter pour que ses nouveaux droits s'appliquent. On le dit à l'écran.
   * Le serveur refuse qu'un administrateur se retire ses propres droits.
   */
  setStaffRole(
    uid: string,
    role: 'staff' | 'admin',
    options?: { practitionerId?: string; firstName?: string },
  ): Promise<{ ok: boolean; message: string }>

  savePractitioner(practitioner: {
    id: string
    name: string
    role: string
    kindId?: string
    /**
     * Les unités où cette personne intervient. Toujours les deux champs ensemble :
     * l'écriture se fait par fusion, et n'en écrire qu'un laisserait derrière une
     * ancienne liste qui contredirait le choix qu'on vient de faire.
     */
    audience?: 'all' | 'services'
    serviceIds?: string[]
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
