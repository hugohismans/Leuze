import { describe, expect, it } from 'vitest'
import { byChronology, nextDate } from './activityOrder'
import type { Activity } from './types'

const AUJOURD_HUI = '2026-08-21' // un vendredi

const base: Omit<Activity, 'id' | 'title'> = {
  seriesId: 's',
  description: '',
  categoryId: 'creatif',
  locationId: 'atelier',
  audience: 'all',
  serviceIds: [],
  capacity: null,
  registrationRequired: false,
  waitlistEnabled: false,
  recurrence: null,
  isActive: true,
}

const ponctuelle = (id: string, title: string, date: string): Activity => ({
  ...base,
  id,
  title,
  singleStart: { date, time: '14:00', durationMin: 60 },
})

const chaqueSemaine = (
  id: string,
  title: string,
  jours: Activity['recurrence'] extends null ? never : number[],
  reste: Partial<NonNullable<Activity['recurrence']>> = {},
): Activity => ({
  ...base,
  id,
  title,
  recurrence: {
    freq: 'weekly',
    byWeekday: jours as NonNullable<Activity['recurrence']>['byWeekday'],
    startTime: '14:00',
    durationMin: 60,
    from: '2026-01-01',
    until: null,
    skipDates: [],
    ...reste,
  },
})

describe('la prochaine fois qu’une activité a lieu', () => {
  it('pour une activité ponctuelle, sa date', () => {
    expect(nextDate(ponctuelle('a', 'A', '2026-09-03'), AUJOURD_HUI)).toBe('2026-09-03')
  })

  it('aujourd’hui même, si c’est aujourd’hui', () => {
    expect(nextDate(chaqueSemaine('b', 'B', [5]), AUJOURD_HUI)).toBe('2026-08-21')
  })

  it('pour une activité hebdomadaire, le prochain jour qui tombe dans sa règle', () => {
    // Le 21 août 2026 est un vendredi : le prochain lundi est le 24.
    expect(nextDate(chaqueSemaine('c', 'C', [1]), AUJOURD_HUI)).toBe('2026-08-24')
  })

  it('saute les dates mises de côté', () => {
    const avecConge = chaqueSemaine('d', 'D', [1], { skipDates: ['2026-08-24'] })
    expect(nextDate(avecConge, AUJOURD_HUI)).toBe('2026-08-31')
  })

  it('ne va pas au-delà de la fin de la série', () => {
    expect(nextDate(chaqueSemaine('e', 'E', [1], { until: '2026-08-22' }), AUJOURD_HUI)).toBeNull()
  })

  it('part du début de la série quand elle n’a pas encore commencé', () => {
    const plusTard = chaqueSemaine('f', 'F', [1], { from: '2026-09-07' })
    expect(nextDate(plusTard, AUJOURD_HUI)).toBe('2026-09-07')
  })

  it('rend « null » quand il n’y a aucune date', () => {
    const sansDate: Activity = { ...base, id: 'g', title: 'G' }
    expect(nextDate(sansDate, AUJOURD_HUI)).toBeNull()
    expect(nextDate(chaqueSemaine('h', 'H', []), AUJOURD_HUI)).toBeNull()
  })
})

describe('l’ordre de la liste', () => {
  it('met ce qui vient d’abord, du plus proche au plus lointain', () => {
    const liste = [
      ponctuelle('c', 'Zumba', '2026-09-10'),
      ponctuelle('a', 'Aquarelle', '2026-08-25'),
      ponctuelle('b', 'Balade', '2026-08-22'),
    ]
    expect(byChronology(liste, AUJOURD_HUI).map((a) => a.title)).toEqual([
      'Balade',
      'Aquarelle',
      'Zumba',
    ])
  })

  it('range le passé après, du plus récent au plus ancien', () => {
    const liste = [
      ponctuelle('vieux', 'Vieux', '2026-06-01'),
      ponctuelle('hier', 'Hier', '2026-08-20'),
      ponctuelle('demain', 'Demain', '2026-08-22'),
    ]
    expect(byChronology(liste, AUJOURD_HUI).map((a) => a.title)).toEqual(['Demain', 'Hier', 'Vieux'])
  })

  it('ferme la marche avec ce qui n’a aucune date', () => {
    const sansDate: Activity = { ...base, id: 'x', title: 'Aaaa sans date' }
    const liste = [sansDate, ponctuelle('p', 'Zzz', '2026-06-01')]
    expect(byChronology(liste, AUJOURD_HUI).map((a) => a.title)).toEqual(['Zzz', 'Aaaa sans date'])
  })

  it('départage deux activités du même jour par leur titre', () => {
    const liste = [
      ponctuelle('b', 'Balade', '2026-08-25'),
      ponctuelle('a', 'Aquarelle', '2026-08-25'),
    ]
    expect(byChronology(liste, AUJOURD_HUI).map((a) => a.title)).toEqual(['Aquarelle', 'Balade'])
  })

  it('mêle les hebdomadaires aux ponctuelles, sans distinction', () => {
    const liste = [
      ponctuelle('p', 'Ponctuelle du 25', '2026-08-25'),
      chaqueSemaine('h', 'Chaque lundi', [1]), // le 24
    ]
    expect(byChronology(liste, AUJOURD_HUI).map((a) => a.title)).toEqual([
      'Chaque lundi',
      'Ponctuelle du 25',
    ])
  })

  it('ne modifie pas la liste reçue', () => {
    const liste = [ponctuelle('b', 'B', '2026-09-01'), ponctuelle('a', 'A', '2026-08-22')]
    byChronology(liste, AUJOURD_HUI)
    expect(liste[0]!.title).toBe('B')
  })
})
