/**
 * Le monde de la démonstration : occurrences, inscriptions, patients.
 *
 * Un seul état, partagé par l'adapter patient et l'adapter soignant. C'est ce qui rend
 * la démonstration honnête : quand une soignante inscrit Camille au ping-pong depuis la
 * réunion du lundi, Camille le voit dans son calendrier — exactement comme en service.
 *
 * ⚠️ Ce module doit rester dans le même fragment que les deux adapters : `mock/index.ts`
 * les charge ensemble pour cette raison.
 */
import { config } from '../../config'
import { conflictsWith, type BusyEntry } from '../../domain/conflicts'
import { expand } from '../../domain/recurrence'
import { addLocalDays, instantOf, startOfIsoWeek, todayLocalDate } from '../../domain/time'
import type { ActivityProposal } from '../../domain/proposals'
import type { Appointment, Occurrence, Registration } from '../../domain/types'
import { recount, type Board } from '../../domain/waitlist'
import { activitiesSeed } from '../seed/activities.seed'
import { patientsSeed, type SeedPatient } from '../seed/patients.seed'
export type { SeedPatient }
import type { PatientSession } from '../ports'
import { mockCatalog } from './catalog'

export const DEMO_PATIENT_UID = 'demo-patient'
export const DEMO_SERVICE_ID = 'le-mazurel'

/** Hachage stable : la démonstration montre les mêmes taux de remplissage à chaque ouverture. */
function stableHash(value: string): number {
  let h = 2166136261
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return Math.abs(h)
}

export type MockWorld = {
  occurrences: Map<string, Occurrence>
  /** L'appel, par « occurrence|patient ». Côté Firestore, c'est un champ de l'inscription. */
  attendance: Map<string, 'present' | 'absent'>
  registrations: Registration[]
  appointments: Appointment[]
  /** Les idées déposées par les patients, en attente d'une réponse ou déjà décidées. */
  proposals: ActivityProposal[]
  patients: (SeedPatient & { expiresAt?: Date })[]
  session: PatientSession
  /**
   * « Voir à leur place » : le compte dont on a pris la place, s'il y en a un. Rangé
   * dans le `sessionStorage` pour survivre au rechargement — une vraie session y survit,
   * la démonstration doit en faire autant, sans quoi le détour s'arrêterait au premier
   * clic. Il disparaît avec l'onglet.
   */
  impersonating: string | null
}

/**
 * Le peu que la démonstration garde d'un rechargement à l'autre : la session soignante
 * ouverte, et le compte dont on a pris la place. Tout le reste est reconstruit — c'est
 * ce qui fait qu'une démonstration repart toujours propre.
 *
 * Lecture et écriture prudentes : ni onglet privé, ni test sans stockage ne doivent
 * faire échouer la construction du monde.
 */
export function readDemo(key: string): string | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage.getItem(key)
  } catch {
    return null
  }
}

export function writeDemo(key: string, value: string | null): void {
  try {
    if (typeof sessionStorage === 'undefined') return
    if (value === null) sessionStorage.removeItem(key)
    else sessionStorage.setItem(key, value)
  } catch {
    // Sans stockage, rien ne survit au rechargement. Ce n'est pas une erreur.
  }
}

export const CLE_DETOUR = 'leuze.demo.aLaPlaceDe'
export const CLE_SESSION_SOIGNANT = 'leuze.demo.soignant'

export const storedDetour = (): string | null => readDemo(CLE_DETOUR)
export const storeDetour = (uid: string | null): void => writeDemo(CLE_DETOUR, uid)

