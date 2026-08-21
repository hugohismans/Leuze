import type { Firestore } from 'firebase-admin/firestore'
import { isVisibleToService } from '../domain/audience'
import { registrationBlockMessage } from '../domain/capacity'
import type { Occurrence, Registration } from '../domain/types'
import {
  register as domainRegister,
  promote as domainPromote,
  unregister as domainUnregister,
  rosterOf,
  type Board,
} from '../domain/waitlist'
import { COLLECTIONS, docToOccurrence, docToRegistration, registrationToDoc } from './firestore'

/**
 * Inscriptions : tout passe par une transaction, jamais par une lecture suivie d'une écriture.
 *
 * Deux patients qui touchent la dernière place au même instant, cela arrivera : sur une
 * borne en salle commune, c'est même le cas courant. La transaction relit les compteurs,
 * la fonction pure `register()` tranche, et l'écriture n'aboutit que si rien n'a bougé
 * entre-temps. Sinon Firestore rejoue la transaction.
 */

export type RegisterOutput =
  | { ok: true; status: 'confirmed' | 'waitlist'; position: number | null }
  | { ok: false; reason: string; message: string }

export type UnregisterOutput = { ok: boolean; message: string }

async function readBoard(
  database: Firestore,
  transaction: FirebaseFirestore.Transaction,
  occurrenceId: string,
): Promise<Board | null> {
  const occurrenceReference = database.collection(COLLECTIONS.occurrences).doc(occurrenceId)
  const occurrenceSnapshot = await transaction.get(occurrenceReference)
  if (!occurrenceSnapshot.exists) return null

  const registrationsSnapshot = await transaction.get(
    database.collection(COLLECTIONS.registrations).where('occurrenceId', '==', occurrenceId),
  )
  return {
    occurrence: docToOccurrence(occurrenceSnapshot),
    registrations: registrationsSnapshot.docs.map(docToRegistration),
  }
}

function writeCounters(
  database: Firestore,
  transaction: FirebaseFirestore.Transaction,
  occurrence: Occurrence,
): void {
  transaction.update(database.collection(COLLECTIONS.occurrences).doc(occurrence.id), {
    confirmedCount: occurrence.confirmedCount,
    waitlistCount: occurrence.waitlistCount,
  })
}

export async function registerTx(
  database: Firestore,
  options: {
    occurrenceId: string
    patientUid: string
    by: 'patient' | 'staff'
    /** Service du patient : vérifié ici aussi, car l'admin SDK ignore les règles. */
    serviceId?: string | null
    now?: Date
  },
): Promise<RegisterOutput> {
  const now = options.now ?? new Date()
  return database.runTransaction(async (transaction) => {
    const board = await readBoard(database, transaction, options.occurrenceId)
    if (board === null) {
      return { ok: false, reason: 'unknown', message: "Cette activité n'a pas été trouvée." }
    }
    if (options.by === 'patient' && !isVisibleToService(board.occurrence, options.serviceId ?? null)) {
      // Même message que pour une activité inexistante : ne pas révéler qu'elle existe.
      return { ok: false, reason: 'unknown', message: "Cette activité n'a pas été trouvée." }
    }

    const registrationId = database.collection(COLLECTIONS.registrations).doc().id
    const outcome = domainRegister(board, options.patientUid, { now, registrationId, by: options.by })
    if (!outcome.ok) {
      return {
        ok: false,
        reason: outcome.reason,
        message:
          outcome.reason === 'already-registered'
            ? 'Vous êtes déjà inscrit à cette activité.'
            : registrationBlockMessage(outcome.reason),
      }
    }

    const created = outcome.board.registrations.find((r) => r.id === registrationId) as Registration
    transaction.set(
      database.collection(COLLECTIONS.registrations).doc(registrationId),
      registrationToDoc(created),
    )
    writeCounters(database, transaction, outcome.board.occurrence)
    return { ok: true, status: outcome.status, position: outcome.position }
  })
}

export async function unregisterTx(
  database: Firestore,
  options: { occurrenceId: string; patientUid: string },
): Promise<UnregisterOutput> {
  return database.runTransaction(async (transaction) => {
    const board = await readBoard(database, transaction, options.occurrenceId)
    if (board === null) return { ok: false, message: "Cette activité n'a pas été trouvée." }

    const outcome = domainUnregister(board, options.patientUid)
    if (!outcome.ok) return { ok: false, message: "Vous n'êtes pas inscrit à cette activité." }

    const cancelled = outcome.board.registrations.find(
      (r) => r.patientUid === options.patientUid && r.status === 'cancelled',
    )
    if (cancelled) {
      transaction.update(database.collection(COLLECTIONS.registrations).doc(cancelled.id), {
        status: 'cancelled',
      })
    }
    // La place libérée revient au premier de la liste d'attente, dans la même transaction :
    // cela ne dépend pas du navigateur du patient qui se désinscrit.
    if (outcome.promoted) {
      transaction.update(database.collection(COLLECTIONS.registrations).doc(outcome.promoted.id), {
        status: 'confirmed',
      })
    }
    writeCounters(database, transaction, outcome.board.occurrence)
    return { ok: true, message: 'Vous n’êtes plus inscrit.' }
  })
}

