/**
 * Espace soignant en mémoire : c'est lui qui alimente `/demo`.
 * Même logique de génération que l'adapter Firestore, mêmes fonctions du domaine.
 */
import { todayLocalDate } from '../../domain/time'
import type { Activity, LocalDate, Occurrence } from '../../domain/types'
import { generationWindow, planGeneration } from '../generation'
import { activitiesSeed } from '../seed/activities.seed'
import { mockCatalog } from './catalog'
import { applyBoard, boardOf, world } from './state'
import { registrationBlockMessage } from '../../domain/capacity'
import {
  register as domainRegister,
  unregister as domainUnregister,
  rosterOf,
  waitlistPosition,
} from '../../domain/waitlist'
import type {
  ActivityDraft,
  GenerationReport,
  RosterLine,
  StaffApp,
  StaffIdentity,
  StaffPatient,
} from '../staffPorts'

const DEMO_STAFF: StaffIdentity = {
  uid: 'demo-soignant',
  email: 'soignant@exemple.test',
  firstName: 'Marc',
  role: 'admin',
}

const SIGNED_OUT: StaffIdentity = { uid: null, email: null, firstName: null, role: null }

export function createMockStaffApp(): StaffApp {
  // Les activités vivent ici, les occurrences et les inscriptions dans le monde partagé
  // avec l'adapter patient : ce qui est décidé en réunion se voit côté patient.
  const activities = new Map<string, Activity>(activitiesSeed.map((a) => [a.id, a]))
  let identity: StaffIdentity = SIGNED_OUT

  const regenerate = (activityId: string, activity: Activity | null): GenerationReport => {
    const window = generationWindow()
    const existing = [...world.occurrences.values()].filter(
      (o) => o.activityId === activityId && o.localDate >= window.from && o.localDate <= window.to,
    )
    const plan = planGeneration(activity, existing, window)
    for (const occurrence of plan.write) world.occurrences.set(occurrence.id, occurrence)
    for (const id of plan.remove) world.occurrences.delete(id)
    return plan.report
  }

  return {
    session: {
      current: () => identity,
      async signIn(email: string) {
        // En démonstration, n'importe quelle adresse ouvre l'espace soignant.
        if (!email.includes('@')) {
          return { ok: false as const, message: "L'adresse ou le mot de passe ne correspond pas." }
        }
        identity = { ...DEMO_STAFF, email: email.trim() }
        return { ok: true as const }
      },
      async signOut() {
        identity = SIGNED_OUT
      },
    },

    repository: {
      async listActivities(): Promise<Activity[]> {
        return [...activities.values()].sort((a, b) => a.title.localeCompare(b.title, 'fr'))
      },

      async getActivity(activityId: string): Promise<Activity | null> {
        return activities.get(activityId) ?? null
      },

      async saveActivity(draft: ActivityDraft) {
        const activityId = draft.id ?? `activite-${activities.size + 1}-${Date.now()}`
        const activity: Activity = {
          ...(draft as Omit<Activity, 'id'>),
          id: activityId,
          seriesId: draft.seriesId ?? `serie-${activityId}`,
        }
        activities.set(activityId, activity)
        return { activityId, report: regenerate(activityId, activity) }
      },

      async setActivityActive(activityId: string, isActive: boolean): Promise<GenerationReport> {
        const activity = activities.get(activityId)
        if (!activity) return { created: 0, updated: 0, preserved: 0, cancelled: 0, removed: 0 }
        const modifiee = { ...activity, isActive }
        activities.set(activityId, modifiee)
        return regenerate(activityId, modifiee)
      },

      async duplicateActivity(activityId: string): Promise<string> {
        const source = activities.get(activityId)
        if (!source) throw new Error("Cette activité n'existe plus.")
        const nouvelId = `${activityId}-copie-${Date.now()}`
        activities.set(nouvelId, {
          ...source,
          id: nouvelId,
          seriesId: `serie-${nouvelId}`,
          title: `${source.title} (copie)`,
          isActive: false,
        })
        return nouvelId
      },

      async listOccurrences(from: LocalDate, to: LocalDate): Promise<Occurrence[]> {
        return [...world.occurrences.values()]
          .filter((o) => o.localDate >= from && o.localDate <= to)
          .sort((a, b) => a.start.getTime() - b.start.getTime())
      },

      async cancelOccurrence(occurrenceId: string, reason: string): Promise<void> {
        const occurrence = world.occurrences.get(occurrenceId)
        if (!occurrence) return
        world.occurrences.set(occurrenceId, {
          ...occurrence,
          status: 'cancelled',
          cancellationReason: reason,
          overridden: true,
        })
      },

      async restoreOccurrence(occurrenceId: string): Promise<void> {
        const occurrence = world.occurrences.get(occurrenceId)
        if (!occurrence) return
        const { cancellationReason: _motif, ...reste } = occurrence
        world.occurrences.set(occurrenceId, { ...reste, status: 'scheduled', overridden: true })
      },

      async roster(occurrenceId: string): Promise<RosterLine[]> {
        const board = boardOf(occurrenceId)
        if (board === null) return []
        const { confirmed, waitlist } = rosterOf(board)
        const prenom = (uid: string) => world.patients.find((p) => p.uid === uid)
        const ligne = (uid: string, status: 'confirmed' | 'waitlist', position: number | null): RosterLine => ({
          patientUid: uid,
          firstName: prenom(uid)?.firstName ?? 'Prénom inconnu',
          serviceId: prenom(uid)?.serviceId ?? null,
          status,
          position,
        })
        return [
          ...confirmed.map((r) => ligne(r.patientUid, 'confirmed', null)),
          ...waitlist.map((r) => ligne(r.patientUid, 'waitlist', waitlistPosition(board, r.patientUid))),
        ]
      },

      async listPatients(): Promise<StaffPatient[]> {
        return [...world.patients].sort((a, b) => a.firstName.localeCompare(b.firstName, 'fr'))
      },

      async registerPatient(occurrenceId: string, patientUid: string) {
        const board = boardOf(occurrenceId)
        if (board === null) return { ok: false, message: "Cette activité n'a pas été trouvée." }
        const outcome = domainRegister(board, patientUid, {
          now: new Date(),
          registrationId: `${occurrenceId}--${patientUid}--${Date.now()}`,
          by: 'staff',
        })
        if (!outcome.ok) {
          return {
            ok: false,
            message:
              outcome.reason === 'already-registered'
                ? 'Cette personne est déjà inscrite.'
                : registrationBlockMessage(outcome.reason),
          }
        }
        applyBoard(outcome.board)
        return {
          ok: true,
          status: outcome.status,
          message: outcome.status === 'confirmed' ? 'Inscrit' : "Sur la liste d'attente",
        }
      },

      async unregisterPatient(occurrenceId: string, patientUid: string) {
        const board = boardOf(occurrenceId)
        if (board === null) return { ok: false, message: "Cette activité n'a pas été trouvée." }
        const outcome = domainUnregister(board, patientUid)
        if (!outcome.ok) return { ok: false, message: "Cette personne n'était pas inscrite." }
        applyBoard(outcome.board)
        return { ok: true, message: 'Retiré de la liste.' }
      },
    },

    catalogAdmin: {
      async saveLocation(location) {
        mockCatalog.saveLocation(location)
      },
      async saveService(service) {
        mockCatalog.saveService(service)
      },
      async saveCategory(category) {
        mockCatalog.saveCategory(category)
      },
    },
  }
}