function build(now: Date): MockWorld {
  const today = todayLocalDate(now)
  const from = addLocalDays(today, -28)
  const to = addLocalDays(today, config.generationWindowWeeks * 7)

  const occurrences = new Map<string, Occurrence>()
  for (const activity of activitiesSeed) {
    for (const occurrence of expand(activity, from, to)) occurrences.set(occurrence.id, occurrence)
  }

  // Quelques inscriptions déjà prises, pour que la démonstration montre aussi des
  // activités complètes et des listes d'attente. Elles sont attribuées à de vrais
  // patients de la démonstration, pour que la réunion du lundi soit crédible.
  const registrations: Registration[] = []
  const finDuPreRemplissage = addLocalDays(today, 15)
  for (const occurrence of occurrences.values()) {
    if (!occurrence.registrationRequired || occurrence.capacity === null) continue
    // Au-delà de quinze jours, les activités restent libres : une démonstration où
    // chacun est déjà inscrit partout ne ressemble à rien de réel.
    if (occurrence.localDate > finDuPreRemplissage) continue
    const eligibles = patientsSeed.filter(
      (p) => occurrence.audienceKeys.includes('all') || occurrence.audienceKeys.includes(p.serviceId),
    )
    if (eligibles.length === 0) continue

    const seed = stableHash(occurrence.id)
    const combien = Math.min(seed % (occurrence.capacity + 2), eligibles.length)
    for (let i = 0; i < combien; i += 1) {
      const patient = eligibles[(seed + i) % eligibles.length]!
      if (registrations.some((r) => r.occurrenceId === occurrence.id && r.patientUid === patient.uid)) continue
      const queuedAt = new Date(occurrence.start.getTime() - (combien - i) * 3_600_000)
      registrations.push({
        id: `${occurrence.id}--${patient.uid}`,
        occurrenceId: occurrence.id,
        patientUid: patient.uid,
        status: 'confirmed',
        createdAt: queuedAt,
        queuedAt,
        createdBy: 'staff',
      })
    }
  }

  // Une demande en attente, pour que la file du soignant ne soit pas vide, et un
  // rendez-vous déjà fixé, pour que la semaine d'une personne et les plannings imprimés
  // montrent ce qu'ils font d'un rendez-vous.
  // Le jeudi de la semaine — celui de la semaine prochaine s'il est déjà passé. Un
  // rendez-vous de démonstration doit être à venir : c'est ce que la personne voit sur
  // son écran d'accueil, et un rendez-vous d'hier ne montre rien.
  const jeudiDeLaSemaine = addLocalDays(startOfIsoWeek(today), 3)
  const jeudi = jeudiDeLaSemaine >= today ? jeudiDeLaSemaine : addLocalDays(jeudiDeLaSemaine, 7)
  const appointments: Appointment[] = [
    {
      id: 'rdv-demo-1',
      patientUid: 'demo-p2',
      kindId: 'psychiatre',
      preference: 'matin',
      status: 'requested',
      createdAt: new Date(now.getTime() - 2 * 86_400_000),
    },
    {
      id: 'rdv-demo-2',
      patientUid: DEMO_PATIENT_UID,
      kindId: 'psychiatre',
      preference: 'matin',
      status: 'scheduled',
      createdAt: new Date(now.getTime() - 5 * 86_400_000),
      start: instantOf(jeudi, '11:00'),
      end: instantOf(jeudi, '11:30'),
      localDate: jeudi,
      withWhom: 'Docteur Lemaire',
      practitionerId: 'docteur-lemaire',
      locationId: 'salon-daccueil',
    },
  ]

  const patients = patientsSeed.map((p) => ({ ...p }))
  // Si l'on regardait à la place de quelqu'un avant le rechargement, on y est encore.
  const detour = storedDetour()
  const aLaPlaceDe = detour === null ? undefined : patients.find((p) => p.uid === detour)

  const monde: MockWorld = {
    occurrences,
    attendance: new Map(),
    registrations,
    appointments,
    /*
      Une idée déjà déposée, pour que la démonstration montre l'onglet plein plutôt
      qu'une file vide. Elle vient d'un patient qui n'est pas celui de la démonstration :
      la personne qui essaie l'application doit pouvoir en proposer une à son tour.
    */
    proposals: [
      {
        id: 'idee-demonstration',
        patientUid: patients[1]?.uid ?? 'p_2',
        patientFirstName: patients[1]?.firstName ?? 'Bernard',
        title: 'Tournoi d’échecs',
        description:
          'Je joue depuis longtemps et je peux apprendre les règles à ceux qui ne savent pas. Il faudrait deux ou trois échiquiers et une table.',
        wantsToLead: true,
        status: 'proposed',
        createdAt: addLocalDays(today, -2) === today ? now : instantOf(addLocalDays(today, -2), '10:00'),
      },
    ],
    patients,
    session:
      aLaPlaceDe === undefined
        ? { patientUid: DEMO_PATIENT_UID, firstName: 'Camille', serviceId: DEMO_SERVICE_ID }
        : { patientUid: aLaPlaceDe.uid, firstName: aLaPlaceDe.firstName, serviceId: aLaPlaceDe.serviceId },
    impersonating: detour,
  }
  for (const occurrence of occurrences.values()) syncCounts(monde, occurrence.id)
  return monde
}

