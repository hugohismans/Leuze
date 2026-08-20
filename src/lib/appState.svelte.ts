/**
 * État de l'interface. Ne connaît que les ports (`AppRepository`),
 * jamais Firebase : brancher l'adapter Firestore au lot L1 ne touchera pas ce fichier.
 */
import { capacityOf } from './domain/capacity'
import { monthGrid, todayLocalDate, weekDays } from './domain/time'
import type { Category, LocalDate, Location, Occurrence } from './domain/types'
import { createMockRepository } from './data/mock/mockRepository'
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
  readonly repository: AppRepository = createMockRepository()

  view = $state<CalendarView>(defaultView())
  date = $state<LocalDate>(todayLocalDate())
  categoryId = $state<string | null>(null)
  locationId = $state<string | null>(null)
  onlyAvailable = $state(false)

  categories = $state<Category[]>([])
  locations = $state<Location[]>([])
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

  clearFilters(): void {
    this.categoryId = null
    this.locationId = null
    this.onlyAvailable = false
  }

  async loadCatalog(): Promise<void> {
    const [categories, locations] = await Promise.all([
      this.repository.catalog.listCategories(),
      this.repository.catalog.listLocations(),
    ])
    this.categories = categories
    this.locations = locations
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
