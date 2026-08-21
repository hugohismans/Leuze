/**
 * État de l'espace soignant. Comme pour le patient, ne connaît que les ports.
 */
import { createStaffApp } from './data'
import type {
  NewPatientCode,
  ActivityDraft,
  GenerationReport,
  RosterLine,
  StaffApp,
  StaffIdentity,
  AppointmentPlanning,
  StaffPatient,
  TimeConflict,
} from './data/staffPorts'
import { describeGeneration } from './data/generation'
import type { Account } from './domain/impersonation'
import type { PatientPlanning } from './data/staffPorts'
import type { CatalogKind, CatalogRemoval } from './domain/catalog'
import { store } from './appState.svelte'
import { todayLocalDate, weekDays } from './domain/time'
import { enClair } from './erreurs'
import type {
  Activity,
  Appointment,
  AvailabilityWindow,
  LocalDate,
  LocalTime,
  Occurrence,
} from './domain/types'

const SIGNED_OUT: StaffIdentity = {
  uid: null,
  email: null,
  firstName: null,
  role: null,
  practitionerId: null,
}

class StaffStore {
  /** Chargé à la demande, comme l'adapter patient : voir `data/index.ts`. */
  private readonly loading$: Promise<StaffApp> = createStaffApp()
  private application: StaffApp | null = null

  private async app$(): Promise<StaffApp> {
    if (this.application === null) this.application = await this.loading$
    return this.application
  }

  identity = $state<StaffIdentity>(SIGNED_OUT)
  activities = $state<Activity[]>([])
  occurrences = $state<Occurrence[]>([])
  date = $state<LocalDate>(todayLocalDate())
  /** Les patients, pour la réunion du lundi. Prénom et service uniquement. */
  patients = $state<StaffPatient[]>([])
  /** Demandes de rendez-vous, les plus anciennes d'abord. */
  appointments = $state<Appointment[]>([])
  /** Inscrits de l'activité ouverte pendant la réunion. */
  roster = $state<RosterLine[]>([])
  /**
   * Le service sur lequel le programme est filtré, ou `null` pour tout voir.
   *
   * Il vit ici et non dans un écran : filtrer sur « La Couturelle » puis passer à
   * l'impression doit donner la feuille de La Couturelle, sans avoir à le redire.
   */
  programmeServiceId = $state<string | null>(null)
  /** Message de compte rendu affiché après une action, en français simple. */
  message = $state<string | null>(null)
  /**
   * Un compte rendu appartient à l'écran qui l'a provoqué : il disparaît dès qu'on
   * change d'onglet. Seule exception, une action qui **navigue** après coup — enregistrer
   * une activité renvoie à la semaine, et le message doit y arriver.
   */
  #survitAuProchainChangement = false
  loading = $state(false)

  readonly signedIn = $derived(this.identity.role !== null)
  readonly isAdmin = $derived(this.identity.role === 'admin')

  readonly week = $derived(weekDays(this.date))

  readonly today = $derived(
    this.occurrences
      .filter((o) => o.localDate === this.date)
      .sort((a, b) => a.start.getTime() - b.start.getTime()),
  )

  async signIn(email: string, password: string): Promise<{ ok: boolean; message?: string }> {
    const result = await (await this.app$()).session.signIn(email, password)
    this.identity = (await this.app$()).session.current()
    // Le catalogue n'est lisible qu'une fois connecté : il faut le (re)charger ici.
    // Après connexion, le catalogue devient lisible : il faut le relire, même s'il a
    // déjà été demandé (sans succès) avant l'authentification.
    if (result.ok) {
      /*
        On n'attend que le programme — ce qui s'affiche en premier. Le reste arrive
        derrière, chacun à son rythme : la liste des patients et les rendez-vous passent
        par des fonctions appelables, qui mettent plusieurs secondes quand elles dormaient.
        Les attendre toutes, c'était laisser le bouton « Se connecter » tourner une demi-
        minute pour un écran qui n'en avait besoin d'aucune.
      */
      void store.loadCatalog(true)
      void store.loadAppointmentKinds()
      void this.loadPatients()
      void this.loadAppointments()
      await this.refresh()
    }
    return result.ok ? { ok: true } : { ok: false, message: result.message }
  }

