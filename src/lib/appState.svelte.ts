/**
 * État de l'interface. Ne connaît que les ports (`AppRepository`),
 * jamais Firebase : brancher l'adapter Firestore au lot L1 ne touchera pas ce fichier.
 */
import { capacityOf } from './domain/capacity'
import { monthGrid, todayLocalDate, weekDays } from './domain/time'
import type { Category, LocalDate, Location, Occurrence, Service } from './domain/types'
import { chooseSource, createRepository, isMockRepository, type DataSource } from './data'
import type { AppRepository, MyRegistration } from './data/ports'

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
  readonly source: DataSource = chooseSource()
  readonly repository: AppRepository = createRepository(this.source)
  /** Vrai sur l'écran de démonstration : données fictives, panneau de réglage visible. */
  readonly isDemo = this.source === 'mock'

  view = $state<CalendarView>(defaultView())
  date = $state<LocalDate>(todayLocalDate())
  categoryId = $state<string | null>(null)
  locationId = $state<string | null>(null)
  onlyAvailable = $state(false)

  categories = $state<Category[]>([])
  locations = $state<Location[]>([])
  services = $state<Service[]>([])
  /** Service du patient connecté : décide de ce que le calendrier contient. */
  serviceId = $state<string | null>(this.repository.session.current().serviceId)
  firstName = $state<string | null>(this.repository.session.current().firstName)
  /** Vrai tant que le patient n'a pas saisi son code (hors démonstration). */
  signedIn = $state<boolean>(this.repository.session.current().patientUid !== null)
  occurrences = $state<Occurrence[]>([])
  mine = $state<MyRegistration[]>([])
  loading = $state(true)

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

  /**
   * Démonstration uniquement : change le service du patient fictif pour montrer
   * qu'il ne voit que les activités ouvertes à son service.
   */
  setDemoService(serviceId: string): void {
    if (!isMockRepository(this.repository)) return
    this.repository.setDemoService(serviceId)
    this.serviceId = serviceId
  }

  /** Recopie l'état de la session dans l'interface après une connexion ou une déconnexion. */
  private syncSession(): void {
    const session = this.repository.session.current()
    this.serviceId = session.serviceId
    this.firstName = session.firstName
    this.signedIn = session.patientUid !== null
  }

  async signInWithCode(code: string): Promise<{ ok: boolean; message?: string }> {
    const result = await this.repository.session.signInWithCode(code)
    this.syncSession()
    if (result.ok) await this.refresh()
    return result.ok ? { ok: true } : { ok: false, message: result.message }
  }

  async signOut(): Promise<void> {
    await this.repository.session.signOut()
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
  async loadCatalog(): Promise<void> {
    if (this.catalogLoaded) return
    this.catalogLoaded = true
    const [categories, locations, services] = await Promise.all([
      this.repository.catalog.listCategories(),
      this.repository.catalog.listLocations(),
      this.repository.catalog.listServices(),
    ])
    this.categories = categories
    this.locations = locations
    this.services = services
  }

  async refresh(): Promise<void> {
    const { from, to } = this.range
    this.loading = true
    const [occurrences, mine] = await Promise.all([
      this.repository.occurrences.listBetween(from, to),
      this.repository.registrations.listMine(),
    ])
    this.occurrences = occurrences
    this.mine = mine
    // La session Firebase est restaurée de façon asynchrone au démarrage : à ce
    // point-ci elle est connue, on aligne l'interface dessus.
    this.syncSession()
    this.loading = false
  }

  /** Après une inscription : on relit l'occurrence concernée et « Mes inscriptions ». */
  async refreshOccurrence(occurrenceId: string): Promise<void> {
    const [updated, mine] = await Promise.all([
      this.repository.occurrences.get(occurrenceId),
      this.repository.registrations.listMine(),
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
