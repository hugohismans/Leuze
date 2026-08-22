/**
 * État de l'interface. Ne connaît que les ports (`AppRepository`),
 * jamais Firebase : brancher l'adapter Firestore au lot L1 ne touchera pas ce fichier.
 */
import { upcomingScheduled } from './domain/appointments'
import { capacityOf } from './domain/capacity'
import { monthGrid, todayLocalDate, weekDays } from './domain/time'
import type {
  Appointment,
  AppointmentKind,
  AppointmentPreference,
  Category,
  LocalDate,
  Location,
  Occurrence,
  Practitioner,
  Service,
} from './domain/types'
import { createRepository, isMockRepository, usesMock } from './data'
import type { AppRepository, MyRegistration, RegisterResult } from './data/ports'

export type CalendarView = 'day' | 'week' | 'month'

/** Sur borne et mobile la vue par défaut est « jour », sur ordinateur « semaine ». */
function defaultView(): CalendarView {
  if (typeof window === 'undefined') return 'day'
  return window.matchMedia('(min-width: 1024px)').matches ? 'week' : 'day'
}

function rangeOf(view: CalendarView, date: LocalDate): { from: LocalDate; to: LocalDate } {
  if (view === 'day') return { from: date, to: date }
  if (view === 'week') {
    const days = weekDays(date)
    return { from: days[0]!, to: days[6]! }
  }
  const grid = monthGrid(date)
  return { from: grid[0]![0]!, to: grid.at(-1)!.at(-1)! }
}

export function hasFreePlaces(occurrence: Occurrence): boolean {
  const state = capacityOf(occurrence)
  return state.kind === 'available' || state.kind === 'last-places' || state.kind === 'unlimited' || state.kind === 'no-registration'
}

class AppStore {
  /**
   * L'adapter est chargé à la demande — c'est ce qui permet de ne pas embarquer Firebase
   * dans la version de démonstration. Tous les accès passent donc par `repo()`.
   */
  private readonly loading$: Promise<AppRepository> = createRepository()
  private repository: AppRepository | null = null

  /** Vrai sur l'écran de démonstration : données fictives, panneau de réglage visible. */
  readonly isDemo = usesMock()

  private async repo(): Promise<AppRepository> {
    if (this.repository === null) this.repository = await this.loading$
    return this.repository
  }

  view = $state<CalendarView>(defaultView())
  date = $state<LocalDate>(todayLocalDate())
  categoryId = $state<string | null>(null)
  locationId = $state<string | null>(null)
  onlyAvailable = $state(false)

  categories = $state<Category[]>([])
  locations = $state<Location[]>([])
  services = $state<Service[]>([])
  /** Les intervenants : psychiatre, kinésithérapeute, animateur. */
  practitioners = $state<Practitioner[]>([])
  /** Service du patient connecté : décide de ce que le calendrier contient. */
  serviceId = $state<string | null>(null)
  firstName = $state<string | null>(null)
  /** Vrai tant que le patient n'a pas saisi son code (hors démonstration). */
  signedIn = $state<boolean>(false)
  occurrences = $state<Occurrence[]>([])
  mine = $state<MyRegistration[]>([])
  /** Rendez-vous individuels du patient : demandés, ou déjà fixés. */
  appointments = $state<Appointment[]>([])
  appointmentKinds = $state<AppointmentKind[]>([])
  loading = $state(true)
  /** Vrai quand la dernière lecture n'a pas abouti : l'écran doit le dire et proposer de réessayer. */
  lectureEchouee = $state<boolean>(false)

  readonly range = $derived(rangeOf(this.view, this.date))

  readonly visible = $derived(
    this.occurrences.filter((o) => {
      if (this.categoryId !== null && o.categoryId !== this.categoryId) return false
      if (this.locationId !== null && o.locationId !== this.locationId) return false
      // Les activités annulées restent visibles par défaut : les faire disparaître
      // désoriente le patient qui les attendait (§5 du brief).
      if (this.onlyAvailable && (o.status === 'cancelled' || !hasFreePlaces(o))) return false
      return true
    }),
  )

  readonly hasFilters = $derived(this.categoryId !== null || this.locationId !== null || this.onlyAvailable)

  byDay(date: LocalDate): Occurrence[] {
    return this.visible.filter((o) => o.localDate === date)
  }

  categoryOf(id: string): Category | null {
    return this.categories.find((c) => c.id === id) ?? null
  }

  locationOf(id: string): Location | null {
    return this.locations.find((l) => l.id === id) ?? null
  }

  serviceOf(id: string | null): Service | null {
    if (id === null) return null
    return this.services.find((s) => s.id === id) ?? null
  }

