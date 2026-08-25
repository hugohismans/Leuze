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
import { firstBookableDay } from '../../domain/agenda'
import { isVisibleToService } from '../../domain/audience'
import { servesService } from '../../domain/practitioners'
import { patientRegistrationDecision, swapMessage } from '../../domain/conflicts'
import {
  effectivePermissions,
  isAllowed,
  refusalFor,
  type PatientPermissions,
} from '../../domain/permissions'
import {
  alreadyWaiting,
  cleanProposal,
  validateProposal,
  type ActivityProposal,
  type ProposalDraft,
} from '../../domain/proposals'
import {
  AUTO_DURATION_MIN,
  AUTO_HORIZON_DAYS,
  autoAcceptMessage,
  findFirstSlot,
  type BusySlot,
} from '../../domain/autoAccept'
import {
  registrationBlockMessage,
  unregisteredMessage,
  type RegistrationBlock,
  type RegistrationKind,
} from '../../domain/capacity'
import { alreadyAskedMessage } from '../../domain/appointments'
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
import {
  addLocalDays,
  addMinutes,
  formatFullWhen,
  instantOf,
  localTimeOf,
  todayLocalDate,
} from '../../domain/time'
import type { AppRepository, MyRegistration, PatientSession, RegisterResult } from '../ports'
import { mockCatalog } from './catalog'
import {
  DEMO_PATIENT_UID,
  DEMO_SERVICE_ID,
  applyBoard,
  boardOf,
  busyOn,
  conflictsFor,
  dejaInscrit,
  droitsDe,
  resetWorld,
  world,
} from './state'

export { DEMO_PATIENT_UID, DEMO_SERVICE_ID }

/**
 * La première place libre chez quelqu'un qui accepte automatiquement ce motif — la même
 * recherche que sur le serveur, sur les données de la démonstration.
 */
