/**
 * Espace soignant en mémoire : c'est lui qui alimente `/demo`.
 * Même logique de génération que l'adapter Firestore, mêmes fonctions du domaine.
 */
import { todayLocalDate } from '../../domain/time'
import { instantOf, addMinutes } from '../../domain/time'
import type { Activity, Appointment, LocalDate, LocalTime, Occurrence } from '../../domain/types'
import { generationWindow, planGeneration } from '../generation'
import { activitiesSeed } from '../seed/activities.seed'
import { attendanceRefusal, canMarkAttendance } from '../../domain/attendance'
import { planActivityRemoval, planRemoval } from '../../domain/catalog'
import type { Account } from '../../domain/impersonation'
import { mockCatalog } from './catalog'
import {
  applyBoard,
  boardOf,
  CLE_SESSION_SOIGNANT,
  DEMO_PATIENT_UID,
  DEMO_SERVICE_ID,
  readDemo,
  storeDetour,
  world,
  writeDemo,
} from './state'
import { registrationBlockMessage } from '../../domain/capacity'
import {
  register as domainRegister,
  unregister as domainUnregister,
  rosterOf,
  waitlistPosition,
} from '../../domain/waitlist'
import { slugify } from '../../domain/slug'
import type {
  NewPatientCode,
  ActivityDraft,
  GenerationReport,
  RosterLine,
  StaffApp,
  StaffIdentity,
  StaffPatient,
  SuperAdminService,
} from '../staffPorts'

const DEMO_STAFF: StaffIdentity = {
  uid: 'demo-soignant',
  email: 'soignant@exemple.test',
  firstName: 'Marc',
  role: 'admin',
  // Relié à l'intervenant « Marc » : la démonstration montre alors l'appel de ses
  // activités, et « Mon planning ».
  practitionerId: 'marc',
}

const SIGNED_OUT: StaffIdentity = {
  uid: null,
  email: null,
  firstName: null,
  role: null,
  practitionerId: null,
}