  practitionerOf(practitionerId: string | undefined): Practitioner | null {
    if (practitionerId === undefined) return null
    return this.practitioners.find((p) => p.id === practitionerId) ?? null
  }

  /**
   * Démonstration uniquement : change le service du patient fictif pour montrer
   * qu'il ne voit que les activités ouvertes à son service.
   */
  setDemoService(serviceId: string): void {
    if (this.repository === null || !isMockRepository(this.repository)) return
    this.repository.setDemoService(serviceId)
    this.serviceId = serviceId
  }

  /** Recopie l'état de la session dans l'interface après une connexion ou une déconnexion. */
  private syncSession(): void {
    if (this.repository === null) return
    const session = this.repository.session.current()
    this.serviceId = session.serviceId
    this.firstName = session.firstName
    this.signedIn = session.patientUid !== null
  }

  /** Réveille la fonction qui échange un code, sans rien échanger. Voir le port. */
  async warmSignIn(): Promise<void> {
    await (await this.repo()).session.warmSignIn().catch(() => undefined)
  }

  async signInWithCode(code: string): Promise<{ ok: boolean; message?: string }> {
    const result = await (await this.repo()).session.signInWithCode(code)
    this.syncSession()
    if (result.ok) await this.refresh()
    return result.ok ? { ok: true } : { ok: false, message: result.message }
  }

  async signOut(): Promise<void> {
    await (await this.repo()).session.signOut()
    this.syncSession()
    this.occurrences = []
    this.mine = []
  }

  clearFilters(): void {
    this.categoryId = null
    this.locationId = null
    this.onlyAvailable = false
  }

  private catalogLoaded = false

  /**
   * Lieux, catégories et services ne sont lisibles qu'une fois connecté : les règles
   * refusent la lecture à un visiteur anonyme. Ce chargement attend donc la session.
   */
  /**
   * Les écrans passent par ces méthodes plutôt que par le dépôt : un composant n'a pas
   * à connaître la couche de données, et l'adapter peut rester chargé à la demande.
   */
  async getOccurrence(occurrenceId: string): Promise<Occurrence | null> {
    return (await this.repo()).occurrences.get(occurrenceId)
  }

  async registerTo(occurrenceId: string): Promise<RegisterResult> {
    return (await this.repo()).registrations.register(occurrenceId)
  }

  async unregisterFrom(occurrenceId: string): Promise<{ ok: boolean; message: string }> {
    return (await this.repo()).registrations.unregister(occurrenceId)
  }

  /** Réveille la fonction d'inscription, sans rien inscrire. Voir le port. */
  async warmRegistration(): Promise<void> {
    await (await this.repo()).registrations.warmRegistration().catch(() => undefined)
  }

  /**
   * Le catalogue ne change quasiment jamais : il n'est chargé qu'une fois. L'écran
   * d'administration, lui, doit forcer la relecture après avoir ajouté un lieu.
   */
  /**
   * Les inscriptions encore à venir. C'est ce qu'on montre au patient : une séance
   * passée n'appelle aucune décision, et la faire figurer noierait ce qui compte.
   * « Ma semaine », elle, garde tout, pour pouvoir revenir sur une semaine écoulée.
   */
  readonly upcomingMine = $derived(this.mine.filter((r) => r.occurrence.end.getTime() >= Date.now()))

  /** Les rendez-vous fixés, passés compris : la semaine les affiche tous, à leur jour. */
  readonly scheduledAppointments = $derived(
    this.appointments
      .filter((a) => a.status === 'scheduled' && a.start !== undefined)
      .sort((a, b) => (a.start?.getTime() ?? 0) - (b.start?.getTime() ?? 0)),
  )

  /**
   * Ceux qui restent à venir — les seuls qui comptent dans « Mes inscriptions ».
   *
   * Cet écran répond à « qu'est-ce que j'ai de prévu ». Un rendez-vous d'avant-hier y
   * répondait faux, et il comptait même dans le nombre affiché en haut de l'écran : on
   * croyait avoir deux rendez-vous quand il n'en restait qu'un. La règle est celle des
   * inscriptions, juste au-dessus : ce qui n'est pas terminé.
   */
  readonly upcomingAppointments = $derived(upcomingScheduled(this.appointments))

  readonly pendingAppointments = $derived(this.appointments.filter((a) => a.status === 'requested'))

