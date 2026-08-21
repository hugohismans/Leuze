import { describe, expect, it } from 'vitest'
import { hourRange, weekGrid } from './weekGrid'
import type { WeekDay, WeekEntry } from './myWeek'

/** Heures données en heure locale de Bruxelles (été : UTC+2). */
const activite = (heure: string, fin: string): WeekEntry => ({
  kind: 'activity',
  start: new Date(`2026-09-01T${heure}:00+02:00`),
  end: new Date(`2026-09-01T${fin}:00+02:00`),
  title: 'Yoga',
  locationId: 'salle',
  categoryId: 'relaxation',
  cancelled: false,
  waiting: false,
})

const jour = (entries: WeekEntry[]): WeekDay => ({ date: '2026-09-01', entries })

describe('plage horaire de la feuille', () => {
  it('garde une amplitude de confort quand la semaine est creuse', () => {
    expect(hourRange([jour([])])).toEqual({ from: 9, to: 18 })
    expect(hourRange([jour([activite('14:00', '15:30')])])).toEqual({ from: 9, to: 18 })
  })

  it('s’élargit pour une activité matinale ou tardive, jamais ne se resserre', () => {
    expect(hourRange([jour([activite('07:30', '08:30')])])).toEqual({ from: 7, to: 18 })
    expect(hourRange([jour([activite('19:00', '20:30')])])).toEqual({ from: 9, to: 21 })
  })
})

describe('placement dans la grille', () => {
  it('place une activité au bon créneau, en demi-heures', () => {
    const grille = weekGrid([jour([activite('10:00', '11:30')])], { from: 9, to: 18 })
    const place = grille.days[0]!.placed[0]!
    // 9 h est le créneau 0 ; 10 h est donc le créneau 2, et 11 h 30 le créneau 5.
    expect(place.fromSlot).toBe(2)
    expect(place.toSlot).toBe(5)
    expect(grille.hours).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17])
    expect(grille.slotsPerHour).toBe(2)
  })

  it('garde visible une activité plus courte qu’un créneau', () => {
    const grille = weekGrid([jour([activite('10:00', '10:15')])], { from: 9, to: 18 })
    const place = grille.days[0]!.placed[0]!
    expect(place.toSlot).toBeGreaterThan(place.fromSlot)
  })

  it('met côte à côte deux choses qui se chevauchent', () => {
    const grille = weekGrid([jour([activite('10:00', '11:30'), activite('11:00', '12:00')])], {
      from: 9,
      to: 18,
    })
    const [a, b] = grille.days[0]!.placed
    expect(a!.lane).toBe(0)
    expect(b!.lane).toBe(1)
    expect(a!.lanes).toBe(2)
  })

  it('remet en pleine largeur ce qui ne se chevauche pas', () => {
    const grille = weekGrid([jour([activite('10:00', '11:00'), activite('14:00', '15:00')])], {
      from: 9,
      to: 18,
    })
    expect(grille.days[0]!.placed.map((p) => p.lane)).toEqual([0, 0])
    expect(grille.days[0]!.placed[0]!.lanes).toBe(1)
  })

  it('laisse les journées vides entièrement libres', () => {
    const grille = weekGrid([jour([])], { from: 9, to: 18 })
    expect(grille.days[0]!.placed).toEqual([])
  })
})
