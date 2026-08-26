import { registrationBlock, type RegistrationBlock, type RegistrationKind } from './capacity'
import type { Occurrence, Registration, RegistrationStatus } from './types'

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
  // Les spectateurs sont comptés à part, et surtout : jamais dans `confirmedCount`.
  // C'est ce compteur-là qui décide s'il reste des places.
  const spectatorCount = board.registrations.filter((r) => r.status === 'spectator').length
  return { ...board, occurrence: { ...board.occurrence, confirmedCount, waitlistCount, spectatorCount } }
}

/** Participer, ou regarder. Le statut le dit ; ceci évite de l'écrire dix fois. */
export function kindOf(registration: Registration): RegistrationKind {
  return registration.status === 'spectator' ? 'spectator' : 'participant'
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
  | {
      ok: true
      status: 'confirmed' | 'waitlist' | 'spectator'
      position: number | null
      board: Board
      /**
       * L'inscription écrite : celle qu'on vient de créer, ou celle qui a changé de nature.
       *
       * Elle est rendue pour la même raison que `unregister` rend celle qu'il annule :
       * celui qui écrit en base ne doit pas redeviner l'identifiant du document. Quelqu'un
       * qui passe de participant à spectateur ne crée rien — il change une ligne qui
       * existe, et en créer une seconde en laisserait deux actives à son nom.
       */
      registration: Registration
      /** Vrai quand rien n'a été créé : c'est un changement, pas une inscription. */
      changed: boolean
      /**
       * Le premier de la file, promu par la place que ce changement vient de libérer.
       *
       * Passer de participant à spectateur rend une place. Elle doit revenir à celui qui
       * l'attendait, dans le même geste — sinon elle reste vide jusqu'à ce qu'un soignant
       * s'en aperçoive, et la liste d'attente cesse d'être une file pour devenir une
       * loterie.
       */
      promoted: Registration | null
    }
  | { ok: false; reason: RegistrationBlock | 'already-registered' }

/**
 * La place qui vient de se libérer revient au premier de la file.
 *
 * Partagé entre la désinscription et le passage en spectateur : les deux rendent une
 * place, et les deux doivent la donner de la même façon. Deux copies auraient fini par
 * diverger — c'est déjà arrivé ailleurs dans ce fichier.
 */
function promoteFirst(
  registrations: Registration[],
  capacity: number | null,
): { registrations: Registration[]; promoted: Registration | null } {
  const confirmed = registrations.filter((r) => r.status === 'confirmed').length
  const first = registrations.filter((r) => r.status === 'waitlist').sort(byQueueOrder)[0]
  if (first === undefined || (capacity !== null && confirmed >= capacity)) {
    return { registrations, promoted: null }
  }
  const promoted: Registration = { ...first, status: 'confirmed' }
  return { registrations: registrations.map((r) => (r.id === first.id ? promoted : r)), promoted }
}

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
    /**
     * Participer, ou seulement regarder.
     *
     * Un spectateur ne prend aucune place : il n'entre pas dans `confirmedCount`, il ne
     * va jamais en liste d'attente, et une activité complète lui reste ouverte. Voir
     * `RegistrationStatus` dans les types.
     */
    as?: RegistrationKind
  },
): RegisterOutcome {
  const genre: RegistrationKind = options.as ?? 'participant'

  /*
    Changer d'avis n'est pas s'inscrire deux fois.

    Quelqu'un qui est inscrit et qui veut finalement seulement regarder — ou l'inverse —
    ne crée pas une seconde ligne : il change celle qu'il a. Deux lignes actives au nom de
    la même personne feraient dire n'importe quoi aux compteurs, et le refus sec
    (« Vous êtes déjà inscrit ») obligerait à se désinscrire d'abord, c'est-à-dire à
    lâcher sa place avant de savoir s'il y en aura une autre.
  */
  const existante = registrationOf(board, patientUid)
  if (existante !== null && kindOf(existante) === genre) return { ok: false, reason: 'already-registered' }

  // « Sans inscription » n'empêche plus de s'inscrire : ne restent que les refus réels —
  // séance annulée, déjà commencée, ou complète sans liste d'attente.
  // Le dépassement n'appartient qu'au personnel : demandé par un patient, il est ignoré.
  const depassementAssume = options.overCapacity === true && options.by === 'staff'

  // Le genre décide de ce qui bloque : une séance complète n'arrête pas un spectateur.
  const block = registrationBlock(board.occurrence, options.now, genre)
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
    genre === 'participant' &&
    options.walkIn !== true &&
    !depassementAssume &&
    capacity !== null &&
    confirmed >= capacity

  const status: RegistrationStatus =
    genre === 'spectator' ? 'spectator' : goesToWaitlist ? 'waitlist' : 'confirmed'

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

  if (existante !== null) {
    /*
      On change la ligne existante, et l'heure d'arrivée ne bouge que pour entrer en file.

      Quelqu'un qui regardait et qui veut participer garde l'heure à laquelle il s'était
      annoncé : sur la feuille d'appel, il est là depuis le début. Entrer en liste
      d'attente, en revanche, c'est se mettre dans une file — et l'on s'y met à la fin,
      pas devant ceux qui attendaient déjà.
    */
    const changee: Registration = {
      ...existante,
      status,
      ...(status === 'waitlist' ? { queuedAt } : {}),
      // Une ligne écrite avant que ce champ existe le reçoit en passant.
      localDate: board.occurrence.localDate,
    }
    let registrations = board.registrations.map((r) => (r.id === existante.id ? changee : r))

    // Une place rendue ne reste pas vide : voir `promoteFirst`.
    let promoted: Registration | null = null
    if (existante.status === 'confirmed' && status !== 'confirmed') {
      const apres = promoteFirst(registrations, capacity)
      registrations = apres.registrations
      promoted = apres.promoted
    }

    const suivant = recount({ ...board, registrations })
    return {
      ok: true,
      status,
      position: status === 'waitlist' ? waitlistPosition(suivant, patientUid) : null,
      board: suivant,
      registration: changee,
      changed: true,
      promoted,
    }
  }

  const registration: Registration = {
    id: options.registrationId,
    occurrenceId: board.occurrence.id,
    patientUid,
    status,
    createdAt: options.now,
    queuedAt,
    createdBy: options.by,
    // Le jour de la séance, recopié : c'est lui qui permet de demander « et ce mardi ? »
    // sans lire tout l'historique de la personne. Voir `Registration.localDate`.
    localDate: board.occurrence.localDate,
  }

  const next = recount({ ...board, registrations: [...board.registrations, registration] })
  return {
    ok: true,
    status,
    position: goesToWaitlist ? waitlistPosition(next, patientUid) : null,
    board: next,
    registration,
    changed: false,
    promoted: null,
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
      /**
       * Ce que la personne était avant ce geste — inscrite, en attente, ou simplement
       * venue regarder.
       *
       * `cancelled` ne peut pas le dire : il porte déjà le statut d'après, qui vaut
       * « annulé » pour tout le monde. Sans cette valeur, on répondait « Vous n'êtes plus
       * inscrit » à quelqu'un qui ne s'était pas inscrit.
       */
      was: Registration['status']
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

  // Seul un départ de place confirmée libère quelque chose. Quitter la liste d'attente ne
  // libère rien, et un spectateur ne rend rien : il n'avait pris la place de personne.
  let promoted: Registration | null = null
  if (current.status === 'confirmed') {
    const apres = promoteFirst(registrations, board.occurrence.capacity)
    registrations = apres.registrations
    promoted = apres.promoted
  }

  return { ok: true, board: recount({ ...board, registrations }), cancelled, was: current.status, promoted }
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

/**
 * Liste destinée au soignant : confirmés d'abord, puis la file d'attente dans l'ordre,
 * puis ceux qui viennent seulement regarder.
 *
 * Les spectateurs forment un troisième groupe, et non une mention à côté d'un prénom :
 * l'animateur compte ses participants d'un coup d'œil, et les mêler à la liste lui ferait
 * compter faux. Ils sont là, ils sont nommés — mais ailleurs.
 */
export function rosterOf(board: Board): {
  confirmed: Registration[]
  waitlist: Registration[]
  spectators: Registration[]
} {
  return {
    confirmed: board.registrations.filter((r) => r.status === 'confirmed').sort(byQueueOrder),
    waitlist: board.registrations.filter((r) => r.status === 'waitlist').sort(byQueueOrder),
    spectators: board.registrations.filter((r) => r.status === 'spectator').sort(byQueueOrder),
  }
}
