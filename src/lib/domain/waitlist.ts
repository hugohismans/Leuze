import { registrationBlock, type RegistrationBlock } from './capacity'
import type { Occurrence, Registration } from './types'

/**
 * État complet d'une occurrence et de ses inscriptions.
 * Ces réducteurs sont purs : ce sont exactement eux que la transaction Firestore
 * exécutera côté Cloud Function. Un bug ici = surréservation en production.
 */
export type Board = {
  occurrence: Occurrence
  registrations: Registration[]
}

const active = (r: Registration) => r.status !== 'cancelled'
const byQueueOrder = (a: Registration, b: Registration) => a.queuedAt.getTime() - b.queuedAt.getTime()

/** Recalcule les compteurs dénormalisés. Invariant vérifié après chaque opération. */
export function recount(board: Board): Board {
  const confirmedCount = board.registrations.filter((r) => r.status === 'confirmed').length
  const waitlistCount = board.registrations.filter((r) => r.status === 'waitlist').length
  return { ...board, occurrence: { ...board.occurrence, confirmedCount, waitlistCount } }
}

export function registrationOf(board: Board, patientUid: string): Registration | null {
  return board.registrations.find((r) => r.patientUid === patientUid && active(r)) ?? null
}

/** Position dans la liste d'attente, en commençant à 1. `null` si le patient n'y est pas. */
export function waitlistPosition(board: Board, patientUid: string): number | null {
  const queue = board.registrations.filter((r) => r.status === 'waitlist').sort(byQueueOrder)
  const index = queue.findIndex((r) => r.patientUid === patientUid)
  return index === -1 ? null : index + 1
}

export type RegisterOutcome =
  | { ok: true; status: 'confirmed' | 'waitlist'; position: number | null; board: Board }
  | { ok: false; reason: RegistrationBlock | 'already-registered' }

export function register(
  board: Board,
  patientUid: string,
  options: { now: Date; registrationId: string; by: 'patient' | 'staff' },
): RegisterOutcome {
  if (registrationOf(board, patientUid) !== null) return { ok: false, reason: 'already-registered' }

  const block = registrationBlock(board.occurrence, options.now)
  // Le personnel peut inscrire quelqu'un sur une activité sans inscription obligatoire.
  const blocking = block !== null && !(block === 'no-registration-required' && options.by === 'staff')
  if (blocking && block !== null) return { ok: false, reason: block }

  const capacity = board.occurrence.capacity
  const confirmed = board.registrations.filter((r) => r.status === 'confirmed').length
  const goesToWaitlist = capacity !== null && confirmed >= capacity

  const registration: Registration = {
    id: options.registrationId,
    occurrenceId: board.occurrence.id,
    patientUid,
    status: goesToWaitlist ? 'waitlist' : 'confirmed',
    createdAt: options.now,
    queuedAt: options.now,
    createdBy: options.by,
  }

  const next = recount({ ...board, registrations: [...board.registrations, registration] })
  return {
    ok: true,
    status: registration.status,
    position: goesToWaitlist ? waitlistPosition(next, patientUid) : null,
    board: next,
  }
}

export type UnregisterOutcome =
  | { ok: true; board: Board; promoted: Registration | null }
  | { ok: false; reason: 'not-registered' }

/**
 * Désinscription. Si une place confirmée se libère, le premier de la liste d'attente
 * est promu dans la même opération — cela ne dépend pas du navigateur du patient.
 */
export function unregister(board: Board, patientUid: string): UnregisterOutcome {
  const current = registrationOf(board, patientUid)
  if (current === null) return { ok: false, reason: 'not-registered' }

  let registrations = board.registrations.map((r) =>
    r.id === current.id ? { ...r, status: 'cancelled' as const } : r,
  )

  let promoted: Registration | null = null
  if (current.status === 'confirmed') {
    const capacity = board.occurrence.capacity
    const confirmed = registrations.filter((r) => r.status === 'confirmed').length
    const first = registrations.filter((r) => r.status === 'waitlist').sort(byQueueOrder)[0]
    if (first && (capacity === null || confirmed < capacity)) {
      promoted = { ...first, status: 'confirmed' }
      registrations = registrations.map((r) => (r.id === first.id ? promoted! : r))
    }
  }

  return { ok: true, board: recount({ ...board, registrations }), promoted }
}

/** Promotion manuelle par un soignant (par exemple après un désistement de vive voix). */
export function promote(board: Board, patientUid: string): { ok: boolean; board: Board } {
  const current = registrationOf(board, patientUid)
  if (current === null || current.status !== 'waitlist') return { ok: false, board }
  return {
    ok: true,
    board: recount({
      ...board,
      registrations: board.registrations.map((r) =>
        r.id === current.id ? { ...r, status: 'confirmed' as const } : r,
      ),
    }),
  }
}

/** Liste destinée au soignant : confirmés d'abord, puis la file d'attente dans l'ordre. */
export function rosterOf(board: Board): { confirmed: Registration[]; waitlist: Registration[] } {
  return {
    confirmed: board.registrations.filter((r) => r.status === 'confirmed').sort(byQueueOrder),
    waitlist: board.registrations.filter((r) => r.status === 'waitlist').sort(byQueueOrder),
  }
}
