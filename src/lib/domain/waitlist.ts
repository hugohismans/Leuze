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
/**
 * L'ordre de la file d'attente : l'heure d'arrivée, et elle seule.
 *
 * Rien ne départage deux heures identiques, et c'est voulu — parce que `register`
 * garantit qu'il n'y en a pas (voir plus bas). Ajouter un second critère, l'identifiant
 * par exemple, serait pire que de n'en avoir aucun : le nouvel arrivant pourrait passer
 * devant quelqu'un qui attendait déjà, et l'on annoncerait « position 1 » à deux
 * personnes. Essayé, et rattrapé par les tests.
 */
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

  /*
    L'heure de mise en file avance toujours, même quand l'horloge n'avance pas.

    Cinq personnes qui s'inscrivent dans la même milliseconde — deux bornes en salle
    commune, ou un soignant qui clique vite — porteraient la même heure d'arrivée. Rien
    ne les départagerait alors, et l'ordre de la file dépendrait de celui dans lequel la
    base rend les documents, qui n'est pas le même d'une lecture à l'autre : quelqu'un
    reculerait d'une place sans que personne ne se soit inscrit avant lui.

    On décale donc d'une milliseconde après le dernier arrivé. `createdAt` garde l'heure
    vraie ; `queuedAt` n'existe que pour ranger la file, et une file se range dans l'ordre
    où les gens se présentent.
  */
  const dernier = board.registrations.reduce((max, r) => Math.max(max, r.queuedAt.getTime()), 0)
  const queuedAt = new Date(Math.max(options.now.getTime(), dernier + 1))

  const registration: Registration = {
    id: options.registrationId,
    occurrenceId: board.occurrence.id,
    patientUid,
    status,
    createdAt: options.now,
    queuedAt,
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
  | {
      ok: true
      board: Board
      /**
       * L'inscription réellement annulée — celle-ci et pas une autre.
       *
       * Elle est rendue parce que celui qui écrit en base doit savoir **quel document**
       * annuler, et qu'il ne peut pas le retrouver seul : une personne qui s'est inscrite,
       * désinscrite, puis réinscrite a plusieurs lignes à son nom, dont une déjà annulée.
       * Chercher « la ligne annulée de cette personne » tombait sur l'ancienne, et la
       * nouvelle restait active. Ici, l'identifiant ne se devine pas : il se transmet.
       */
      cancelled: Registration
      promoted: Registration | null
    }
  | { ok: false; reason: 'not-registered' }

/**
 * Désinscription. Si une place confirmée se libère, le premier de la liste d'attente
 * est promu dans la même opération — cela ne dépend pas du navigateur du patient.
 */
export function unregister(board: Board, patientUid: string): UnregisterOutcome {
  const current = registrationOf(board, patientUid)
  if (current === null) return { ok: false, reason: 'not-registered' }

  const cancelled: Registration = { ...current, status: 'cancelled' }
  let registrations = board.registrations.map((r) => (r.id === current.id ? cancelled : r))

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

  return { ok: true, board: recount({ ...board, registrations }), cancelled, promoted }
}

/**
 * Promotion manuelle par un soignant (par exemple après un désistement de vive voix).
 * Rend l'inscription promue pour la même raison que `unregister` rend celle qu'il annule :
 * l'identifiant du document ne doit pas se redeviner.
 */
export function promote(
  board: Board,
  patientUid: string,
): { ok: true; board: Board; promoted: Registration } | { ok: false; board: Board } {
  const current = registrationOf(board, patientUid)
  if (current === null || current.status !== 'waitlist') return { ok: false, board }
  const promoted: Registration = { ...current, status: 'confirmed' }
  return {
    ok: true,
    promoted,
    board: recount({
      ...board,
      registrations: board.registrations.map((r) => (r.id === current.id ? promoted : r)),
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
