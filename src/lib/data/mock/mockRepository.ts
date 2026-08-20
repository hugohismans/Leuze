/**
 * Adapter en mémoire. Il sert deux usages :
 *  - l'écran de démonstration, montrable sans le moindre backend ;
 *  - les tests de composants.
 * Il applique exactement les mêmes réducteurs de domaine que ceux qui tourneront
 * dans la transaction Firestore : le comportement démontré est le comportement réel.
 */
import { config } from '../../config'
import { isVisibleToService } from '../../domain/audience'
import { expand } from '../../domain/recurrence'
import { addLocalDays, todayLocalDate } from '../../domain/time'
import type { Category, LocalDate, Location, Occurrence, Registration, Service } from '../../domain/types'
import {
  register as domainRegister,
  unregister as domainUnregister,
  recount,
  registrationOf,
  waitlistPosition,
  type Board,
} from '../../domain/waitlist'
import { registrationBlockMessage, type RegistrationBlock } from '../../domain/capacity'
import type { AppRepository, MyRegistration, PatientSession, RegisterResult } from '../ports'
import { mockCatalog } from './catalog'
import { activitiesSeed } from '../seed/activities.seed'

export const DEMO_PATIENT_UID = 'demo-patient'
/** Service du patient fictif au démarrage de la démonstration. */
export const DEMO_SERVICE_ID = 'le-mazurel'

/** Hachage stable : la démonstration montre les mêmes taux de remplissage à chaque ouverture. */
function stableHash(value: string): number {
  let h = 2166136261
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return Math.abs(h)
}

type MockState = {
  occurrences: Map<string, Occurrence>
  registrations: Registration[]
  session: PatientSession
}

function buildState(now: Date): MockState {
  const today = todayLocalDate(now)
  const from = addLocalDays(today, -28)
  const to = addLocalDays(today, config.generationWindowWeeks * 7)

  const occurrences = new Map<string, Occurrence>()
  for (const activity of activitiesSeed) {
    for (const occurrence of expand(activity, from, to)) occurrences.set(occurrence.id, occurrence)
  }

  const registrations: Registration[] = []
  for (const occurrence of occurrences.values()) {
    if (!occurrence.registrationRequired || occurrence.capacity === null) continue
    const seed = stableHash(occurrence.id)
    // Volontairement jusqu'à capacity + 2 : certaines occurrences sont complètes
    // avec une liste d'attente, pour que la démonstration montre ce cas.
    const filled = seed % (occurrence.capacity + 2)
    for (let i = 0; i < filled; i++) {
      const queuedAt = new Date(occurrence.start.getTime() - (filled - i) * 3_600_000)
      registrations.push({
        id: `${occurrence.id}--demo-${i}`,
        occurrenceId: occurrence.id,
        patientUid: `demo-autre-${i}`,
        status: i < occurrence.capacity ? 'confirmed' : 'waitlist',
        createdAt: queuedAt,
        queuedAt,
        createdBy: 'patient',
      })
    }
  }

  const state: MockState = {
    occurrences,
    registrations,
    session: { patientUid: DEMO_PATIENT_UID, firstName: 'Camille', serviceId: DEMO_SERVICE_ID },
  }
  for (const occurrence of occurrences.values()) syncCounts(state, occurrence.id)
  return state
}

function boardOf(state: MockState, occurrenceId: string): Board | null {
  const occurrence = state.occurrences.get(occurrenceId)
  if (!occurrence) return null
  return { occurrence, registrations: state.registrations.filter((r) => r.occurrenceId === occurrenceId) }
}

function syncCounts(state: MockState, occurrenceId: string): void {
  const board = boardOf(state, occurrenceId)
  if (!board) return
  state.occurrences.set(occurrenceId, recount(board).occurrence)
}

function applyBoard(state: MockState, board: Board): void {
  state.occurrences.set(board.occurrence.id, board.occurrence)
  const others = state.registrations.filter((r) => r.occurrenceId !== board.occurrence.id)
  state.registrations = [...others, ...board.registrations]
}

const REFUS: Record<RegistrationBlock | 'already-registered', string> = {
  cancelled: registrationBlockMessage('cancelled'),
  past: registrationBlockMessage('past'),
  'no-registration-required': registrationBlockMessage('no-registration-required'),
  'full-no-waitlist': registrationBlockMessage('full-no-waitlist'),
  'already-registered': 'Vous êtes déjà inscrit à cette activité.',
}

export type MockRepository = AppRepository & {
  /** Remet les données de démonstration à zéro. */
  reset(): void
  /**
   * Réservé à la démonstration : change le service du patient fictif, pour montrer
   * qu'un patient ne voit que les activités ouvertes à son service.
   * Cette méthode n'existe pas dans l'adapter Firestore.
   */
  setDemoService(serviceId: string): void
}