  /** Les comptes auxquels un administrateur peut se substituer, pour vérifier ce qu'ils voient. */
  async listAccounts(): Promise<Account[]> {
    return (await this.app$()).superAdmin.listAccounts()
  }

  /** Ouvre la session de quelqu'un d'autre. La page est rechargée juste après. */
  async impersonate(uid: string) {
    return (await this.app$()).superAdmin.impersonate(uid)
  }

  async signOut(): Promise<void> {
    await (await this.app$()).session.signOut()
    this.identity = (await this.app$()).session.current()
    this.activities = []
    this.occurrences = []
  }

  /** Rafraîchit la session au démarrage : Firebase la restaure de façon asynchrone. */
  async restore(): Promise<void> {
    await this.refresh()
    this.identity = (await this.app$()).session.current()
    if (this.identity.role !== null) {
      // Comme à la connexion : rien de tout cela ne doit retenir l'affichage.
      void store.loadCatalog(true)
      void store.loadAppointmentKinds()
      void this.loadPatients()
      void this.loadAppointments()
    }
  }

  async refresh(): Promise<void> {
    this.loading = true
    const jours = weekDays(this.date)
    const [activities, occurrences] = await Promise.all([
      (await this.app$()).repository.listActivities().catch(() => []),
      (await this.app$()).repository.listOccurrences(jours[0]!, jours[6]!).catch(() => []),
    ])
    this.activities = activities
    this.occurrences = occurrences
    this.loading = false
  }

  async createPatient(firstName: string, serviceId: string): Promise<NewPatientCode> {
    const code = await (await this.app$()).repository.createPatient(firstName, serviceId)
    await this.loadPatients()
    this.message = null
    return code
  }

  async regenerateCode(patientUid: string): Promise<NewPatientCode> {
    const code = await (await this.app$()).repository.regenerateCode(patientUid)
    await this.loadPatients()
    return code
  }

  async endStay(patientUid: string): Promise<void> {
    try {
      const resultat = await (await this.app$()).repository.endStay(patientUid)
      this.message = resultat.message
    } catch (error) {
      // Un refus du serveur doit se lire à l'écran, pas finir dans la console.
      this.message =
        enClair(error)
    }
    await this.loadPatients()
  }

  async loadAppointments(): Promise<void> {
    this.appointments = await (await this.app$()).repository.listAppointments().catch(() => [])
  }

  async scheduleAppointment(
    appointmentId: string,
    rendezVous: {
      date: LocalDate
      time: LocalTime
      durationMin: number
      withWhom: string
      practitionerId?: string
      locationId?: string
    },
  ): Promise<string> {
    const resultat = await (await this.app$()).repository.scheduleAppointment(appointmentId, rendezVous)
    await this.loadAppointments()
    this.message = resultat.message
    return resultat.message
  }

  /** Un rendez-vous fixé d'emblée, pour qui n'a pas fait la demande dans l'application. */
  async createAppointment(rendezVous: {
    patientUid: string
    kindId: string
    date: LocalDate
    time: LocalTime
    durationMin: number
    withWhom: string
    practitionerId?: string
    locationId?: string
  }): Promise<boolean> {
    const resultat = await (await this.app$()).repository.createAppointment(rendezVous)
    await this.loadAppointments()
    this.message = resultat.message
    return resultat.ok
  }