export let world: MockWorld = build(new Date())

export function resetWorld(now: Date = new Date()): void {
  world = build(now)
}

export function boardOf(occurrenceId: string): Board | null {
  const occurrence = world.occurrences.get(occurrenceId)
  if (!occurrence) return null
  return {
    occurrence,
    registrations: world.registrations.filter((r) => r.occurrenceId === occurrenceId),
  }
}

export function applyBoard(board: Board): void {
  world.occurrences.set(board.occurrence.id, board.occurrence)
  const autres = world.registrations.filter((r) => r.occurrenceId !== board.occurrence.id)
  world.registrations = [...autres, ...board.registrations]
}

function syncCounts(monde: MockWorld, occurrenceId: string): void {
  const occurrence = monde.occurrences.get(occurrenceId)
  if (!occurrence) return
  const board: Board = {
    occurrence,
    registrations: monde.registrations.filter((r) => r.occurrenceId === occurrenceId),
  }
  monde.occurrences.set(occurrenceId, recount(board).occurrence)
}

/**
 * Ce qui occupe déjà une personne le jour d'une séance donnée — la démonstration
 * répondant à la même question que le serveur, et par le même chemin.
 */
export function busyOn(
  patientUid: string,
  localDate: string,
  ignoreOccurrenceId?: string,
): BusyEntry[] {
  const occupe: BusyEntry[] = []

  for (const inscription of world.registrations) {
    if (inscription.patientUid !== patientUid || inscription.status === 'cancelled') continue
    if (inscription.occurrenceId === ignoreOccurrenceId) continue
    const occurrence = world.occurrences.get(inscription.occurrenceId)
    if (occurrence === undefined || occurrence.localDate !== localDate) continue
    if (occurrence.status === 'cancelled') continue
    occupe.push({
      start: occurrence.start,
      end: occurrence.end,
      label: occurrence.title,
      kind: 'activity',
    })
  }

  for (const rendezVous of world.appointments) {
    if (rendezVous.patientUid !== patientUid || rendezVous.status !== 'scheduled') continue
    if (rendezVous.localDate !== localDate || rendezVous.start === undefined || rendezVous.end === undefined) {
      continue
    }
    const qui = rendezVous.withWhom ?? mockCatalog.appointmentKinds().find((k) => k.id === rendezVous.kindId)?.name
    occupe.push({
      start: rendezVous.start,
      end: rendezVous.end,
      label: `Rendez-vous avec ${qui ?? 'un professionnel'}`,
      kind: 'appointment',
    })
  }
  return occupe
}

/** Ce qui tombe en même temps qu'une séance, pour cette personne. */
export function conflictsFor(patientUid: string, occurrenceId: string): BusyEntry[] {
  const occurrence = world.occurrences.get(occurrenceId)
  if (occurrence === undefined) return []
  return conflictsWith(
    { start: occurrence.start, end: occurrence.end },
    busyOn(patientUid, occurrence.localDate, occurrenceId),
  )
}