export function createMockRepository(options: { now?: () => Date } = {}): MockRepository {
  const clock = options.now ?? (() => new Date())
  let state = buildState(clock())

  const myRegistration = (occurrenceId: string): MyRegistration | null => {
    const board = boardOf(state, occurrenceId)
    if (!board || state.session.patientUid === null) return null
    const mine = registrationOf(board, state.session.patientUid)
    if (mine === null || mine.status === 'cancelled') return null
    return {
      occurrence: board.occurrence,
      status: mine.status,
      position: mine.status === 'waitlist' ? waitlistPosition(board, state.session.patientUid) : null,
    }
  }

  return {
    catalog: {
      // Le catalogue est partagé avec l'écran soignant : un lieu ajouté là-bas
      // apparaît ici sans rechargement.
      async listLocations(): Promise<Location[]> {
        return mockCatalog.locations()
      },
      async listCategories(): Promise<Category[]> {
        return mockCatalog.categories()
      },
      async listServices(): Promise<Service[]> {
        return mockCatalog.services()
      },
    },

    occurrences: {
      async listBetween(from: LocalDate, to: LocalDate): Promise<Occurrence[]> {
        // Le filtrage par service se fait ici, dans la couche de données : une activité
        // d'un autre service n'atteint jamais l'interface. Côté Firestore, ce sera la
        // requête `array-contains-any` doublée par les règles de sécurité.
        return [...state.occurrences.values()]
          .filter((o) => o.localDate >= from && o.localDate <= to)
          .filter((o) => isVisibleToService(o, state.session.serviceId))
          .sort((a, b) => a.start.getTime() - b.start.getTime())
      },
      async get(occurrenceId: string): Promise<Occurrence | null> {
        const occurrence = state.occurrences.get(occurrenceId)
        if (!occurrence) return null
        // Même règle sur l'accès direct : une adresse devinée ne donne rien de plus.
        return isVisibleToService(occurrence, state.session.serviceId) ? occurrence : null
      },
    },

    registrations: {
      async listMine(): Promise<MyRegistration[]> {
        const uid = state.session.patientUid
        if (uid === null) return []
        return state.registrations
          .filter((r) => r.patientUid === uid && r.status !== 'cancelled')
          .map((r) => myRegistration(r.occurrenceId))
          .filter((r): r is MyRegistration => r !== null)
          .sort((a, b) => a.occurrence.start.getTime() - b.occurrence.start.getTime())
      },

      async statusFor(occurrenceId: string): Promise<MyRegistration | null> {
        return myRegistration(occurrenceId)
      },

      async register(occurrenceId: string): Promise<RegisterResult> {
        const board = boardOf(state, occurrenceId)
        const uid = state.session.patientUid
        if (!board || uid === null || !isVisibleToService(board.occurrence, state.session.serviceId)) {
          return { ok: false, reason: 'unknown', message: "Cette activité n'a pas été trouvée." }
        }
        const outcome = domainRegister(board, uid, {
          now: clock(),
          registrationId: `${occurrenceId}--${uid}--${clock().getTime()}`,
          by: 'patient',
        })
        if (!outcome.ok) return { ok: false, reason: outcome.reason, message: REFUS[outcome.reason] }
        applyBoard(state, outcome.board)
        return { ok: true, status: outcome.status, position: outcome.position }
      },

      async unregister(occurrenceId: string): Promise<{ ok: boolean; message: string }> {
        const board = boardOf(state, occurrenceId)
        const uid = state.session.patientUid
        if (!board || uid === null) return { ok: false, message: "Cette activité n'a pas été trouvée." }
        const outcome = domainUnregister(board, uid)
        if (!outcome.ok) return { ok: false, message: "Vous n'étiez pas inscrit à cette activité." }
        applyBoard(state, outcome.board)
        return { ok: true, message: 'Vous êtes désinscrit.' }
      },
    },

    session: {
      current(): PatientSession {
        return state.session
      },
      async signInWithCode(code: string) {
        // En démonstration, tout code de 6 caractères est accepté.
        // En production, cet appel deviendra une Cloud Function `exchangeCode`.
        if (code.trim().length < 4) {
          return { ok: false as const, message: "Ce code n'est pas reconnu. Demandez un nouveau code à un soignant." }
        }
        state.session = {
          patientUid: DEMO_PATIENT_UID,
          firstName: 'Camille',
          serviceId: state.session.serviceId ?? DEMO_SERVICE_ID,
        }
        return { ok: true as const }
      },
      async signOut() {
        state.session = { patientUid: null, firstName: null, serviceId: null }
      },
    },

    reset() {
      state = buildState(clock())
    },

    setDemoService(serviceId: string) {
      state.session = { ...state.session, serviceId }
    },
  }
}