function premierePlaceLibre(
  kindId: string,
  preference: AppointmentPreference,
  maintenant: Date,
  serviceId: string | null,
  practitionerId: string | null,
  patientUid: string,
): { practitionerId: string; name: string; slot: NonNullable<ReturnType<typeof findFirstSlot>> } | null {
  const candidats = mockCatalog
    .practitioners()
    .filter((p) => p.isActive && p.autoAccept === true && p.kindId === kindId)
    // Les deux mêmes garde-fous que sur le serveur : quelqu'un qui ne passe pas dans
    // cette unité ne peut pas recevoir ce patient, et une personne demandée est
    // demandée — on ne se rabat pas sur un collègue sans le dire.
    .filter((p) => servesService(p, serviceId))
    .filter((p) => practitionerId === null || p.id === practitionerId)
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'))

  // Jamais aujourd'hui : voir `firstBookableDay`.
  const depart = firstBookableDay(todayLocalDate(maintenant))

  /*
    Ce que le patient a déjà.

    L'acceptation automatique posait tranquillement un rendez-vous par-dessus l'atelier
    auquel la personne était inscrite : « Ma semaine » affichait les deux au même moment,
    sans un mot, et c'est elle qui devait choisir. Un soignant qui fixe à la main recevait
    déjà cet agenda ; la machine n'a aucune raison d'être moins prudente.
  */
  const occupePatient: BusySlot[] = []
  for (let i = 0; i <= AUTO_HORIZON_DAYS; i += 1) {
    const jour = addLocalDays(depart, i)
    for (const entree of busyOn(patientUid, jour)) {
      occupePatient.push({ localDate: jour, from: localTimeOf(entree.start), to: localTimeOf(entree.end) })
    }
  }

  for (const candidat of candidats) {
    const plages = candidat.availability ?? []
    if (plages.length === 0) continue
    const occupes: BusySlot[] = world.appointments.flatMap((a) =>
      a.practitionerId === candidat.id &&
      a.status === 'scheduled' &&
      a.localDate !== undefined &&
      a.start !== undefined &&
      a.end !== undefined
        ? [{ localDate: a.localDate, from: localTimeOf(a.start), to: localTimeOf(a.end) }]
        : [],
    )
    const slot = findFirstSlot({
      windows: plages,
      // Un jour d'absence ne retient aucune place, même quand la plage du jour est libre.
      leaves: world.leaves[candidat.id] ?? [],
      busy: occupes,
      patientBusy: occupePatient,
      preference,
      from: depart,
      horizonDays: AUTO_HORIZON_DAYS,
      durationMin: AUTO_DURATION_MIN,
    })
    if (slot !== null) return { practitionerId: candidat.id, name: candidat.name, slot }
  }
  return null
}

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
    /*
      Le filtre par service vaut aussi pour ce qui est à soi.

      `listBetween` et `get` filtraient ; `listMine` non. « Mes inscriptions » et « Ma
      semaine » — à un seul appui du calendrier — affichaient donc le titre, l'horaire et
      le lieu d'activités réservées à un autre service, que le calendrier venait de
      masquer. C'est l'invariant n° 1 du projet : un titre ne doit pas franchir la
      cloison, et il n'y a pas d'écran d'exception.
    */
    if (!isVisibleToService(board.occurrence, world.session.serviceId)) return null
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

      async register(
        occurrenceId: string,
        options: { replacing?: string[]; as?: RegistrationKind } = {},
      ): Promise<RegisterResult> {
        const genre: RegistrationKind = options.as ?? 'participant'
        const board = boardOf(occurrenceId)
        const uid = world.session.patientUid
        if (!board || uid === null || !isVisibleToService(board.occurrence, world.session.serviceId)) {
          return { ok: false, reason: 'unknown', message: "Cette activité n'a pas été trouvée." }
        }
        // Le service a-t-il ouvert ce geste ? Même refus que le serveur, au mot près.
        if (!isAllowed(droitsDe(uid), 'register')) {
          return { ok: false, reason: 'closed', message: refusalFor('register') }
        }

        /*
          On ne peut pas être à deux endroits à la fois. Même décision que le serveur, au
          mot près : un rendez-vous ferme la porte, une activité s'échange.
        */
        // Même réserve que le serveur : déjà là, ce n'est pas un engagement de plus.
        const decision = patientRegistrationDecision(conflictsFor(uid, occurrenceId), genre, {
          alreadyRegistered: dejaInscrit(occurrenceId, uid),
        })
        if (decision.kind === 'rendez-vous') {
          return { ok: false, reason: 'conflict', message: decision.message }
        }
        const aQuitter = decision.kind === 'activites' ? decision.aQuitter.map((e) => e.occurrenceId!) : []
        if (decision.kind === 'activites') {
          const demandees = options.replacing ?? []
          const toutes =
            aQuitter.every((id) => demandees.includes(id)) && demandees.every((id) => aQuitter.includes(id))
          if (!toutes) {
            return { ok: false, reason: 'conflict', message: decision.message, mustLeave: aQuitter }
          }
          if (!isAllowed(droitsDe(uid), 'unregister')) {
            return {
              ok: false,
              reason: 'conflict',
              message: `${decision.message} Adressez-vous à un soignant : il peut changer votre inscription.`,
            }
          }
        }

        // La nouvelle place d'abord, l'ancienne ensuite : c'est le seul ordre qui ne fait
        // rien perdre. Voir `register` dans les Cloud Functions.
        const outcome = domainRegister(board, uid, {
          now: clock(),
          registrationId: `${occurrenceId}--${uid}--${clock().getTime()}`,
          by: 'patient',
          as: genre,
        })
        if (!outcome.ok) return { ok: false, reason: outcome.reason, message: REFUS[outcome.reason] }
        applyBoard(outcome.board)

        const quittees: string[] = []
        for (const id of aQuitter) {
          const autre = boardOf(id)
          if (autre === null) continue
          const sortie = domainUnregister(autre, uid)
          if (!sortie.ok) continue
          applyBoard(sortie.board)
          quittees.push(id)
        }
        // Ne se dit que ce qui a réellement été quitté, et dans les mots de ce que c'était.
        const parties =
          decision.kind === 'activites'
            ? decision.aQuitter.filter((e) => quittees.includes(e.occurrenceId ?? ''))
            : []
        return {
          ok: true,
          status: outcome.status,
          position: outcome.position,
          ...(quittees.length === 0
            ? {}
            : { left: quittees, swapMessage: swapMessage(parties) }),
        }
      },

      async unregister(occurrenceId: string): Promise<{ ok: boolean; message: string }> {
        const board = boardOf(occurrenceId)
        const uid = world.session.patientUid
        if (!board || uid === null) return { ok: false, message: "Cette activité n'a pas été trouvée." }
        if (!isAllowed(droitsDe(uid), 'unregister')) {
          return { ok: false, message: refusalFor('unregister') }
        }
        const outcome = domainUnregister(board, uid)
        if (!outcome.ok) return { ok: false, message: "Vous n'étiez pas inscrit à cette activité." }
        applyBoard(outcome.board)
        // Les mêmes mots que le serveur : deux phrases pour un seul geste, c'est deux
        // écrans qui ne se ressemblent pas. Et « plus inscrit » ne se dit pas à quelqu'un
        // qui venait seulement regarder.
        return { ok: true, message: unregisteredMessage(outcome.was) }
      },

      async warmRegistration(): Promise<void> {
        // Rien à réveiller : la démonstration ne parle à aucun serveur.
      },
    },

    /** Les réglages de la démonstration : tout est ouvert, et modifiable en mémoire. */
    settings: {
      async patientPermissions(): Promise<PatientPermissions> {
        const uid = world.session.patientUid
        return effectivePermissions(
          world.patientPermissions,
          uid === null ? {} : (world.patientActions[uid] ?? {}),
        )
      },
    },

    /** Les idées d'activité, en mémoire. Mêmes refus que le serveur, aux mêmes endroits. */
    proposals: {
      async listMine(): Promise<ActivityProposal[]> {
        const uid = world.session.patientUid
        if (uid === null) return []
        return world.proposals
          .filter((p) => p.patientUid === uid)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      },

      async submit(draft: ProposalDraft): Promise<{ ok: boolean; message: string }> {
        const uid = world.session.patientUid
        if (uid === null) return { ok: false, message: 'Saisissez votre code pour proposer une activité.' }
        // Le même refus que le serveur, au mot près : la démonstration doit montrer ce
        // que les patients auront réellement.
        if (!isAllowed(droitsDe(uid), 'proposeActivity')) {
          return { ok: false, message: refusalFor('proposeActivity') }
        }
        const propre = cleanProposal(draft)
        const valide = validateProposal(propre)
        if (!valide.ok) return { ok: false, message: valide.message }
        if (alreadyWaiting(world.proposals, uid)) {
          return {
            ok: false,
            message:
              'Vous avez déjà une idée en attente. Un soignant va la lire, puis vous pourrez en proposer une autre.',
          }
        }
        world.proposals = [
          ...world.proposals,
          {
            id: `idee-${uid}-${clock().getTime()}`,
            patientUid: uid,
            patientFirstName: world.session.firstName ?? 'Prénom inconnu',
            ...propre,
            status: 'proposed',
            createdAt: clock(),
          },
        ]
        return { ok: true, message: 'Votre idée est envoyée. Un soignant va la lire.' }
      },

      async warmProposal(): Promise<void> {
        // Rien à réveiller : la démonstration ne parle à aucun serveur.
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

      async request(kindId: string, preference: AppointmentPreference, practitionerId?: string) {
        const uid = world.session.patientUid
        if (uid === null) return { ok: false, message: 'Saisissez votre code pour demander un rendez-vous.' }
        const demande = practitionerId === undefined || practitionerId === '' ? null : practitionerId
        const service = world.session.serviceId
        if (demande !== null) {
          // Le même refus que sur le serveur, mot pour mot : la démonstration doit
          // montrer ce qui se passera vraiment.
          const fiche = mockCatalog.practitioners().find((p) => p.id === demande)
          if (fiche === undefined || !fiche.isActive || fiche.kindId !== kindId || !servesService(fiche, service)) {
            return {
              ok: false,
              scheduled: false,
              message:
                "Cette personne ne peut pas vous recevoir. Choisissez-en une autre, ou laissez l'équipe choisir.",
            }
          }
        }
        if (!isAllowed(droitsDe(uid), 'requestAppointment')) {
          return { ok: false, message: refusalFor('requestAppointment') }
        }
        /*
          Une seule demande à la fois pour un même professionnel — en attente comme déjà
          fixée. Sans cela, quelqu'un d'inquiet qui appuie trois fois prendrait trois
          créneaux dans l'agenda de quelqu'un.
        */
        /*
          Le motif doit exister et être encore proposé — le serveur le vérifie déjà, la
          démonstration ne le vérifiait pas. Un motif retiré du catalogue laissait donc
          passer une demande ici, et la refusait en ligne.
        */
        const motif = mockCatalog.appointmentKinds().find((k) => k.id === kindId)
        if (motif === undefined || motif.isActive === false) {
          return {
            ok: false,
            scheduled: false,
            message: "Ce motif de rendez-vous n'existe plus. Demandez à un soignant.",
          }
        }
        const aujourdHui = todayLocalDate(clock())
        const dejaEnCours = world.appointments.find(
          (a) =>
            a.patientUid === uid &&
            a.kindId === kindId &&
            (a.status === 'requested' ||
              (a.status === 'scheduled' && (a.localDate ?? '') >= aujourdHui)),
        )
        if (dejaEnCours !== undefined) {
          return {
            ok: false,
            scheduled: false,
            message: alreadyAskedMessage(
              mockCatalog.appointmentKinds(),
              kindId,
              dejaEnCours.status === 'requested' ? 'requested' : 'scheduled',
            ),
          }
        }
        const commun = {
          id: `rdv-${uid}-${clock().getTime()}`,
          patientUid: uid,
          kindId,
          preference,
          createdAt: clock(),
          ...(demande === null ? {} : { practitionerId: demande }),
        }

        /*
          L'acceptation automatique, jouée exactement comme sur le serveur : la
          démonstration doit montrer ce qui se passera vraiment, sinon elle ment.
        */
        const place = premierePlaceLibre(kindId, preference, clock(), service, demande, uid)
        if (place === null) {
          world.appointments = [...world.appointments, { ...commun, status: 'requested' }]
          return { ok: true, scheduled: false, message: 'Votre demande est envoyée. Un soignant vous dira quand.' }
        }

        const debut = instantOf(place.slot.localDate, place.slot.time)
        const fin = addMinutes(debut, AUTO_DURATION_MIN)
        world.appointments = [
          ...world.appointments,
          {
            ...commun,
            status: 'scheduled',
            localDate: place.slot.localDate,
            start: debut,
            end: fin,
            withWhom: place.name,
            practitionerId: place.practitionerId,
            autoAccepted: true,
          },
        ]
        return {
          ok: true,
          scheduled: true,
          message: autoAcceptMessage(place.slot, formatFullWhen(place.slot.localDate, debut, fin), place.name),
        }
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

      async warmRequest(): Promise<void> {
        // Rien à réveiller : la démonstration ne parle à aucun serveur.
      },
    },

    session: {
      current(): PatientSession {
        return world.session
      },
      async warmSignIn() {
        // Rien à réveiller : la démonstration n'appelle aucun serveur.
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