/** Alphabet sans ambiguïté : ni I, ni L, ni O, ni U. Identique à celui des vraies fonctions. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

function codeDeDemonstration(): string {
  let code = ''
  for (let i = 0; i < 6; i += 1) code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)]
  return code
}

const pourLaFeuille = (code: string): string => code.replace(/(.{3})(?=.)/g, '$1-')

export function createMockStaffApp(): StaffApp {
  // Les activités vivent ici, les occurrences et les inscriptions dans le monde partagé
  // avec l'adapter patient : ce qui est décidé en réunion se voit côté patient.
  const activities = new Map<string, Activity>(activitiesSeed.map((a) => [a.id, a]))
  let identity: StaffIdentity = SIGNED_OUT

  // Comme une vraie session Firebase, celle de la démonstration survit au rechargement.
  // Sans cela, revenir d'un détour ramènerait à l'écran de connexion.
  if (readDemo(CLE_SESSION_SOIGNANT) === 'ouverte') identity = DEMO_STAFF

  // « Voir à leur place » : si l'on était à la place d'un membre du personnel avant le
  // rechargement, on y revient. Les patients, eux, sont repris par le monde partagé.
  const repris = mockCatalog.practitioners().find((i) => `staff-${i.id}` === world.impersonating)
  if (world.impersonating !== null) identity = SIGNED_OUT
  if (repris !== undefined) {
    identity = {
      uid: `staff-${repris.id}`,
      email: `${repris.id}@exemple.test`,
      firstName: repris.name,
      role: 'staff',
      practitionerId: repris.id,
    }
  }

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
        writeDemo(CLE_SESSION_SOIGNANT, 'ouverte')
        return { ok: true as const }
      },
      async signOut() {
        identity = SIGNED_OUT
        writeDemo(CLE_SESSION_SOIGNANT, null)
        storeDetour(null)
        world.impersonating = null
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

      async deleteActivity(activityId: string) {
        const activite = activities.get(activityId)
        if (!activite) throw new Error("Cette activité n'existe plus.")
        const seances = [...world.occurrences.values()].filter((o) => o.activityId === activityId)
        const identifiants = new Set(seances.map((o) => o.id))
        const inscriptions = world.registrations.filter((r) => identifiants.has(r.occurrenceId))

        const plan = planActivityRemoval(activite.title, {
          registrations: inscriptions.length,
          sessions: seances.length,
        })
        if (plan.action === 'deleted') {
          for (const seance of seances) world.occurrences.delete(seance.id)
          activities.delete(activityId)
        } else {
          activities.set(activityId, { ...activite, isActive: false })
        }
        return plan
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

      async weekPlannings(from: LocalDate, to: LocalDate, serviceId?: string) {
        const dansLaSemaine = new Set(
          [...world.occurrences.values()]
            .filter((o) => o.localDate >= from && o.localDate <= to)
            .map((o) => o.id),
        )
        return world.patients
          .filter((patient) => serviceId === undefined || patient.serviceId === serviceId)
          .sort((a, b) => a.firstName.localeCompare(b.firstName, 'fr'))
          .map((patient) => ({
            patientUid: patient.uid,
            firstName: patient.firstName,
            serviceId: patient.serviceId,
            lines: world.registrations
              .filter(
                (r) =>
                  r.patientUid === patient.uid &&
                  r.status !== 'cancelled' &&
                  dansLaSemaine.has(r.occurrenceId),
              )
              .map((r) => ({ occurrenceId: r.occurrenceId, status: r.status as 'confirmed' | 'waitlist' })),
          }))
      },

      async restoreOccurrence(occurrenceId: string): Promise<void> {
        const occurrence = world.occurrences.get(occurrenceId)
        if (!occurrence) return
        const { cancellationReason: _motif, ...reste } = occurrence
        world.occurrences.set(occurrenceId, { ...reste, status: 'scheduled', overridden: true })
      },

      async roster(occurrenceId: string) {
        const board = boardOf(occurrenceId)
        if (board === null) return { lines: [], canMarkAttendance: false }
        const peut = canMarkAttendance(identity, board.occurrence)
        const { confirmed, waitlist } = rosterOf(board)
        const prenom = (uid: string) => world.patients.find((p) => p.uid === uid)
        const presence = (uid: string) => world.attendance.get(`${occurrenceId}|${uid}`)
        const ligne = (uid: string, status: 'confirmed' | 'waitlist', position: number | null): RosterLine => ({
          patientUid: uid,
          firstName: prenom(uid)?.firstName ?? 'Prénom inconnu',
          serviceId: prenom(uid)?.serviceId ?? null,
          status,
          position,
          // Comme côté serveur : l'appel n'est renvoyé qu'à qui a le droit de le faire.
          ...(peut && presence(uid) !== undefined ? { attendance: presence(uid) } : {}),
        })
        return {
          lines: [
            ...confirmed.map((r) => ligne(r.patientUid, 'confirmed', null)),
            ...waitlist.map((r) => ligne(r.patientUid, 'waitlist', waitlistPosition(board, r.patientUid))),
          ],
          canMarkAttendance: peut,
        }
      },

      async markAttendance(occurrenceId, patientUid, attendance) {
        const board = boardOf(occurrenceId)
        if (board === null) return { ok: false, message: "Cette activité n'a pas été trouvée." }
        if (!canMarkAttendance(identity, board.occurrence)) {
          return { ok: false, message: attendanceRefusal(board.occurrence) }
        }
        const inscrit = board.registrations.some((r) => r.patientUid === patientUid && r.status !== 'cancelled')
        if (!inscrit) {
          // Venue spontanée : on inscrit, puis on note.
          const outcome = domainRegister(board, patientUid, {
            now: new Date(),
            registrationId: `insc-${occurrenceId}-${patientUid}`,
            by: 'staff',
            walkIn: true,
          })
          if (!outcome.ok) {
            return { ok: false, message: registrationBlockMessage(outcome.reason as never) }
          }
          applyBoard(outcome.board)
        }
        const cle = `${occurrenceId}|${patientUid}`
        if (attendance === null) world.attendance.delete(cle)
        else world.attendance.set(cle, attendance)
        return {
          ok: true,
          message:
            attendance === 'present' ? 'Noté présent.' : attendance === 'absent' ? 'Noté absent.' : 'Réponse effacée.',
        }
      },

      async listPatients(): Promise<StaffPatient[]> {
        const maintenant = Date.now()
        return [...world.patients]
          .filter((p) => p.expiresAt === undefined || p.expiresAt.getTime() > maintenant)
          .sort((a, b) => a.firstName.localeCompare(b.firstName, 'fr'))
      },

      async createPatient(firstName: string, serviceId: string): Promise<NewPatientCode> {
        const uid = `demo-${slugify(firstName)}-${Date.now().toString(36)}`
        const expiresAt = new Date(Date.now() + 60 * 86_400_000)
        world.patients = [...world.patients, { uid, firstName, serviceId, expiresAt }]
        // En démonstration le code n'est pas haché : il n'ouvre rien de réel.
        const code = codeDeDemonstration()
        return { uid, firstName, code, printableCode: pourLaFeuille(code), expiresAt }
      },

      async regenerateCode(patientUid: string): Promise<NewPatientCode> {
        const patient = world.patients.find((p) => p.uid === patientUid)
        const expiresAt = new Date(Date.now() + 60 * 86_400_000)
        world.patients = world.patients.map((p) => (p.uid === patientUid ? { ...p, expiresAt } : p))
        const code = codeDeDemonstration()
        return {
          uid: patientUid,
          firstName: patient?.firstName ?? '',
          code,
          printableCode: pourLaFeuille(code),
          expiresAt,
        }
      },

      async endStay(patientUid: string) {
        world.patients = world.patients.map((p) =>
          p.uid === patientUid ? { ...p, expiresAt: new Date(Date.now() - 1000) } : p,
        )
        return { ok: true, message: 'Le séjour est clôturé. Le code ne fonctionne plus.' }
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

      async listAppointments(): Promise<Appointment[]> {
        return [...world.appointments].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      },

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
      ) {
        const demande = world.appointments.find((a) => a.id === appointmentId)
        if (!demande) return { ok: false, message: "Cette demande n'existe plus." }
        const start = instantOf(rendezVous.date, rendezVous.time)
        world.appointments = world.appointments.map((a) =>
          a.id === appointmentId
            ? {
                ...a,
                status: 'scheduled' as const,
                localDate: rendezVous.date,
                start,
                end: addMinutes(start, rendezVous.durationMin),
                withWhom: rendezVous.withWhom,
                ...(rendezVous.practitionerId ? { practitionerId: rendezVous.practitionerId } : {}),
                ...(rendezVous.locationId ? { locationId: rendezVous.locationId } : {}),
              }
            : a,
        )
        return { ok: true, message: 'Rendez-vous fixé. Le patient le voit dans son calendrier.' }
      },

      async createAppointment(rendezVous: {
        patientUid: string
        kindId: string
        date: LocalDate
        time: LocalTime
        durationMin: number
        withWhom: string
        practitionerId?: string
        locationId?: string
      }) {
        const start = instantOf(rendezVous.date, rendezVous.time)
        world.appointments = [
          ...world.appointments,
          {
            id: `rdv-${rendezVous.patientUid}-${start.getTime()}`,
            patientUid: rendezVous.patientUid,
            kindId: rendezVous.kindId,
            preference: 'peu-importe',
            status: 'scheduled',
            createdAt: new Date(),
            localDate: rendezVous.date,
            start,
            end: addMinutes(start, rendezVous.durationMin),
            withWhom: rendezVous.withWhom,
            ...(rendezVous.practitionerId ? { practitionerId: rendezVous.practitionerId } : {}),
            ...(rendezVous.locationId ? { locationId: rendezVous.locationId } : {}),
          },
        ]
        return { ok: true, message: 'Rendez-vous fixé. Le patient le voit dans son calendrier.' }
      },

      async cancelAppointment(appointmentId: string, reason: string) {
        world.appointments = world.appointments.map((a) =>
          a.id === appointmentId ? { ...a, status: 'cancelled' as const, cancellationReason: reason } : a,
        )
        return { ok: true, message: 'Rendez-vous annulé.' }
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
      async createStaffAccount(_email, _practitionerId) {
        // En démonstration, aucun compte n'est réellement créé : on montre le geste.
        return {
          ok: true,
          message: 'Accès créé. Notez le mot de passe : il ne sera plus affiché.',
          password: 'DEMO-ACCE',
        }
      },

      async savePractitioner(practitioner) {
        mockCatalog.savePractitioner(practitioner)
      },
      async removeEntry(kind, id) {
        // Même décision que côté serveur, sur le petit monde de la démonstration :
        // supprimé si rien ne l'utilise, retiré des listes sinon.
        const parActivite = (activity: Activity): boolean =>
          kind === 'location'
            ? activity.locationId === id
            : kind === 'category'
              ? activity.categoryId === id
              : kind === 'practitioner'
                ? activity.facilitatorId === id
                : activity.serviceIds.includes(id)
        const parOccurrence = (occurrence: Occurrence): boolean =>
          kind === 'location'
            ? occurrence.locationId === id
            : kind === 'category'
              ? occurrence.categoryId === id
              : kind === 'practitioner'
                ? occurrence.facilitatorId === id
                : occurrence.audienceKeys.includes(id)

        const nom =
          (kind === 'location'
            ? mockCatalog.locations().find((l) => l.id === id)?.name
            : kind === 'service'
              ? mockCatalog.services().find((s) => s.id === id)?.name
              : kind === 'practitioner'
                ? mockCatalog.practitioners().find((i) => i.id === id)?.name
                : mockCatalog.categories().find((c) => c.id === id)?.name) ?? id

        const concernees = [...activities.values()].filter(parActivite)
        const plan = planRemoval(kind, nom, {
          activities: concernees.length,
          occurrences: [...world.occurrences.values()].filter(parOccurrence).length,
          patients: kind === 'service' ? world.patients.filter((p) => p.serviceId === id).length : 0,
          appointments:
            kind === 'practitioner'
              ? world.appointments.filter((r) => r.practitionerId === id).length
              : 0,
        })
        if (plan.action === 'deleted') mockCatalog.remove(kind, id)
        else mockCatalog.deactivate(kind, id)
        return { ...plan, activityTitles: concernees.slice(0, 8).map((a) => a.title) }
      },
    },

    superAdmin: superAdmin(),
  }

  /**
   * En démonstration, prendre la place de quelqu'un ne demande aucun jeton : il suffit
   * de changer d'identité dans le monde en mémoire. Le geste est le même qu'en service,
   * et c'est ce qui compte — l'écran se vérifie ici avant d'être vérifié là-bas.
   */
  function superAdmin(): SuperAdminService {
    return {
      async listAccounts(): Promise<Account[]> {
        const personnel: Account[] = mockCatalog
          .practitioners()
          .filter((i) => i.isActive)
          .map((i) => ({ uid: `staff-${i.id}`, label: i.name, detail: i.role, kind: 'staff' as const }))
        const patients: Account[] = world.patients.map((p) => ({
          uid: p.uid,
          label: p.firstName,
          detail: mockCatalog.services().find((s) => s.id === p.serviceId)?.name ?? p.serviceId,
          kind: 'patient' as const,
        }))
        return [...personnel, ...patients]
      },

      async impersonate(uid: string) {
        const patient = world.patients.find((p) => p.uid === uid)
        if (patient !== undefined) {
          world.session = {
            patientUid: patient.uid,
            firstName: patient.firstName,
            serviceId: patient.serviceId,
          }
          identity = SIGNED_OUT
          world.impersonating = uid
          storeDetour(uid)
          return { ok: true as const, label: patient.firstName, kind: 'patient' as const, back: 'demo' }
        }

        const intervenant = mockCatalog.practitioners().find((i) => `staff-${i.id}` === uid)
        if (intervenant === undefined) {
          return { ok: false as const, message: "Ce compte n'existe pas." }
        }
        // Un intervenant ordinaire n'est pas administrateur : c'est justement ce qu'on
        // vient vérifier — il ne doit voir que l'appel de ses propres activités.
        identity = {
          uid,
          email: `${intervenant.id}@exemple.test`,
          firstName: intervenant.name,
          role: 'staff',
          practitionerId: intervenant.id,
        }
        world.session = { patientUid: null, firstName: null, serviceId: null }
        world.impersonating = uid
        storeDetour(uid)
        return { ok: true as const, label: intervenant.name, kind: 'staff' as const, back: 'demo' }
      },

      async resume(_back: string) {
        // La démonstration n'a qu'un compte d'administrateur : on y revient toujours.
        identity = DEMO_STAFF
        world.session = {
          patientUid: DEMO_PATIENT_UID,
          firstName: 'Camille',
          serviceId: DEMO_SERVICE_ID,
        }
        world.impersonating = null
        storeDetour(null)
        return { ok: true, message: 'Vous êtes revenu à votre compte.' }
      },
    }
  }
}
