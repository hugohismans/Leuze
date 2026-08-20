/**
 * État de l'espace soignant. Comme pour le patient, ne connaît que les ports.
 */
import { createStaffApp } from './data'
import type {
  ActivityDraft,
  GenerationReport,
  RosterLine,
  StaffApp,
  StaffIdentity,
  StaffPatient,
} from './data/staffPorts'
import { describeGeneration } from './data/generation'
import { store } from './appState.svelte'
import { todayLocalDate, weekDays } from './domain/time'
import type { Activity, Appointment, LocalDate, LocalTime, Occurrence } from './domain/types'

const SIGNED_OUT: StaffIdentity = { uid: null, email: null, firstName: null, role: null }

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

  async loadAppointments(): Promise<void> {
    this.appointments = await (await this.app$()).repository.listAppointments().catch(() => [])
  }

  async scheduleAppointment(
    appointmentId: string,
    rendezVous: { date: LocalDate; time: LocalTime; durationMin: number; withWhom: string; locationId?: string },
  ): Promise<string> {
    const resultat = await (await this.app$()).repository.scheduleAppointment(appointmentId, rendezVous)
    await this.loadAppointments()
    this.message = resultat.message
    return resultat.message
  }

  async cancelAppointment(appointmentId: string, reason: string): Promise<void> {
    const resultat = await (await this.app$()).repository.cancelAppointment(appointmentId, reason)
    await this.loadAppointments()
    this.message = resultat.message
  }

  async loadPatients(): Promise<void> {
    this.patients = await (await this.app$()).repository.listPatients().catch(() => [])
  }

  async openRoster(occurrenceId: string): Promise<void> {
    this.roster = await (await this.app$()).repository.roster(occurrenceId).catch(() => [])
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

  activityOf(activityId: string): Activity | null {
    return this.activities.find((a) => a.id === activityId) ?? null
  }

  async getActivity(activityId: string): Promise<Activity | null> {
    return (await this.app$()).repository.getActivity(activityId)
  }

  private report(prefix: string, report: GenerationReport): void {
    this.message = `${prefix} ${describeGeneration(report)}`
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

  async saveCategory(category: {
    id: string
    name: string
    icon: string
    colorToken: string
  }): Promise<void> {
    await (await this.app$()).catalogAdmin.saveCategory(category)
    await store.loadCatalog(true)
    this.message = `Catégorie enregistrée : ${category.name}.`
  }

  /** Le catalogue est partagé avec l'écran patient : mêmes lieux, mêmes catégories. */
  get catalog() {
    return { categories: store.categories, locations: store.locations, services: store.services }
  }
}

export const staffStore = new StaffStore()