  /**
   * La semaine croisée d'un intervenant et d'un patient, avec un créneau proposé.
   * C'est le serveur qui croise : l'écran ne reçoit que des heures et un état.
   */
  async appointmentPlanning(query: {
    practitionerId: string
    patientUid?: string
    preference?: 'matin' | 'apres-midi' | 'peu-importe'
    durationMin?: number
    from?: LocalDate
  }): Promise<AppointmentPlanning | null> {
    try {
      return await (await this.app$()).repository.appointmentPlanning(query)
    } catch {
      // Un agenda qu'on ne peut pas lire ne doit pas empêcher de fixer un rendez-vous :
      // l'écran continue sans la suggestion, et le soignant choisit son heure.
      return null
    }
  }

  async cancelAppointment(appointmentId: string, reason: string): Promise<void> {
    const resultat = await (await this.app$()).repository.cancelAppointment(appointmentId, reason)
    await this.loadAppointments()
    this.message = resultat.message
  }

  async loadPatients(): Promise<void> {
    this.patients = await (await this.app$()).repository.listPatients().catch(() => [])
  }

  /** Vrai quand la personne connectée a le droit de faire l'appel de l'activité ouverte. */
  canMarkAttendance = $state<boolean>(false)

  /** Réveille la fonction d'inscription, sans rien inscrire. Voir le port. */
  async warmRegistration(): Promise<void> {
    await (await this.app$()).repository.warmRegistration().catch(() => undefined)
  }

  /** Même chose pour l'appel, demandé en ouvrant la feuille de présence. */
  async warmAttendance(): Promise<void> {
    await (await this.app$()).repository.warmAttendance().catch(() => undefined)
  }

  /**
   * Deux compteurs qui protègent l'affichage immédiat des réponses en retard.
   *
   * Une relecture partie avant un clic revient après lui, et rapporte l'état d'avant :
   * le prénom qu'on venait de retirer se remettait tout seul, et le nombre d'inscrits
   * disait autre chose que l'écran. C'est le prix de l'affichage optimiste, et il se
   * paie en ordonnant les réponses plutôt qu'en les appliquant à l'aveugle.
   *
   * `#versionRoster` compte les modifications locales : une réponse préparée sous une
   * version plus ancienne est périmée, on la jette. `#ecrituresEnCours` compte les
   * inscriptions parties et pas encore revenues : tant qu'il en reste, aucune relecture
   * ne fait autorité — le serveur n'a pas fini d'appliquer ce qu'on lui a demandé.
   */
  #versionRoster = 0
  #ecrituresEnCours = 0
  /** L'activité dont la liste est affichée : une réponse pour une autre ne vaut rien. */
  #rosterDe: string | null = null

