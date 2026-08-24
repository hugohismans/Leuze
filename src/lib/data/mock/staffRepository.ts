/**
 * Espace soignant en mémoire : c'est lui qui alimente `/demo`.
 * Même logique de génération que l'adapter Firestore, mêmes fonctions du domaine.
 */
import { addLocalDays, addMinutes, instantOf, todayLocalDate } from '../../domain/time'
import { PLANNING_HORIZON_DAYS, agendaWeek, firstBookableDay, suggestSlot } from '../../domain/agenda'
import { leaveRefusal, normalizeLeaves, withoutLeave, type Leave } from '../../domain/leave'
import { blockingConflicts, type BusyEntry } from '../../domain/conflicts'
import { hasOverrides, type PatientActionOverrides, type PatientPermissions } from '../../domain/permissions'
import type { ActivityProposal } from '../../domain/proposals'
import type { Activity, Appointment, LocalDate, LocalTime, Occurrence } from '../../domain/types'
import { generationWindow, planGeneration } from '../generation'
import { activitiesSeed } from '../seed/activities.seed'
import { attendanceRefusal, canMarkAttendance } from '../../domain/attendance'
import { planActivityRemoval, planForcedRemoval, planRemoval } from '../../domain/catalog'
import type { Account } from '../../domain/impersonation'
import { canScheduleAs, visibleAppointments } from '../../domain/appointmentAccess'
import { mockCatalog } from './catalog'
import {
  applyBoard,
  boardOf,
  busyOn,
  CLE_SESSION_SOIGNANT,
  conflictsFor,
  DEMO_PATIENT_UID,
  DEMO_SERVICE_ID,
  readDemo,
  storeDetour,
  world,
  writeDemo,
} from './state'
import { registrationBlockMessage } from '../../domain/capacity'
import {
  promote as domainPromote,
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

/**
 * Qui est administrateur, dans la démonstration. Les comptes n'y existent pas vraiment ;
 * ce petit registre tient lieu de jeton, le temps de la visite.
 */
const rolesDeDemonstration = new Map<string, 'staff' | 'admin'>()

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

  /**
   * Ce que les fonctions appelables vérifient de leur côté. La démonstration doit
   * refuser exactement ce que le serveur refuse : sans cela, prendre la place d'un
   * soignant ne montrerait pas ce qu'il voit vraiment.
   */
  /** Un intervenant ne fixe de rendez-vous que pour lui-même : le dire en toutes lettres. */
  const refusDAgenda = 'Vous ne pouvez fixer un rendez-vous que pour vous-même.'

  const exigeAdministrateur = (): void => {
    if (identity.role !== 'admin') {
      throw new Error("Cette action est réservée à l'administrateur.")
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

      async duplicateActivity(activityId: string, _source?: Activity): Promise<string> {
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

      async deleteActivity(activityId: string, options = {}) {
        const activite = activities.get(activityId)
        if (!activite) throw new Error("Cette activité n'existe plus.")
        // Même garde que le serveur : une suppression sans retour n'est pas confiée à tous.
        if (identity.role !== 'admin' && activite.facilitatorId !== identity.practitionerId) {
          throw new Error(
            "Seul un administrateur, ou la personne qui anime cette activité, peut la supprimer.",
          )
        }
        const seances = [...world.occurrences.values()].filter((o) => o.activityId === activityId)
        const identifiants = new Set(seances.map((o) => o.id))
        const inscriptions = world.registrations.filter((r) => identifiants.has(r.occurrenceId))
        const aujourdHui = todayLocalDate()
        const usage = {
          registrations: inscriptions.length,
          sessions: seances.length,
          pastSessions: seances.filter((o) => o.localDate < aujourdHui).length,
          // La présence vit à part dans la démonstration ; côté serveur, c'est un champ
          // de l'inscription. Le compte est le même.
          attendances: inscriptions.filter((r) =>
            world.attendance.has(`${r.occurrenceId}|${r.patientUid}`),
          ).length,
        }

        const plan =
          options.force === true
            ? planForcedRemoval(activite.title, usage)
            : planActivityRemoval(activite.title, usage)

        if (plan.action === 'deleted') {
          if (options.force === true) {
            for (const r of inscriptions) world.attendance.delete(`${r.occurrenceId}|${r.patientUid}`)
            world.registrations = world.registrations.filter((r) => !identifiants.has(r.occurrenceId))
          }
          for (const seance of seances) world.occurrences.delete(seance.id)
          activities.delete(activityId)
        } else {
          activities.set(activityId, { ...activite, isActive: false })
        }
        return plan
      },

      async deleteOccurrence(occurrenceId: string) {
        const seance = world.occurrences.get(occurrenceId)
        if (!seance) return { ok: false, message: "Cette séance n'existe plus." }
        if (identity.role !== 'admin' && seance.facilitatorId !== identity.practitionerId) {
          return {
            ok: false,
            message:
              "Seul un administrateur, ou la personne qui anime cette activité, peut supprimer une séance.",
          }
        }
        const inscriptions = world.registrations.filter((r) => r.occurrenceId === occurrenceId)
        const presences = inscriptions.filter((r) =>
          world.attendance.has(`${occurrenceId}|${r.patientUid}`),
        ).length
        world.registrations = world.registrations.filter((r) => r.occurrenceId !== occurrenceId)
        for (const r of inscriptions) world.attendance.delete(`${occurrenceId}|${r.patientUid}`)
        world.occurrences.delete(occurrenceId)
        const combien =
          inscriptions.length === 0
            ? "Personne n'y était inscrit."
            : inscriptions.length === 1
              ? 'Une inscription a été effacée.'
              : `${inscriptions.length} inscriptions ont été effacées.`
        const notees =
          presences === 0
            ? ''
            : presences === 1
              ? ' Une présence notée disparaît avec elle.'
              : ` ${presences} présences notées disparaissent avec elle.`
        return {
          ok: true,
          message: `La séance de « ${seance.title} » est supprimée. ${combien}${notees}`,
        }
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
        exigeAdministrateur()
        const uid = `demo-${slugify(firstName)}-${Date.now().toString(36)}`
        const expiresAt = new Date(Date.now() + 60 * 86_400_000)
        world.patients = [...world.patients, { uid, firstName, serviceId, expiresAt }]
        // En démonstration le code n'est pas haché : il n'ouvre rien de réel.
        const code = codeDeDemonstration()
        return { uid, firstName, code, printableCode: pourLaFeuille(code), expiresAt }
      },

      async regenerateCode(patientUid: string): Promise<NewPatientCode> {
        exigeAdministrateur()
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
        exigeAdministrateur()
        world.patients = world.patients.map((p) =>
          p.uid === patientUid ? { ...p, expiresAt: new Date(Date.now() - 1000) } : p,
        )
        return { ok: true, message: 'Le séjour est clôturé. Le code ne fonctionne plus.' }
      },

      async registerPatient(occurrenceId: string, patientUid: string, options = {}) {
        const board = boardOf(occurrenceId)
        if (board === null) return { ok: false, message: "Cette activité n'a pas été trouvée." }

        /*
          Rien n'est interdit au soignant, mais il doit le savoir avant d'inscrire — et
          seuls les rendez-vous valent qu'on s'arrête. Deux activités qui se recouvrent
          sont le lot d'un programme chargé : demander confirmation à chaque prénom
          rendait la réunion impraticable. Même règle que le serveur, au mot près.
        */
        if (options.overrideConflict !== true) {
          const conflits = blockingConflicts(conflictsFor(patientUid, occurrenceId))
          if (conflits.length > 0) {
            return {
              ok: false,
              message: 'Cette personne a déjà quelque chose à ce moment-là.',
              conflicts: conflits.map((c) => ({
                label: c.label,
                kind: c.kind,
                start: c.start,
                end: c.end,
              })),
            }
          }
        }
        const outcome = domainRegister(board, patientUid, {
          now: new Date(),
          registrationId: `${occurrenceId}--${patientUid}--${Date.now()}`,
          by: 'staff',
          ...(options.overCapacity === true ? { overCapacity: true } : {}),
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
        // Même restriction que les règles Firestore : un intervenant ne lit que son
        // agenda. La démonstration doit refuser exactement ce que le serveur refuse.
        return visibleAppointments(identity, [...world.appointments]).sort(
          (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
        )
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
        if (!canScheduleAs(identity, rendezVous.practitionerId ?? null)) {
          return { ok: false, message: refusDAgenda }
        }
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
        if (!canScheduleAs(identity, rendezVous.practitionerId ?? null)) {
          return { ok: false, message: refusDAgenda }
        }
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

      /**
       * Le même croisement que le serveur, sur le monde de la démonstration : les plages
       * de l'intervenant, son agenda, celui du patient, et un créneau proposé.
       */
      async appointmentPlanning(query) {
        const intervenant = mockCatalog.practitioners().find((p) => p.id === query.practitionerId)
        const plages = intervenant?.availability ?? []
        const duree = query.durationMin ?? 30
        // Jamais aujourd'hui : voir `firstBookableDay`.
        const depart = query.from ?? firstBookableDay(todayLocalDate())
        const jusque = addLocalDays(depart, PLANNING_HORIZON_DAYS)

        const occupeIntervenant: BusyEntry[] = []
        for (const rendezVous of world.appointments) {
          if (rendezVous.practitionerId !== query.practitionerId || rendezVous.status !== 'scheduled') continue
          if (rendezVous.start === undefined || rendezVous.end === undefined) continue
          occupeIntervenant.push({
            start: rendezVous.start,
            end: rendezVous.end,
            label: 'Rendez-vous',
            kind: 'appointment',
          })
        }
        for (const occurrence of world.occurrences.values()) {
          if (occurrence.facilitatorId !== query.practitionerId || occurrence.status === 'cancelled') continue
          if (occurrence.localDate < depart || occurrence.localDate > jusque) continue
          occupeIntervenant.push({
            start: occurrence.start,
            end: occurrence.end,
            label: occurrence.title,
            kind: 'activity',
          })
        }

        const occupePatient: BusyEntry[] = []
        if (query.patientUid !== undefined) {
          for (let i = 0; i <= PLANNING_HORIZON_DAYS; i += 1) {
            occupePatient.push(...busyOn(query.patientUid, addLocalDays(depart, i)))
          }
        }

        const jours = Array.from({ length: PLANNING_HORIZON_DAYS }, (_, i) => addLocalDays(depart, i))
        const conges = world.leaves[query.practitionerId] ?? []
        const semaine = agendaWeek(jours, plages, [...occupeIntervenant, ...occupePatient], duree, conges)
        return {
          availability: plages,
          week: semaine.map((jour) => ({
            localDate: jour.localDate,
            onLeave: jour.onLeave,
            windows: jour.windows,
            free: jour.free,
            taken: jour.taken.map((t) => ({ label: t.label, kind: t.kind, start: t.start, end: t.end })),
          })),
          suggestion: suggestSlot({
            windows: plages,
            practitionerBusy: occupeIntervenant,
            patientBusy: occupePatient,
            preference: query.preference ?? 'peu-importe',
            from: depart,
            horizonDays: PLANNING_HORIZON_DAYS,
            durationMin: duree,
            leaves: conges,
          }),
        }
      },

      async cancelAppointment(appointmentId: string, reason: string) {
        world.appointments = world.appointments.map((a) =>
          a.id === appointmentId ? { ...a, status: 'cancelled' as const, cancellationReason: reason } : a,
        )
        return { ok: true, message: 'Rendez-vous annulé.' }
      },

      async warmRegistration() {
        // Rien à réveiller : la démonstration n'appelle aucun serveur.
      },

      async warmAttendance() {
        // Rien à réveiller : la démonstration n'appelle aucun serveur.
      },

      async unregisterPatient(occurrenceId: string, patientUid: string) {
        const board = boardOf(occurrenceId)
        if (board === null) return { ok: false, message: "Cette activité n'a pas été trouvée." }
        const outcome = domainUnregister(board, patientUid)
        if (!outcome.ok) return { ok: false, message: "Cette personne n'était pas inscrite." }
        applyBoard(outcome.board)
        return { ok: true, message: 'Retiré de la liste.' }
      },

      async readLeaves(): Promise<Record<string, Leave[]>> {
        return { ...world.leaves }
      },

      async declareLeave(practitionerId: string, leave: Leave, options = {}) {
        // Le même partage de droits que sur le serveur : chacun le sien, l'administrateur
        // pour tout le monde. La démonstration doit refuser ce que le serveur refuse.
        if (identity.role !== 'admin' && identity.practitionerId !== practitionerId) {
          return {
            ok: false,
            message: 'Vous ne pouvez déclarer un congé que pour vous-même. Demandez à un administrateur.',
          }
        }
        const refus = leaveRefusal(leave)
        if (refus !== null) return { ok: false, message: refus }

        const enCours = world.appointments.filter(
          (a) =>
            a.practitionerId === practitionerId &&
            a.status === 'scheduled' &&
            a.localDate !== undefined &&
            a.localDate >= leave.from &&
            a.localDate <= leave.to,
        )
        const animees = [...world.occurrences.values()].filter(
          (o) =>
            o.facilitatorId === practitionerId &&
            o.status !== 'cancelled' &&
            o.localDate >= leave.from &&
            o.localDate <= leave.to,
        ).length

        if (enCours.length > 0 && options.force !== true) {
          return {
            ok: false,
            needsConfirmation: true,
            activityCount: animees,
            conflicts: enCours.map((a) => ({
              appointmentId: a.id,
              firstName: world.patients.find((p) => p.uid === a.patientUid)?.firstName ?? 'Prénom inconnu',
              localDate: a.localDate!,
              ...(a.start === undefined ? {} : { start: a.start.toISOString() }),
              ...(a.end === undefined ? {} : { end: a.end.toISOString() }),
            })),
            message:
              enCours.length === 1
                ? 'Un rendez-vous est déjà fixé pendant ce congé.'
                : `${enCours.length} rendez-vous sont déjà fixés pendant ce congé.`,
          }
        }

        world.leaves = {
          ...world.leaves,
          [practitionerId]: normalizeLeaves([...(world.leaves[practitionerId] ?? []), leave]),
        }
        const rouverts = new Set(enCours.map((a) => a.id))
        world.appointments = world.appointments.map((a) => {
          if (!rouverts.has(a.id)) return a
          /*
            La date s'efface, le nom demeure : c'est lui qui ramène la demande dans la
            file de la personne. Rouvrir une demande pour qu'elle n'atterrisse nulle part
            ne vaudrait pas mieux que l'annuler.
          */
          const { start, end, localDate, withWhom, locationId, autoAccepted, ...reste } = a
          void start, void end, void localDate, void withWhom, void locationId, void autoAccepted
          return { ...reste, status: 'requested' as const, reopenedForLeave: true }
        })

        return {
          ok: true,
          reopened: enCours.length,
          activityCount: animees,
          message:
            enCours.length === 0
              ? 'Le congé est enregistré. Aucun rendez-vous ne sera proposé sur ces jours.'
              : enCours.length === 1
                ? 'Le congé est enregistré. Le rendez-vous est remis dans la file et doit être refixé.'
                : `Le congé est enregistré. ${enCours.length} rendez-vous sont remis dans la file et doivent être refixés.`,
        }
      },

      async removeLeave(practitionerId: string, leave: Leave) {
        if (identity.role !== 'admin' && identity.practitionerId !== practitionerId) {
          return { ok: false, message: 'Vous ne pouvez retirer que vos propres congés.' }
        }
        world.leaves = {
          ...world.leaves,
          [practitionerId]: withoutLeave(world.leaves[practitionerId] ?? [], leave),
        }
        return {
          ok: true,
          message:
            'Le congé est retiré. Les rendez-vous déjà remis dans la file y restent : ils se refixent à la main.',
        }
      },

      async readMyUnit(): Promise<string | null> {
        const uid = identity.uid
        if (uid === null) return null
        return world.staffUnits[uid] ?? null
      },

      async saveMyUnit(serviceId: string | null) {
        const uid = identity.uid
        if (uid === null) return { ok: false, message: 'Vous n’êtes pas connecté.' }
        const suivants = { ...world.staffUnits }
        if (serviceId === null || serviceId === '') delete suivants[uid]
        else suivants[uid] = serviceId
        world.staffUnits = suivants
        return { ok: true, message: 'Votre unité est enregistrée.' }
      },

      async readPatientPermissions(): Promise<PatientPermissions> {
        return { ...world.patientPermissions }
      },

      async savePatientPermissions(permissions: PatientPermissions) {
        exigeAdministrateur()
        world.patientPermissions = { ...permissions }
        return { ok: true, message: 'Réglage enregistré.' }
      },

      async readPatientActions(): Promise<Record<string, PatientActionOverrides>> {
        return { ...world.patientActions }
      },

      async savePatientActions(patientUid: string, overrides: PatientActionOverrides) {
        exigeAdministrateur()
        const suivants = { ...world.patientActions }
        if (hasOverrides(overrides)) suivants[patientUid] = { ...overrides }
        else delete suivants[patientUid]
        world.patientActions = suivants
        return { ok: true, message: 'Réglage enregistré pour cette personne.' }
      },

      async listProposals(): Promise<ActivityProposal[]> {
        // Les règles Firestore ne rendent ces idées qu'à l'administrateur : la
        // démonstration doit refuser exactement ce que le serveur refuse, sans quoi
        // prendre la place d'un soignant ne montrerait pas ce qu'il voit vraiment.
        exigeAdministrateur()
        return [...world.proposals].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      },

      async decideProposal(
        proposalId: string,
        decision: 'accepted' | 'declined',
        options: { declineReason?: string; activityId?: string } = {},
      ) {
        exigeAdministrateur()
        const idee = world.proposals.find((p) => p.id === proposalId)
        if (idee === undefined) return { ok: false, message: "Cette idée n'existe plus." }
        const motif = (options.declineReason ?? '').trim()
        if (decision === 'declined' && motif.length < 3) {
          return {
            ok: false,
            message: 'Dites en une phrase pourquoi cette idée n’est pas retenue. Elle sera lue telle quelle.',
          }
        }
        if (idee.status !== 'proposed' && idee.status !== decision) {
          return { ok: false, message: 'Cette idée a déjà reçu une réponse.' }
        }
        world.proposals = world.proposals.map((p) =>
          p.id === proposalId
            ? {
                ...p,
                status: decision,
                decidedAt: new Date(),
                ...(decision === 'declined' ? { declineReason: motif } : {}),
                ...(options.activityId === undefined ? {} : { activityId: options.activityId }),
              }
            : p,
        )
        return {
          ok: true,
          message:
            decision === 'accepted'
              ? 'Idée retenue. Créez l’activité : le titre et la description sont recopiés.'
              : 'Réponse enregistrée. La personne lira votre phrase.',
        }
      },

      async promotePatient(occurrenceId: string, patientUid: string) {
        const board = boardOf(occurrenceId)
        if (board === null) return { ok: false, message: "Cette activité n'a pas été trouvée." }
        const outcome = domainPromote(board, patientUid)
        if (!outcome.ok) return { ok: false, message: "Cette personne n'est pas sur la liste d'attente." }
        applyBoard(outcome.board)
        return { ok: true, message: 'La personne est inscrite.' }
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
      async saveAppointmentKind(kind) {
        exigeAdministrateur()
        mockCatalog.saveAppointmentKind(kind)
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
        exigeAdministrateur()
        mockCatalog.savePractitioner(practitioner)
      },
      async saveAvailability(practitionerId, windows) {
        // Chacun tient les siennes ; l'administrateur, celles de tout le monde.
        if (identity.role !== 'admin' && identity.practitionerId !== practitionerId) {
          throw new Error('Vous ne pouvez modifier que vos propres disponibilités.')
        }
        const personne = mockCatalog.practitioners().find((i) => i.id === practitionerId)
        if (personne === undefined) throw new Error("Cette personne n'existe pas.")
        mockCatalog.savePractitioner({ ...personne, availability: windows })
      },
      async setStaffRole(uid, role) {
        // La démonstration n'a pas de comptes réels : on répond ce que répondrait le
        // serveur, pour que l'écran se comporte pareil.
        if (identity.role !== 'admin') {
          return { ok: false, message: "Cette action est réservée à l'administrateur." }
        }
        // Le changement se voit dans la démonstration comme il se verrait en vrai.
        const intervenantId = uid.replace(/^staff-/, '')
        rolesDeDemonstration.set(intervenantId, role)
        return {
          ok: true,
          message:
            role === 'admin'
              ? 'Cette personne est administratrice. Elle devra se reconnecter pour que cela s’applique.'
              : 'Cette personne n’est plus administratrice. Elle devra se reconnecter pour que cela s’applique.',
        }
      },

      async setAutoAccept(practitionerId, autoAccept) {
        // Même droit que les plages : l'intéressé, ou l'administrateur.
        if (identity.role !== 'admin' && identity.practitionerId !== practitionerId) {
          throw new Error('Vous ne pouvez modifier que votre propre acceptation automatique.')
        }
        const personne = mockCatalog.practitioners().find((i) => i.id === practitionerId)
        if (personne === undefined) throw new Error("Cette personne n'existe pas.")
        mockCatalog.savePractitioner({ ...personne, autoAccept })
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
          .map((i) => ({
            uid: `staff-${i.id}`,
            label: i.name,
            detail: i.role,
            kind: 'staff' as const,
            // La démonstration relie chaque intervenant à un compte : c'est ce qui permet
            // d'y montrer la case « Administrateur », comme en vrai.
            role: rolesDeDemonstration.get(i.id) ?? ('staff' as const),
            practitionerId: i.id,
          }))
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
