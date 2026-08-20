/**
 * Espace soignant en mémoire : c'est lui qui alimente `/demo`.
 * Même logique de génération que l'adapter Firestore, mêmes fonctions du domaine.
 */
import { todayLocalDate } from '../../domain/time'
import type { Activity, LocalDate, Occurrence } from '../../domain/types'
import { generationWindow, planGeneration } from '../generation'
import { activitiesSeed } from '../seed/activities.seed'
import { categoriesSeed } from '../seed/categories.seed'
import { locationsSeed } from '../seed/locations.seed'
import { servicesSeed } from '../seed/services.seed'
import type {
  ActivityDraft,
  GenerationReport,
  RosterLine,
  StaffApp,
  StaffIdentity,
} from '../staffPorts'

const DEMO_STAFF: StaffIdentity = {
  uid: 'demo-soignant',
  email: 'soignant@exemple.test',
  firstName: 'Marc',
  role: 'admin',
}

const SIGNED_OUT: StaffIdentity = { uid: null, email: null, firstName: null, role: null }

type State = {
  identity: StaffIdentity
  activities: Map<string, Activity>
  occurrences: Map<string, Occurrence>
}

function buildState(): State {
  const activities = new Map(activitiesSeed.map((a) => [a.id, a]))
  const occurrences = new Map<string, Occurrence>()
  const window = generationWindow(todayLocalDate())
  for (const activity of activities.values()) {
    for (const occurrence of planGeneration(activity, [], window).write) {
      occurrences.set(occurrence.id, occurrence)
    }
  }
  return { identity: SIGNED_OUT, activities, occurrences }
}

export function createMockStaffApp(): StaffApp {
  const state = buildState()

  const regenerate = (activityId: string, activity: Activity | null): GenerationReport => {
    const window = generationWindow()
    const existing = [...state.occurrences.values()].filter(
      (o) => o.activityId === activityId && o.localDate >= window.from && o.localDate <= window.to,
    )
    const plan = planGeneration(activity, existing, window)
    for (const occurrence of plan.write) state.occurrences.set(occurrence.id, occurrence)
    for (const id of plan.remove) state.occurrences.delete(id)
    return plan.report
  }

  return {
    session: {
      current: () => state.identity,
      async signIn(email: string) {
        // En démonstration, n'importe quelle adresse ouvre l'espace soignant.
        if (!email.includes('@')) {
          return { ok: false as const, message: "L'adresse ou le mot de passe ne correspond pas." }
        }
        state.identity = { ...DEMO_STAFF, email: email.trim() }
        return { ok: true as const }
      },
      async signOut() {
        state.identity = SIGNED_OUT
      },
    },

    repository: {
      async listActivities(): Promise<Activity[]> {
        return [...state.activities.values()].sort((a, b) => a.title.localeCompare(b.title, 'fr'))
      },

      async getActivity(activityId: string): Promise<Activity | null> {
        return state.activities.get(activityId) ?? null
      },

      async saveActivity(draft: ActivityDraft) {
        const activityId = draft.id ?? `activite-${state.activities.size + 1}-${Date.now()}`
        const activity: Activity = {
          ...(draft as Omit<Activity, 'id'>),
          id: activityId,
          seriesId: draft.seriesId ?? `serie-${activityId}`,
        }
        state.activities.set(activityId, activity)
        return { activityId, report: regenerate(activityId, activity) }
      },

      async setActivityActive(activityId: string, isActive: boolean): Promise<GenerationReport> {
        const activity = state.activities.get(activityId)
        if (!activity) return { created: 0, updated: 0, preserved: 0, cancelled: 0, removed: 0 }
        const modifiee = { ...activity, isActive }
        state.activities.set(activityId, modifiee)
        return regenerate(activityId, modifiee)
      },

      async duplicateActivity(activityId: string): Promise<string> {
        const source = state.activities.get(activityId)
        if (!source) throw new Error("Cette activité n'existe plus.")
        const nouvelId = `${activityId}-copie-${Date.now()}`
        state.activities.set(nouvelId, {
          ...source,
          id: nouvelId,
          seriesId: `serie-${nouvelId}`,
          title: `${source.title} (copie)`,
          isActive: false,
        })
        return nouvelId
      },

      async listOccurrences(from: LocalDate, to: LocalDate): Promise<Occurrence[]> {
        return [...state.occurrences.values()]
          .filter((o) => o.localDate >= from && o.localDate <= to)
          .sort((a, b) => a.start.getTime() - b.start.getTime())
      },

      async cancelOccurrence(occurrenceId: string, reason: string): Promise<void> {
        const occurrence = state.occurrences.get(occurrenceId)
        if (!occurrence) return
        state.occurrences.set(occurrenceId, {
          ...occurrence,
          status: 'cancelled',
          cancellationReason: reason,
          overridden: true,
        })
      },

      async restoreOccurrence(occurrenceId: string): Promise<void> {
        const occurrence = state.occurrences.get(occurrenceId)
        if (!occurrence) return
        const { cancellationReason: _motif, ...reste } = occurrence
        state.occurrences.set(occurrenceId, { ...reste, status: 'scheduled', overridden: true })
      },

      async roster(): Promise<RosterLine[]> {
        // La démonstration ne montre pas de prénoms de patients, même fictifs.
        return []
      },
    },

    catalogAdmin: {
      async saveLocation(location) {
        const index = locationsSeed.findIndex((l) => l.id === location.id)
        if (index === -1) locationsSeed.push({ ...location })
        else Object.assign(locationsSeed[index]!, location)
      },
      async saveService(service) {
        const index = servicesSeed.findIndex((s) => s.id === service.id)
        if (index === -1) servicesSeed.push({ ...service })
        else Object.assign(servicesSeed[index]!, service)
      },
      async saveCategory(category) {
        const index = categoriesSeed.findIndex((c) => c.id === category.id)
        if (index === -1) categoriesSeed.push({ ...category })
        else Object.assign(categoriesSeed[index]!, category)
      },
    },
  }
}
