import { describe, expect, it } from 'vitest'
import { makeOccurrence } from './fixtures'
import { groupByStartTime, programmeCount, weekProgramme } from './programme'

const occ = (id: string, localDate: string, heureUtc: string, overrides = {}) =>
  makeOccurrence({
    id,
    localDate,
    start: new Date(`${localDate}T${heureUtc}:00Z`),
    end: new Date(`${localDate}T${heureUtc}:00Z`),
    ...overrides,
  })

describe('regroupement par heure de début', () => {
  it('met deux activités simultanées dans le même groupe', () => {
    const groupes = groupByStartTime([
      occ('a', '2026-09-01', '12:00'),
      occ('b', '2026-09-01', '12:00'),
      occ('c', '2026-09-01', '14:00'),
    ])
    expect(groupes).toHaveLength(2)
    expect(groupes[0]?.occurrences.map((o) => o.id)).toEqual(['a', 'b'])
    expect(groupes[1]?.occurrences.map((o) => o.id)).toEqual(['c'])
  })

  it('classe les groupes par ordre chronologique, quelle que soit l’entrée', () => {
    const groupes = groupByStartTime([
      occ('tard', '2026-09-01', '16:00'),
      occ('tot', '2026-09-01', '07:00'),
      occ('midi', '2026-09-01', '11:00'),
    ])
    expect(groupes.map((g) => g.occurrences[0]?.id)).toEqual(['tot', 'midi', 'tard'])
  })
})

describe('programme de la semaine', () => {
  const jours = ['2026-08-31', '2026-09-01', '2026-09-02']
  const occurrences = [
    occ('ouverte', '2026-08-31', '12:00', { audienceKeys: ['all'] }),
    occ('mazurel', '2026-09-01', '12:00', { audienceKeys: ['le-mazurel'] }),
    occ('autre', '2026-09-01', '12:00', { audienceKeys: ['la-joncquerelle'] }),
  ]

  it('donne un jour par date, même vide', () => {
    const programme = weekProgramme(jours, occurrences)
    expect(programme.map((j) => j.date)).toEqual(jours)
    expect(programme[2]?.groups).toHaveLength(0)
  })

  it('signale les créneaux où deux activités se superposent', () => {
    const programme = weekProgramme(jours, occurrences)
    expect(programme[0]?.hasSimultaneous).toBe(false)
    expect(programme[1]?.hasSimultaneous).toBe(true)
  })

  it('restreint à un service : les communes plus les siennes', () => {
    const programme = weekProgramme(jours, occurrences, 'le-mazurel')
    expect(programmeCount(programme)).toBe(2)
    expect(programme[1]?.groups[0]?.occurrences.map((o) => o.id)).toEqual(['mazurel'])
    // Restreint à un service, il n'y a plus de superposition ce jour-là.
    expect(programme[1]?.hasSimultaneous).toBe(false)
  })

  it('compte les activités de la semaine', () => {
    expect(programmeCount(weekProgramme(jours, occurrences))).toBe(3)
    expect(programmeCount(weekProgramme(jours, []))).toBe(0)
  })
})
