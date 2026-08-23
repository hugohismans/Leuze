import { describe, expect, it } from 'vitest'
import { pastScheduled, upcomingScheduled } from './appointments'

type Rdv = { id: string; status: string; start?: Date; end?: Date }
const maintenant = new Date('2026-08-23T12:00:00Z')
const rdv = (id: string, debut: string, minutes = 30, status = 'scheduled'): Rdv => ({
  id,
  status,
  start: new Date(debut),
  end: new Date(new Date(debut).getTime() + minutes * 60_000),
})

describe('pastScheduled', () => {
  it('ne garde que ce qui est déjà terminé', () => {
    const liste = [rdv('hier', '2026-08-22T10:00:00Z'), rdv('demain', '2026-08-24T10:00:00Z')]
    expect(pastScheduled(liste, maintenant).map((r) => r.id)).toEqual(['hier'])
  })

  it('met le plus récent en tête', () => {
    const liste = [
      rdv('ancien', '2026-08-10T10:00:00Z'),
      rdv('recent', '2026-08-22T10:00:00Z'),
      rdv('moyen', '2026-08-18T10:00:00Z'),
    ]
    expect(pastScheduled(liste, maintenant).map((r) => r.id)).toEqual(['recent', 'moyen', 'ancien'])
  })

  /* Un rendez-vous en cours n'est pas passé : on y est encore. */
  it("laisse à venir un rendez-vous commencé mais pas fini", () => {
    const enCours = rdv('en-cours', '2026-08-23T11:45:00Z', 30)
    expect(pastScheduled([enCours], maintenant)).toEqual([])
    expect(upcomingScheduled([enCours], maintenant).map((r) => r.id)).toEqual(['en-cours'])
  })

  it('ignore ce qui est annulé', () => {
    const annule = rdv('annule', '2026-08-22T10:00:00Z', 30, 'cancelled')
    expect(pastScheduled([annule], maintenant)).toEqual([])
  })

  it('ignore une demande sans date', () => {
    expect(pastScheduled([{ id: 'demande', status: 'scheduled' }], maintenant)).toEqual([])
  })

  /* Les deux listes se partagent exactement les rendez-vous fixés, sans doublon ni oubli. */
  it('partage les rendez-vous fixés avec « à venir », sans recouvrement', () => {
    const liste = [
      rdv('hier', '2026-08-22T10:00:00Z'),
      rdv('en-cours', '2026-08-23T11:45:00Z'),
      rdv('demain', '2026-08-24T10:00:00Z'),
      rdv('annule', '2026-08-21T10:00:00Z', 30, 'cancelled'),
    ]
    const passes = pastScheduled(liste, maintenant).map((r) => r.id)
    const aVenir = upcomingScheduled(liste, maintenant).map((r) => r.id)
    expect(passes.concat(aVenir).sort()).toEqual(['demain', 'en-cours', 'hier'])
    expect(passes.filter((id) => aVenir.includes(id))).toEqual([])
  })
})