/** Promotion manuelle par un soignant (désistement annoncé de vive voix). */
export async function promoteTx(
  database: Firestore,
  options: { occurrenceId: string; patientUid: string },
): Promise<{ ok: boolean; message: string }> {
  return database.runTransaction(async (transaction) => {
    const board = await readBoard(database, transaction, options.occurrenceId)
    if (board === null) return { ok: false, message: "Cette activité n'a pas été trouvée." }

    const outcome = domainPromote(board, options.patientUid)
    if (!outcome.ok) return { ok: false, message: "Cette personne n'est pas sur la liste d'attente." }

    const promoted = outcome.board.registrations.find(
      (r) => r.patientUid === options.patientUid && r.status === 'confirmed',
    )
    if (promoted) {
      transaction.update(database.collection(COLLECTIONS.registrations).doc(promoted.id), {
        status: 'confirmed',
      })
    }
    writeCounters(database, transaction, outcome.board.occurrence)
    return { ok: true, message: 'La personne est inscrite.' }
  })
}

/**
 * Les inscriptions d'un patient, avec sa position dans les listes d'attente.
 *
 * La position ne peut pas être calculée côté navigateur : elle demande de lire les
 * inscriptions des autres, ce que les règles interdisent. D'où cette fonction.
 */
export async function myRegistrationsFor(
  database: Firestore,
  patientUid: string,
): Promise<Array<{ occurrenceId: string; status: 'confirmed' | 'waitlist'; position: number | null }>> {
  const mine = await database
    .collection(COLLECTIONS.registrations)
    .where('patientUid', '==', patientUid)
    .get()

  const active = mine.docs.map(docToRegistration).filter((r) => r.status !== 'cancelled')
  const lignes = await Promise.all(
    active.map(async (registration) => {
      if (registration.status === 'confirmed') {
        return { occurrenceId: registration.occurrenceId, status: 'confirmed' as const, position: null }
      }
      const queue = await database
        .collection(COLLECTIONS.registrations)
        .where('occurrenceId', '==', registration.occurrenceId)
        .where('status', '==', 'waitlist')
        .orderBy('queuedAt')
        .get()
      const index = queue.docs.findIndex((document) => document.id === registration.id)
      return {
        occurrenceId: registration.occurrenceId,
        status: 'waitlist' as const,
        position: index === -1 ? null : index + 1,
      }
    }),
  )
  return lignes
}

export type RosterLine = {
  patientUid: string
  firstName: string
  serviceId: string | null
  status: 'confirmed' | 'waitlist'
  position: number | null
}

/**
 * Liste des inscrits, réservée au personnel. Elle joint les prénoms, qui vivent dans
 * `patients` — collection qu'aucun client ne peut lire directement.
 */
export async function rosterFor(database: Firestore, occurrenceId: string): Promise<RosterLine[]> {
  const occurrenceSnapshot = await database.collection(COLLECTIONS.occurrences).doc(occurrenceId).get()
  if (!occurrenceSnapshot.exists) return []
  const registrationsSnapshot = await database
    .collection(COLLECTIONS.registrations)
    .where('occurrenceId', '==', occurrenceId)
    .get()

  const board: Board = {
    occurrence: docToOccurrence(occurrenceSnapshot),
    registrations: registrationsSnapshot.docs.map(docToRegistration),
  }
  const { confirmed, waitlist } = rosterOf(board)

  const uids = [...new Set([...confirmed, ...waitlist].map((r) => r.patientUid))]
  const patients = new Map<string, { firstName: string; serviceId: string }>()
  await Promise.all(
    uids.map(async (uid) => {
      const snapshot = await database.collection(COLLECTIONS.patients).doc(uid).get()
      if (snapshot.exists) patients.set(uid, snapshot.data() as { firstName: string; serviceId: string })
    }),
  )

  const line = (r: Registration, status: 'confirmed' | 'waitlist', position: number | null): RosterLine => ({
    patientUid: r.patientUid,
    firstName: patients.get(r.patientUid)?.firstName ?? 'Prénom inconnu',
    serviceId: patients.get(r.patientUid)?.serviceId ?? null,
    status,
    position,
  })

  return [
    ...confirmed.map((r) => line(r, 'confirmed', null)),
    ...waitlist.map((r, index) => line(r, 'waitlist', index + 1)),
  ]
}