  /**
   * Les motifs de rendez-vous seuls, sans les demandes.
   *
   * L'espace soignant en a besoin partout — pour nommer un rendez-vous sur un planning,
   * pour relier un intervenant à son motif — mais il n'a pas de demandes « à lui » :
   * `loadAppointments` lui rapporterait une liste vide et une requête pour rien.
   */
  async loadAppointmentKinds(force = false): Promise<void> {
    if (!force && this.appointmentKinds.length > 0) return
    this.appointmentKinds = await (await this.repo()).appointments.listKinds().catch(() => [])
  }

  async loadAppointments(): Promise<void> {
    const repository = await this.repo()
    const [kinds, mine] = await Promise.all([
      repository.appointments.listKinds().catch(() => []),
      repository.appointments.listMine().catch(() => []),
    ])
    this.appointmentKinds = kinds
    this.appointments = mine
  }

  async requestAppointment(
    kindId: string,
    preference: AppointmentPreference,
  ): Promise<{ ok: boolean; message: string }> {
    const resultat = await (await this.repo()).appointments.request(kindId, preference)
    await this.loadAppointments()
    return resultat
  }

  async withdrawAppointment(appointmentId: string): Promise<{ ok: boolean; message: string }> {
    const resultat = await (await this.repo()).appointments.withdraw(appointmentId)
    await this.loadAppointments()
    return resultat
  }

  async loadCatalog(force = false): Promise<void> {
    if (this.catalogLoaded && !force) return
    this.catalogLoaded = true
    try {
      const [categories, locations, services, practitioners] = await Promise.all([
        (await this.repo()).catalog.listCategories(),
        (await this.repo()).catalog.listLocations(),
        (await this.repo()).catalog.listServices(),
        (await this.repo()).catalog.listPractitioners(),
      ])
      this.categories = categories
      this.locations = locations
      this.services = services
      this.practitioners = practitioners
    } catch {
      // Une lecture manquée ne doit pas condamner le catalogue pour toute la session :
      // le prochain passage réessaiera.
      this.catalogLoaded = false
    }
  }

  /**
   * Relit le programme et les inscriptions.
   *
   * Le `finally` n'est pas une précaution de style : sans lui, une lecture qui échoue
   * laissait `loading` à vrai pour toujours, et l'application restait sur « Un instant… »
   * sans que la personne puisse rien faire — pas même redemander son code.
   */
  /**
   * Relit le programme, puis le reste.
   *
   * Le calendrier n'attend que les séances : elles viennent de Firestore, souvent du
   * cache local, et s'affichent presque tout de suite. Les inscriptions personnelles et
   * les rendez-vous passent par des fonctions appelables — plusieurs secondes quand
   * elles dormaient depuis un moment — et arrivent derrière, sans retenir l'écran. Les
   * attendre toutes, c'était « Un instant… » pendant dix secondes pour afficher un
   * programme déjà en mémoire.
   *
   * Le `finally` n'est pas une précaution de style : sans lui, une lecture qui échoue
   * laissait `loading` à vrai pour toujours, et l'application restait sur « Un instant… »
   * sans que la personne puisse rien faire — pas même redemander son code.
   */
  async refresh(): Promise<void> {
    const { from, to } = this.range
    this.loading = true
    try {
      this.occurrences = await (await this.repo()).occurrences.listBetween(from, to)
      this.lectureEchouee = false
    } catch {
      // Rien à afficher plutôt qu'un écran bloqué. La session, elle, est relue ci-dessous.
      this.occurrences = []
      this.lectureEchouee = true
    } finally {
      // La session Firebase est restaurée de façon asynchrone au démarrage : à ce
      // point-ci elle est connue, on aligne l'interface dessus.
      this.syncSession()
      this.loading = false
    }

    // Ce qui suit complète l'écran sans jamais le bloquer.
    void this.loadMine()
    void this.loadAppointments()
  }

  /** Les inscriptions du patient, en arrière-plan : leur absence ne cache pas le programme. */
  private async loadMine(): Promise<void> {
    try {
      this.mine = await (await this.repo()).registrations.listMine()
    } catch {
      this.mine = []
    }
  }

  /** Après une inscription : on relit l'occurrence concernée et « Mes inscriptions ». */
  async refreshOccurrence(occurrenceId: string): Promise<void> {
    const [updated, mine] = await Promise.all([
      (await this.repo()).occurrences.get(occurrenceId),
      (await this.repo()).registrations.listMine(),
    ])
    if (updated) {
      this.occurrences = this.occurrences.map((o) => (o.id === occurrenceId ? updated : o))
    }
    this.mine = mine
  }

  myStatusFor(occurrenceId: string): MyRegistration | null {
    return this.mine.find((r) => r.occurrence.id === occurrenceId) ?? null
  }
}

export const store = new AppStore()
