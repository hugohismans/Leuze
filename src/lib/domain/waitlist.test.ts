import { describe, expect, it } from 'vitest'
import { makeOccurrence, makeRegistration } from './fixtures'
import { promote, recount, register, rosterOf, unregister, waitlistPosition, type Board } from './waitlist'

const now = new Date('2025-08-10T09:00:00Z')
const plusTard = (minutes: number) => new Date(now.getTime() + minutes * 60_000)

function emptyBoard(capacity: number | null = 2, overrides = {}): Board {
  return { occurrence: makeOccurrence({ capacity, ...overrides }), registrations: [] }
}

function inscrire(board: Board, uid: string, at: Date, by: 'patient' | 'staff' = 'patient'): Board {
  const outcome = register(board, uid, { now: at, registrationId: `reg-${uid}`, by })
  if (!outcome.ok) throw new Error(`inscription refusée : ${outcome.reason}`)
  return outcome.board
}

describe('inscription et capacité', () => {
  it('confirme tant qu’il reste de la place', () => {
    const board = inscrire(emptyBoard(2), 'a', now)
    expect(board.occurrence.confirmedCount).toBe(1)
    expect(board.occurrence.waitlistCount).toBe(0)
  })

  it('bascule en liste d’attente une fois la capacité atteinte', () => {
    let board = inscrire(emptyBoard(2), 'a', now)
    board = inscrire(board, 'b', plusTard(1))
    const outcome = register(board, 'c', { now: plusTard(2), registrationId: 'reg-c', by: 'patient' })
    expect(outcome.ok && outcome.status).toBe('waitlist')
    expect(outcome.ok && outcome.position).toBe(1)
    expect(outcome.ok && outcome.board.occurrence.confirmedCount).toBe(2)
  })

  it('n’attribue jamais deux fois la dernière place', () => {
    // Deux patients cliquent sur la dernière place : la seconde opération part
    // du plateau déjà mis à jour, exactement comme dans une transaction Firestore.
    let board = inscrire(emptyBoard(2), 'a', now)
    const premier = register(board, 'b', { now: plusTard(1), registrationId: 'reg-b', by: 'patient' })
    expect(premier.ok && premier.status).toBe('confirmed')
    const second = register(premier.ok ? premier.board : board, 'c', {
      now: plusTard(1),
      registrationId: 'reg-c',
      by: 'patient',
    })
    expect(second.ok && second.status).toBe('waitlist')
    expect(second.ok && second.board.occurrence.confirmedCount).toBe(2)
  })

  it('refuse la double inscription du même patient', () => {
    const board = inscrire(emptyBoard(5), 'a', now)
    const outcome = register(board, 'a', { now: plusTard(1), registrationId: 'reg-bis', by: 'patient' })
    expect(outcome).toEqual({ ok: false, reason: 'already-registered' })
  })

  it('refuse l’inscription sur une activité annulée', () => {
    const outcome = register(emptyBoard(5, { status: 'cancelled' }), 'a', {
      now,
      registrationId: 'reg-a',
      by: 'patient',
    })
    expect(outcome).toEqual({ ok: false, reason: 'cancelled' })
  })

  it('accepte sans limite quand la capacité est illimitée', () => {
    let board = emptyBoard(null)
    for (const uid of ['a', 'b', 'c', 'd', 'e']) board = inscrire(board, uid, now)
    expect(board.occurrence.confirmedCount).toBe(5)
    expect(board.occurrence.waitlistCount).toBe(0)
  })

  it('laisse le personnel inscrire quelqu’un sur une activité sans inscription obligatoire', () => {
    const board = emptyBoard(null, { registrationRequired: false })
    expect(register(board, 'a', { now, registrationId: 'r', by: 'patient' }).ok).toBe(false)
    expect(register(board, 'a', { now, registrationId: 'r', by: 'staff' }).ok).toBe(true)
  })
})

describe('liste d’attente', () => {
  it('respecte l’ordre d’arrivée', () => {
    let board = emptyBoard(1)
    board = inscrire(board, 'a', now)
    board = inscrire(board, 'b', plusTard(5))
    board = inscrire(board, 'c', plusTard(10))
    expect(waitlistPosition(board, 'b')).toBe(1)
    expect(waitlistPosition(board, 'c')).toBe(2)
    expect(waitlistPosition(board, 'a')).toBeNull()
  })

  it('promeut le premier en attente lors d’une désinscription', () => {
    let board = emptyBoard(1)
    board = inscrire(board, 'a', now)
    board = inscrire(board, 'b', plusTard(5))
    board = inscrire(board, 'c', plusTard(10))

    const outcome = unregister(board, 'a')
    expect(outcome.ok && outcome.promoted?.patientUid).toBe('b')
    expect(outcome.ok && outcome.board.occurrence.confirmedCount).toBe(1)
    expect(outcome.ok && outcome.board.occurrence.waitlistCount).toBe(1)
    expect(outcome.ok && waitlistPosition(outcome.board, 'c')).toBe(1)
  })

  it('ne promeut personne quand c’est un patient en attente qui se désiste', () => {
    let board = emptyBoard(1)
    board = inscrire(board, 'a', now)
    board = inscrire(board, 'b', plusTard(5))
    const outcome = unregister(board, 'b')
    expect(outcome.ok && outcome.promoted).toBeNull()
    expect(outcome.ok && outcome.board.occurrence.confirmedCount).toBe(1)
    expect(outcome.ok && outcome.board.occurrence.waitlistCount).toBe(0)
  })

  it('permet de se réinscrire après s’être désinscrit', () => {
    let board = inscrire(emptyBoard(2), 'a', now)
    const out = unregister(board, 'a')
    board = out.ok ? out.board : board
    expect(register(board, 'a', { now: plusTard(1), registrationId: 'reg-a2', by: 'patient' }).ok).toBe(true)
  })

  it('signale une désinscription sans inscription', () => {
    expect(unregister(emptyBoard(2), 'inconnu')).toEqual({ ok: false, reason: 'not-registered' })
  })

  it('permet au soignant de promouvoir manuellement', () => {
    let board = emptyBoard(1)
    board = inscrire(board, 'a', now)
    board = inscrire(board, 'b', plusTard(5))
    const result = promote(board, 'b')
    expect(result.ok).toBe(true)
    expect(result.board.occurrence.confirmedCount).toBe(2)
    expect(result.board.occurrence.waitlistCount).toBe(0)
  })

  it('donne au soignant une liste ordonnée', () => {
    let board = emptyBoard(1)
    board = inscrire(board, 'a', now)
    board = inscrire(board, 'c', plusTard(10))
    board = inscrire(board, 'b', plusTard(5))
    const roster = rosterOf(board)
    expect(roster.confirmed.map((r) => r.patientUid)).toEqual(['a'])
    expect(roster.waitlist.map((r) => r.patientUid)).toEqual(['b', 'c'])
  })

  it('garde les compteurs cohérents avec les inscriptions', () => {
    const board = recount({
      occurrence: makeOccurrence({ capacity: 3, confirmedCount: 99, waitlistCount: 99 }),
      registrations: [
        makeRegistration({ id: 'r1', patientUid: 'a', status: 'confirmed' }),
        makeRegistration({ id: 'r2', patientUid: 'b', status: 'waitlist' }),
        makeRegistration({ id: 'r3', patientUid: 'c', status: 'cancelled' }),
      ],
    })
    expect(board.occurrence.confirmedCount).toBe(1)
    expect(board.occurrence.waitlistCount).toBe(1)
  })
})