  async openRoster(occurrenceId: string): Promise<void> {
    const version = this.#versionRoster
    this.#rosterDe = occurrenceId
    const resultat = await (await this.app$()).repository
      .roster(occurrenceId)
      .catch(() => ({ lines: [], canMarkAttendance: false }))

    // Périmée : on a cliqué entre-temps, ou une écriture est encore en route, ou l'on
    // regarde déjà une autre activité. Dans les trois cas, l'écran a raison, pas nous.
    if (version !== this.#versionRoster || this.#ecrituresEnCours > 0) return
    if (this.#rosterDe !== occurrenceId) return

    this.roster = resultat.lines
    this.canMarkAttendance = resultat.canMarkAttendance
  }

  /** L'appel. Inscrit d'office la personne qui se présente sans l'être. */
  async markAttendance(
    occurrenceId: string,
    patientUid: string,
    attendance: 'present' | 'absent' | null,
  ): Promise<string> {
    const resultat = await (await this.app$()).repository.markAttendance(occurrenceId, patientUid, attendance)
    await this.openRoster(occurrenceId)
    await this.refresh()
    return resultat.message
  }

  /**
   * Le nombre d'inscrits affiché suit le clic, comme la liste.
   *
   * Sans cela, l'écran se contredisait : le prénom passait en vert, et « 8 inscrits sur
   * 12 » restait à 8 jusqu'à la relecture. La vraie valeur revient du serveur derrière.
   */
  private ajusterCompteur(occurrenceId: string, delta: number): void {
    this.occurrences = this.occurrences.map((occurrence) =>
      occurrence.id === occurrenceId
        ? { ...occurrence, confirmedCount: Math.max(0, occurrence.confirmedCount + delta) }
        : occurrence,
    )
  }

  isRegistered(patientUid: string): boolean {
    return this.roster.some((ligne) => ligne.patientUid === patientUid)
  }

  /**
   * Le geste de la réunion : on clique sur un prénom, il est inscrit ; on reclique,
   * il est retiré. Rien d'autre à faire — le patient retrouvera l'activité dans son
   * calendrier s'il ouvre l'application.
   */
  /**
   * Inscrire ou désinscrire quelqu'un depuis la réunion.
   *
   * Rend le résultat entier et non le seul message : un chevauchement d'horaire revient
   * du serveur avec la liste de ce qui tombe en même temps, et l'écran doit pouvoir la
   * montrer avant de redemander la même inscription.
   */
  async togglePatient(
    occurrenceId: string,
    patientUid: string,
    /**
     * `overCapacity` : le dépassement du nombre de places est assumé.
     * `overrideConflict` : le chevauchement d'horaire l'est aussi.
     */
    options: { overCapacity?: boolean; overrideConflict?: boolean } = {},
  ): Promise<{ message: string; conflicts?: TimeConflict[] }> {
    const repository = (await this.app$()).repository
    const inscrit = this.isRegistered(patientUid)

    /*
      Le prénom change d'état tout de suite, avant la réponse du serveur.

      L'inscription passe par une fonction appelable — la capacité et la liste d'attente
      se décident dans une transaction, et un navigateur n'a pas le droit d'écrire là.
      Cet aller-retour prend une à deux secondes, parfois plus quand la fonction dormait :
      on cliquait, il ne se passait rien, on recliquait. Autant de doubles inscriptions
      évitées de justesse, et une réunion qui traîne.

      On affiche donc ce qui va se passer, puis on le vérifie. En cas de refus — activité
      complète, chevauchement, réseau coupé — la liste revient exactement dans l'état
      d'avant, et le message dit pourquoi. C'est ce que fait n'importe quelle application
      qui « répond du tac au tac » : elle n'attend pas le serveur pour se redessiner.
    */
    const avant = this.roster
    const personne = this.patients.find((p) => p.uid === patientUid)
    // Toute modification locale périme les relectures déjà parties.
    this.#versionRoster += 1
    this.#ecrituresEnCours += 1
    this.ajusterCompteur(occurrenceId, inscrit ? -1 : 1)
    this.roster = inscrit
      ? this.roster.filter((ligne) => ligne.patientUid !== patientUid)
      : [
          ...this.roster,
          {
            patientUid,
            firstName: personne?.firstName ?? 'Cette personne',
            serviceId: personne?.serviceId ?? null,
            status: 'confirmed' as const,
            position: null,
          },
        ]

    let resultat
    try {
      resultat = inscrit
        ? await repository.unregisterPatient(occurrenceId, patientUid)
        : await repository.registerPatient(occurrenceId, patientUid, options)
    } finally {
      this.#ecrituresEnCours -= 1
    }

    // Refusé : on remet la liste telle qu'elle était. Le message, lui, vient du serveur.
    if (!resultat.ok) {
      this.#versionRoster += 1
      this.ajusterCompteur(occurrenceId, inscrit ? 1 : -1)
      this.roster = avant
    }

    /*
      La vérité vient ensuite, sans faire attendre — mais seulement quand plus rien n'est
      en route. Relire pendant qu'une autre inscription est partie rapporterait un état
      déjà dépassé, et ferait clignoter l'écran.
    */
    if (this.#ecrituresEnCours === 0) {
      void this.openRoster(occurrenceId)
      void this.refresh()
    }
    // La désinscription ne rend jamais de chevauchement : le champ n'existe que sur
    // l'autre chemin, d'où la vérification plutôt qu'un accès direct.
    const conflits = (resultat as { conflicts?: TimeConflict[] }).conflicts
    return { message: resultat.message, ...(conflits === undefined ? {} : { conflicts: conflits }) }
  }

  /** Appelé à chaque changement d'écran par `StaffApp`. */
  clearMessageOnNavigation(): void {
    if (this.#survitAuProchainChangement) {
      this.#survitAuProchainChangement = false
      return
    }
    this.message = null
  }

  activityOf(activityId: string): Activity | null {
    return this.activities.find((a) => a.id === activityId) ?? null
  }

  async getActivity(activityId: string): Promise<Activity | null> {
    return (await this.app$()).repository.getActivity(activityId)
  }

  private report(prefix: string, report: GenerationReport): void {
    this.message = `${prefix} ${describeGeneration(report)}`
    // Le formulaire renvoie ensuite à la semaine ou à la liste : le message suit.
    this.#survitAuProchainChangement = true
  }

  async saveActivity(draft: ActivityDraft): Promise<string> {
    const { activityId, report } = await (await this.app$()).repository.saveActivity(draft)
    await this.refresh()
    this.report('Activité enregistrée.', report)
    return activityId
  }

  async setActive(activityId: string, isActive: boolean): Promise<void> {
    const report = await (await this.app$()).repository.setActivityActive(activityId, isActive)
    await this.refresh()
    this.report(isActive ? 'Activité remise au programme.' : 'Activité retirée du programme.', report)
  }

  async duplicate(activityId: string): Promise<string> {
    const nouvelId = await (await this.app$()).repository.duplicateActivity(activityId)
    await this.refresh()
    this.message = 'Copie créée. Elle est en brouillon : relisez-la, puis mettez-la au programme.'
    return nouvelId
  }

  async cancelOccurrence(occurrenceId: string, reason: string): Promise<void> {
    await (await this.app$()).repository.cancelOccurrence(occurrenceId, reason)
    await this.refresh()
    this.message = 'Séance annulée. Les patients la voient barrée, avec le motif.'
  }

  /** Les plannings de la semaine affichée, pour tout un service. */
  async weekPlannings(serviceId?: string): Promise<PatientPlanning[]> {
    const jours = this.week
    return (await this.app$()).repository.weekPlannings(jours[0]!, jours[6]!, serviceId)
  }

  async restoreOccurrence(occurrenceId: string): Promise<void> {
    await (await this.app$()).repository.restoreOccurrence(occurrenceId)
    await this.refresh()
    this.message = 'Séance rétablie.'
  }

  async saveLocation(location: {
    id: string
    name: string
    accessNotes?: string
    building?: string
    isActive: boolean
  }): Promise<void> {
    await (await this.app$()).catalogAdmin.saveLocation(location)
    await store.loadCatalog(true)
    this.message = `Lieu enregistré : ${location.name}.`
  }

  async saveService(service: { id: string; name: string; isActive: boolean }): Promise<void> {
    await (await this.app$()).catalogAdmin.saveService(service)
    await store.loadCatalog(true)
    this.message = `Service enregistré : ${service.name}.`
  }

  /**
   * Retirer une entrée du catalogue. Le serveur décide entre supprimer et retirer des
   * listes selon ce qui l'utilise ; on répète sa phrase telle quelle, elle explique ce
   * qui vient de se passer.
   */
  /** Supprime l'activité, ou la retire du programme si quelqu'un s'y est déjà inscrit. */
  /**
   * `force` supprime tout, inscriptions comprises et sans retour : réservé à ce qui
   * n'aurait jamais dû exister. Sans lui, le serveur retire seulement du programme dès
   * qu'une inscription existe.
   */
  async removeActivity(
    activityId: string,
    options: { force?: boolean } = {},
  ): Promise<CatalogRemoval> {
    const plan = await (await this.app$()).repository.deleteActivity(activityId, options)
    await this.refresh()
    this.message = plan.message
    // Rendu à l'écran : c'est lui qui décide s'il propose d'aller plus loin.
    return plan
  }

  /** Supprime une séance et ses inscriptions. L'activité et les autres semaines restent. */
  async removeOccurrence(occurrenceId: string): Promise<string> {
    const resultat = await (await this.app$()).repository.deleteOccurrence(occurrenceId)
    await this.refresh()
    this.message = resultat.message
    return resultat.message
  }

  async removeCatalogEntry(kind: CatalogKind, id: string): Promise<string[]> {
    const plan = await (await this.app$()).catalogAdmin.removeEntry(kind, id)
    await store.loadCatalog(true)
    this.message = plan.message
    return plan.activityTitles ?? []
  }

  async saveCategory(category: {
    id: string
    name: string
    icon: string
    colorToken: string
    isActive?: boolean
  }): Promise<void> {
    await (await this.app$()).catalogAdmin.saveCategory(category)
    await store.loadCatalog(true)
    this.message = `Catégorie enregistrée : ${category.name}.`
  }

  async createStaffAccount(email: string, practitionerId: string): Promise<string | null> {
    const resultat = await (await this.app$()).catalogAdmin.createStaffAccount(email, practitionerId)
    this.message = resultat.message
    return resultat.password ?? null
  }

  async savePractitioner(practitioner: {
    id: string
    name: string
    role: string
    kindId?: string
    isActive: boolean
  }): Promise<void> {
    await (await this.app$()).catalogAdmin.savePractitioner(practitioner)
    await store.loadCatalog(true)
    this.message = `Intervenant enregistré : ${practitioner.name}.`
  }

  async saveAppointmentKind(kind: {
    id: string
    name: string
    icon: string
    isActive: boolean
  }): Promise<void> {
    await (await this.app$()).catalogAdmin.saveAppointmentKind(kind)
    // Les motifs sont chargés une fois pour toutes : après un ajout, il faut les relire.
    await store.loadAppointmentKinds(true)
    this.message = `Motif de rendez-vous enregistré : ${kind.name}.`
  }

  /** Les plages où quelqu'un reçoit. Chacun tient les siennes ; l'administrateur, toutes. */
  async saveAvailability(practitionerId: string, windows: AvailabilityWindow[]): Promise<void> {
    await (await this.app$()).catalogAdmin.saveAvailability(practitionerId, windows)
    await store.loadCatalog(true)
    this.message = 'Disponibilités enregistrées.'
  }

  /**
   * Donne ou retire les droits d'administrateur. La personne devra se reconnecter :
   * c'est le jeton qui porte le rôle, et il ne se réécrit pas à distance.
   */
  async setStaffRole(
    uid: string,
    role: 'staff' | 'admin',
    options: { practitionerId?: string; firstName?: string } = {},
  ): Promise<boolean> {
    const resultat = await (await this.app$()).catalogAdmin.setStaffRole(uid, role, options)
    this.message = resultat.message
    return resultat.ok
  }

  /**
   * L'acceptation automatique des demandes de rendez-vous. Chacun décide pour lui ;
   * l'administrateur peut le faire pour n'importe qui, comme pour les plages.
   */
  async setAutoAccept(practitionerId: string, autoAccept: boolean): Promise<void> {
    await (await this.app$()).catalogAdmin.setAutoAccept(practitionerId, autoAccept)
    await store.loadCatalog(true)
    this.message = autoAccept
      ? 'Les demandes qui vous concernent seront acceptées automatiquement.'
      : 'Vous validerez vous-même chaque demande.'
  }

  /** Le catalogue est partagé avec l'écran patient : mêmes lieux, mêmes catégories. */
  get catalog() {
    return {
      categories: store.categories,
      locations: store.locations,
      services: store.services,
      practitioners: store.practitioners,
    }
  }
}

export const staffStore = new StaffStore()
