/**
 * Adapter en mémoire, côté patient. Il sert deux usages :
 *  - l'écran de démonstration, montrable sans le moindre backend ;
 *  - les tests de composants.
 *
 * Il applique exactement les mêmes réducteurs de domaine que ceux qui tournent dans la
 * transaction Firestore : le comportement démontré est le comportement réel. Il partage
 * son état avec l'adapter soignant (`mock/state.ts`), si bien qu'une inscription prise
 * en réunion du lundi apparaît aussitôt dans le calendrier du patient.
 */
import { isVisibleToService } from '../../domain/audience'
import { registrationBlockMessage, type RegistrationBlock } from '../../domain/capacity'
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
} from '../../domain/types'
import {
  register as domainRegister,
  unregister as domainUnregister,
  registrationOf,
  waitlistPosition,
} from '../../domain/waitlist'
import type { AppRepository, MyRegistration, PatientSession, RegisterResult } from '../ports'
import { mockCatalog } from './catalog'
import {
  DEMO_PATIENT_UID,
  DEMO_SERVICE_ID,
  applyBoard,
  boardOf,
  resetWorld,
  world,
} from './state'

export { DEMO_PATIENT_UID, DEMO_SERVICE_ID }

const REFUS: Record<RegistrationBlock | 'already-registered', string> = {
  cancelled: registrationBlockMessage('cancelled'),
  past: registrationBlockMessage('past'),
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

  const myRegistration = (occurrenceId: string): MyRegistration | null => {
    const board = boardOf(occurrenceId)
    const uid = world.session.patientUid
    if (!board || uid === null) return null
    const mine = registrationOf(board, uid)
    if (mine === null || mine.status === 'cancelled') return null
    return {
      occurrence: board.occurrence,
      status: mine.status,
      position: mine.status === 'waitlist' ? waitlistPosition(board, uid) : null,
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
      async listPractitioners(): Promise<Practitioner[]> {
        return mockCatalog.practitioners()
      },
    },

    occurrences: {
      async listBetween(from: LocalDate, to: LocalDate): Promise<Occurrence[]> {
        // Le filtrage par service se fait ici, dans la couche de données : une activité
        // d'un autre service n'atteint jamais l'interface. Côté Firestore, ce sera la
        // requête `array-contains-any` doublée par les règles de sécurité.
        return [...world.occurrences.values()]
          .filter((o) => o.localDate >= from && o.localDate <= to)
          .filter((o) => isVisibleToService(o, world.session.serviceId))
          .sort((a, b) => a.start.getTime() - b.start.getTime())
      },
      async get(occurrenceId: string): Promise<Occurrence | null> {
        const occurrence = world.occurrences.get(occurrenceId)
        if (!occurrence) return null
        // Même règle sur l'accès direct : une adresse devinée ne donne rien de plus.
        return isVisibleToService(occurrence, world.session.serviceId) ? occurrence : null
      },
    },

    registrations: {
      async listMine(): Promise<MyRegistration[]> {
        const uid = world.session.patientUid
        if (uid === null) return []
        return world.registrations
          .filter((r) => r.patientUid === uid && r.status !== 'cancelled')
          .map((r) => myRegistration(r.occurrenceId))
          .filter((r): r is MyRegistration => r !== null)
          .sort((a, b) => a.occurrence.start.getTime() - b.occurrence.start.getTime())
      },

      async statusFor(occurrenceId: string): Promise<MyRegistration | null> {
        return myRegistration(occurrenceId)
      },

      async register(occurrenceId: string): Promise<RegisterResult> {
        const board = boardOf(occurrenceId)
        const uid = world.session.patientUid
        if (!board || uid === null || !isVisibleToService(board.occurrence, world.session.serviceId)) {
          return { ok: false, reason: 'unknown', message: "Cette activité n'a pas été trouvée." }
        }
        const outcome = domainRegister(board, uid, {
          now: clock(),
          registrationId: `${occurrenceId}--${uid}--${clock().getTime()}`,
          by: 'patient',
        })
        if (!outcome.ok) return { ok: false, reason: outcome.reason, message: REFUS[outcome.reason] }
        applyBoard(outcome.board)
        return { ok: true, status: outcome.status, position: outcome.position }
      },

      async unregister(occurrenceId: string): Promise<{ ok: boolean; message: string }> {
        const board = boardOf(occurrenceId)
        const uid = world.session.patientUid
        if (!board || uid === null) return { ok: false, message: "Cette activité n'a pas été trouvée." }
        const outcome = domainUnregister(board, uid)
        if (!outcome.ok) return { ok: false, message: "Vous n'étiez pas inscrit à cette activité." }
        applyBoard(outcome.board)
        return { ok: true, message: 'Vous êtes désinscrit.' }
      },
    },

    appointments: {
      async listKinds(): Promise<AppointmentKind[]> {
        // Le catalogue vivant, et non le seed : un motif ajouté doit se voir aussitôt.
        return mockCatalog.appointmentKinds().filter((k) => k.isActive)
      },

      async listMine(): Promise<Appointment[]> {
        const uid = world.session.patientUid
        if (uid === null) return []
        return world.appointments
          .filter((a) => a.patientUid === uid)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      },

      async request(kindId: string, preference: AppointmentPreference) {
        const uid = world.session.patientUid
        if (uid === null) return { ok: false, message: 'Saisissez votre code pour demander un rendez-vous.' }
        // Une seule demande en attente à la fois pour un même professionnel : sans cela,
        // un patient inquiet en enverrait plusieurs, et la file perdrait son sens.
        if (world.appointments.some((a) => a.patientUid === uid && a.kindId === kindId && a.status === 'requested')) {
          return { ok: false, message: 'Vous avez déjà une demande en attente pour ce professionnel.' }
        }
        world.appointments = [
          ...world.appointments,
          {
            id: `rdv-${uid}-${clock().getTime()}`,
            patientUid: uid,
            kindId,
            preference,
            status: 'requested',
            createdAt: clock(),
          },
        ]
        return { ok: true, message: 'Votre demande est envoyée. Un soignant vous dira quand.' }
      },

      async withdraw(appointmentId: string) {
        const uid = world.session.patientUid
        const demande = world.appointments.find((a) => a.id === appointmentId && a.patientUid === uid)
        if (!demande || demande.status !== 'requested') {
          return { ok: false, message: "Cette demande n'est plus en attente." }
        }
        world.appointments = world.appointments.map((a) =>
          a.id === appointmentId ? { ...a, status: 'cancelled' as const } : a,
        )
        return { ok: true, message: 'Votre demande est retirée.' }
      },
    },

    session: {
      current(): PatientSession {
        return world.session
      },
      async signInWithCode(code: string) {
        // En démonstration, tout code d'au moins quatre caractères est accepté.
        if (code.trim().length < 4) {
          return {
            ok: false as const,
            message: "Ce code n'est pas reconnu. Demandez un nouveau code à un soignant.",
          }
        }
        world.session = {
          patientUid: DEMO_PATIENT_UID,
          firstName: 'Camille',
          serviceId: world.session.serviceId ?? DEMO_SERVICE_ID,
        }
        return { ok: true as const }
      },
      async signOut() {
        world.session = { patientUid: null, firstName: null, serviceId: null }
      },
    },

    reset() {
      resetWorld(clock())
    },

    setDemoService(serviceId: string) {
      // On devient un patient de ce service : ses inscriptions sont alors les siennes,
      // y compris celles prises pour lui pendant la réunion du lundi.
      const patient = world.patients.find((p) => p.serviceId === serviceId)
      world.session = patient
        ? { patientUid: patient.uid, firstName: patient.firstName, serviceId }
        : { ...world.session, serviceId }
    },
  }
}
