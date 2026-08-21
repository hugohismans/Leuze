import { describe, expect, it } from 'vitest'
import { presenceOf } from './presence'
import { makeOccurrence } from './fixtures'

const seance = (debut: string, fin: string, titre: string, reste: Record<string, unknown> = {}) => ({
  occurrence: {
    ...makeOccurrence({ ...reste }),
    title: titre,
    start: new Date(debut),
    end: new Date(fin),
  },
  status: 'confirmed' as const,
})

const maintenant = new Date('2026-08-21T14:15:00Z')

describe('où en est une personne', () => {
  it('la dit en activité, et jusqu’à quand', () => {
    const etat = presenceOf([seance('2026-08-21T14:00:00Z', '2026-08-21T15:30:00Z', 'Relaxation')], maintenant)
    expect(etat.kind).toBe('busy')
    if (etat.kind === 'busy') {
      expect(etat.title).toBe('Relaxation')
      expect(etat.end.toISOString()).toBe('2026-08-21T15:30:00.000Z')
    }
  })

  it('la dit libre, avec ce qui vient ensuite', () => {
    const etat = presenceOf([seance('2026-08-21T16:00:00Z', '2026-08-21T17:00:00Z', 'Ping-pong')], maintenant)
    expect(etat.kind).toBe('free')
    if (etat.kind === 'free') expect(etat.next?.title).toBe('Ping-pong')
  })

  it('la dit libre, sans rien après, quand la journée est finie', () => {
    const etat = presenceOf([seance('2026-08-21T09:00:00Z', '2026-08-21T10:00:00Z', 'Marche')], maintenant)
    expect(etat).toEqual({ kind: 'free', next: null })
  })

  it('ne compte pas une liste d’attente : la personne n’y participe pas', () => {
    const ligne = { ...seance('2026-08-21T14:00:00Z', '2026-08-21T15:30:00Z', 'Relaxation'), status: 'waitlist' as const }
    expect(presenceOf([ligne], maintenant)).toEqual({ kind: 'free', next: null })
  })

  it('ne compte pas une séance annulée', () => {
    const ligne = seance('2026-08-21T14:00:00Z', '2026-08-21T15:30:00Z', 'Relaxation', { status: 'cancelled' })
    expect(presenceOf([ligne], maintenant)).toEqual({ kind: 'free', next: null })
  })

  it('choisit la plus proche quand plusieurs suivent', () => {
    const etat = presenceOf(
      [
        seance('2026-08-21T18:00:00Z', '2026-08-21T19:00:00Z', 'Tard'),
        seance('2026-08-21T16:00:00Z', '2026-08-21T17:00:00Z', 'Bientôt'),
      ],
      maintenant,
    )
    if (etat.kind === 'free') expect(etat.next?.title).toBe('Bientôt')
  })

  it('une séance qui vient de finir ne retient plus personne', () => {
    const etat = presenceOf([seance('2026-08-21T13:00:00Z', '2026-08-21T14:15:00Z', 'Atelier')], maintenant)
    expect(etat.kind).toBe('free')
  })
})
