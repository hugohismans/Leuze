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
import { expand } from '../../domain/recurrence'
import { addLocalDays, todayLocalDate } from '../../domain/time'
import type { Appointment, Occurrence, Registration } from '../../domain/types'
import { recount, type Board } from '../../domain/waitlist'
import { activitiesSeed } from '../seed/activities.seed'
import { patientsSeed, type SeedPatient } from '../seed/patients.seed'
export type { SeedPatient }
import type { PatientSession } from '../ports'

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
  registrations: Registration[]
  appointments: Appointment[]
  patients: (SeedPatient & { expiresAt?: Date })[]
  session: PatientSession
}

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
  for (const occurrence of occurrences.values()) {
    if (!occurrence.registrationRequired || occurrence.capacity === null) continue
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

  // Une demande déjà en attente, pour que la file du soignant ne soit pas vide
  // à l'ouverture de la démonstration.
  const appointments: Appointment[] = [
    {
      id: 'rdv-demo-1',
      patientUid: 'demo-p2',
      kindId: 'psychiatre',
      preference: 'matin',
      status: 'requested',
      createdAt: new Date(now.getTime() - 2 * 86_400_000),
    },
  ]

  const monde: MockWorld = {
    occurrences,
    registrations,
    appointments,
    patients: patientsSeed.map((p) => ({ ...p })),
    session: { patientUid: DEMO_PATIENT_UID, firstName: 'Camille', serviceId: DEMO_SERVICE_ID },
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
