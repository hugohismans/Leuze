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

/**
 * Cette inscription ferait-elle dépasser le nombre de places ?
 *
 * Sert à poser la question avant d'inscrire — jamais à refuser : c'est `register` qui
 * décide. Faux quand les places sont illimitées, et faux pour quelqu'un déjà inscrit.
 */
export function wouldExceedCapacity(board: Board, patientUid: string): boolean {
  if (registrationOf(board, patientUid) !== null) return false
  const capacity = board.occurrence.capacity
  if (capacity === null) return false
  return board.registrations.filter((r) => r.status === 'confirmed').length >= capacity
}

export function register(
  board: Board,
  patientUid: string,
  options: {
    now: Date
    registrationId: string
    by: 'patient' | 'staff'
    /**
     * Quelqu'un s'est présenté et l'animateur l'accepte. Ce n'est plus une réservation
     * mais un fait : la personne est là. On passe donc outre deux refus qui n'ont de
     * sens qu'avant l'activité — « déjà commencée », puisque l'appel se fait pendant, et
     * « complète », parce que le nombre de places ne change pas qui se tient dans la
     * salle. Une séance annulée, elle, reste annulée.
     */
    walkIn?: boolean
    /**
     * Le dépassement assumé, en réunion du lundi.
     *
     * L'équipe décide parfois qu'on peut être neuf pour huit places — elle connaît la
     * salle, le groupe et la personne. L'application n'a pas à discuter une décision de
     * service : elle l'enregistre. Mais elle l'a demandée, ce qui n'est pas la même chose
     * que de laisser passer en silence.
     *
     * Réservé au personnel : un patient qui s'inscrit seul n'y a pas droit, et la limite
     * reste la limite. C'est vérifié ici, pas seulement à l'écran.
     */
    overCapacity?: boolean
  },
): RegisterOutcome {
  if (registrationOf(board, patientUid) !== null) return { ok: false, reason: 'already-registered' }

  // « Sans inscription » n'empêche plus de s'inscrire : ne restent que les refus réels —
  // séance annulée, déjà commencée, ou complète sans liste d'attente.
  // Le dépassement n'appartient qu'au personnel : demandé par un patient, il est ignoré.
  const depassementAssume = options.overCapacity === true && options.by === 'staff'

  const block = registrationBlock(board.occurrence, options.now)
  if (block !== null) {
    // L'appel passe outre « déjà commencée » — il se fait pendant l'activité. Le
    // dépassement de la réunion, non : on n'inscrit pas quelqu'un à une séance passée.
    const passeOutre =
      (options.walkIn === true && (block === 'past' || block === 'full-no-waitlist')) ||
      (depassementAssume && block === 'full-no-waitlist')
    if (!passeOutre) return { ok: false, reason: block }
  }

  const capacity = board.occurrence.capacity
  const confirmed = board.registrations.filter((r) => r.status === 'confirmed').length
  // Une personne présente est confirmée, même au-delà du nombre de places : la feuille
  // doit dire qui était là, pas ce qui était prévu.
  const goesToWaitlist =
    options.walkIn !== true && !depassementAssume && capacity !== null && confirmed >= capacity

  const status = goesToWaitlist ? ('waitlist' as const) : ('confirmed' as const)
  const registration: Registration = {
    id: options.registrationId,
    occurrenceId: board.occurrence.id,
    patientUid,
    status,
    createdAt: options.now,
    queuedAt: options.now,
    createdBy: options.by,
  }

  const next = recount({ ...board, registrations: [...board.registrations, registration] })
  return {
    ok: true,
    status,
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
