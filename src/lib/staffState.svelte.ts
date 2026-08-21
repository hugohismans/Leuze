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
  StaffPatient,
} from './data/staffPorts'
import { describeGeneration } from './data/generation'
import type { PatientPlanning } from './data/staffPorts'
import type { CatalogKind } from './domain/catalog'
import { store } from './appState.svelte'
import { todayLocalDate, weekDays } from './domain/time'
import type { Activity, Appointment, LocalDate, LocalTime, Occurrence } from './domain/types'

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
      await Promise.all([store.loadCatalog(true), this.refresh(), this.loadPatients(), this.loadAppointments()])
    }
    return result.ok ? { ok: true } : { ok: false, message: result.message }
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
      await Promise.all([store.loadCatalog(true), this.loadPatients(), this.loadAppointments()])
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
    const resultat = await (await this.app$()).repository.endStay(patientUid)
    await this.loadPatients()
    this.message = resultat.message
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

  async openRoster(occurrenceId: string): Promise<void> {
    const resultat = await (await this.app$()).repository
      .roster(occurrenceId)
      .catch(() => ({ lines: [], canMarkAttendance: false }))
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

  isRegistered(patientUid: string): boolean {
    return this.roster.some((ligne) => ligne.patientUid === patientUid)
  }

  /**
   * Le geste de la réunion : on clique sur un prénom, il est inscrit ; on reclique,
   * il est retiré. Rien d'autre à faire — le patient retrouvera l'activité dans son
   * calendrier s'il ouvre l'application.
   */
  async togglePatient(occurrenceId: string, patientUid: string): Promise<string> {
    const repository = (await this.app$()).repository
    const inscrit = this.isRegistered(patientUid)
    const resultat = inscrit
      ? await repository.unregisterPatient(occurrenceId, patientUid)
      : await repository.registerPatient(occurrenceId, patientUid)

    await this.openRoster(occurrenceId)
    await this.refresh()
    return resultat.message
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
  async removeActivity(activityId: string): Promise<void> {
    const plan = await (await this.app$()).repository.deleteActivity(activityId)
    await this.refresh()
    this.message = plan.message
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
