import { describe, expect, it } from 'vitest'
import {
  MAX_LEAVE_DAYS,
  daysCovered,
  isOnLeave,
  isValidLeave,
  leaveClashes,
  leaveRefusal,
  leavesOverlapping,
  normalizeLeaves,
  withoutLeave,
} from './leave'

describe('un congé bien formé', () => {
  it('accepte deux dates dans le bon ordre', () => {
    expect(isValidLeave({ from: '2026-08-24', to: '2026-08-28' })).toBe(true)
    // Un seul jour est un congé comme un autre.
    expect(isValidLeave({ from: '2026-08-24', to: '2026-08-24' })).toBe(true)
  })

  it('refuse un dernier jour avant le premier', () => {
    expect(isValidLeave({ from: '2026-08-28', to: '2026-08-24' })).toBe(false)
    expect(leaveRefusal({ from: '2026-08-28', to: '2026-08-24' })).toContain('avant le premier')
  })

  it('refuse une date illisible, en disant quoi faire', () => {
    expect(leaveRefusal({ from: '', to: '2026-08-24' })).toContain('premier et un dernier jour')
  })

  it('refuse un congé de plus d’un an — c’est une faute de frappe, pas un congé', () => {
    expect(leaveRefusal({ from: '2026-08-24', to: '2206-08-24' })).toContain("plus d'un an")
  })

  it('ne refuse rien de légitime', () => {
    expect(leaveRefusal({ from: '2026-08-24', to: '2026-09-07' })).toBeNull()
  })
})

describe('le nombre de jours couverts', () => {
  it('compte les deux bornes', () => {
    expect(daysCovered({ from: '2026-08-24', to: '2026-08-24' })).toBe(1)
    expect(daysCovered({ from: '2026-08-24', to: '2026-08-28' })).toBe(5)
  })

  it('ne perd pas de journée au passage à l’heure d’hiver', () => {
    // Le dernier dimanche d'octobre dure 25 heures : une soustraction de dates y perd
    // une journée une fois par an.
    expect(daysCovered({ from: '2026-10-24', to: '2026-10-26' })).toBe(3)
  })

  it('ne compte pas indéfiniment un congé absurde', () => {
    expect(daysCovered({ from: '2026-01-01', to: '2500-01-01' })).toBeGreaterThan(MAX_LEAVE_DAYS)
  })
})

describe('la liste des congés', () => {
  it('trie et fond ce qui se chevauche', () => {
    const fondus = normalizeLeaves([
      { from: '2026-09-04', to: '2026-09-08' },
      { from: '2026-08-24', to: '2026-08-28' },
      { from: '2026-08-27', to: '2026-09-02' },
    ])
    expect(fondus).toEqual([
      { from: '2026-08-24', to: '2026-09-02' },
      { from: '2026-09-04', to: '2026-09-08' },
    ])
  })

  it('fond aussi deux congés bout à bout', () => {
    // « jusqu'au 28 » puis « à partir du 29 » : une seule absence, du 24 au 31.
    expect(
      normalizeLeaves([
        { from: '2026-08-24', to: '2026-08-28' },
        { from: '2026-08-29', to: '2026-08-31' },
      ]),
    ).toEqual([{ from: '2026-08-24', to: '2026-08-31' }])
  })

  it('écarte les congés mal formés au lieu de les faire tomber', () => {
    expect(normalizeLeaves([{ from: '2026-08-28', to: '2026-08-24' }])).toEqual([])
  })

  it('ne modifie pas la liste qu’on lui donne', () => {
    const source = [{ from: '2026-08-24', to: '2026-08-28' }]
    normalizeLeaves(source)
    expect(source).toEqual([{ from: '2026-08-24', to: '2026-08-28' }])
  })
})

describe('être absent un jour donné', () => {
  const conges = [{ from: '2026-08-24', to: '2026-08-28' }]

  it('inclut les deux bornes', () => {
    expect(isOnLeave(conges, '2026-08-24')).toBe(true)
    expect(isOnLeave(conges, '2026-08-28')).toBe(true)
    expect(isOnLeave(conges, '2026-08-26')).toBe(true)
  })

  it('exclut la veille et le lendemain', () => {
    expect(isOnLeave(conges, '2026-08-23')).toBe(false)
    expect(isOnLeave(conges, '2026-08-29')).toBe(false)
  })

  it('sans congé, personne n’est absent', () => {
    expect(isOnLeave([], '2026-08-24')).toBe(false)
  })
})

describe('les congés qui touchent une période', () => {
  const conges = [
    { from: '2026-08-24', to: '2026-08-28' },
    { from: '2026-10-01', to: '2026-10-05' },
  ]

  it('trouve un chevauchement même partiel', () => {
    expect(leavesOverlapping(conges, '2026-08-27', '2026-09-10')).toHaveLength(1)
    expect(leavesOverlapping(conges, '2026-08-01', '2026-12-31')).toHaveLength(2)
  })

  it('ne trouve rien à côté', () => {
    expect(leavesOverlapping(conges, '2026-08-29', '2026-09-30')).toEqual([])
  })
})

describe('retirer un congé', () => {
  it('se fait par ses deux bornes, jamais par son rang', () => {
    // La liste est fondue et retriée à chaque lecture : un rang désignerait le mauvais
    // congé dès qu'un autre est ajouté.
    const conges = [
      { from: '2026-08-24', to: '2026-08-28' },
      { from: '2026-10-01', to: '2026-10-05' },
    ]
    expect(withoutLeave(conges, { from: '2026-08-24', to: '2026-08-28' })).toEqual([
      { from: '2026-10-01', to: '2026-10-05' },
    ])
  })

  it('ne retire rien quand les bornes ne correspondent pas', () => {
    const conges = [{ from: '2026-08-24', to: '2026-08-28' }]
    expect(withoutLeave(conges, { from: '2026-08-24', to: '2026-08-27' })).toEqual(conges)
  })
})

/**
 * Poser une activité sur un congé déjà déclaré.
 *
 * L'inverse du cas précédent, et il s'est posé aussitôt : on peut déclarer un congé
 * après avoir posé un atelier, mais on peut tout aussi bien poser un atelier après avoir
 * déclaré un congé. Le second sens ne disait rien du tout.
 */
describe('les jours de congé qu’une activité viendrait heurter', () => {
  const conges = [{ from: '2026-08-24', to: '2026-08-28' }] // lundi 24 → vendredi 28
  const jourIso = (d: string): number => {
    const [a, m, j] = d.split('-').map(Number)
    const iso = new Date(Date.UTC(a!, m! - 1, j!)).getUTCDay()
    return iso === 0 ? 7 : iso
  }

  it('trouve la date d’une activité ponctuelle', () => {
    expect(leaveClashes(conges, { dates: ['2026-08-26'] }, jourIso)).toEqual(['2026-08-26'])
  })

  it('ne trouve rien à côté', () => {
    expect(leaveClashes(conges, { dates: ['2026-08-31'] }, jourIso)).toEqual([])
  })

  it('trouve les jours d’une activité hebdomadaire qui tombent dedans', () => {
    // Mardi et jeudi : le 25 et le 27 tombent dans le congé.
    expect(leaveClashes(conges, { weekdays: [2, 4] }, jourIso)).toEqual([
      '2026-08-25',
      '2026-08-27',
    ])
  })

  it('ne trouve rien pour un jour de semaine hors du congé', () => {
    // Le congé va du lundi au vendredi : le dimanche n'y tombe jamais.
    expect(leaveClashes(conges, { weekdays: [7] }, jourIso)).toEqual([])
  })

  it('rend des dates triées et sans doublon', () => {
    const deux = [
      { from: '2026-08-24', to: '2026-08-26' },
      { from: '2026-08-25', to: '2026-08-28' },
    ]
    expect(leaveClashes(deux, { weekdays: [2], dates: ['2026-08-25'] }, jourIso)).toEqual([
      '2026-08-25',
    ])
  })

  it('ne dit rien sans congé, ni sans calendrier', () => {
    expect(leaveClashes([], { weekdays: [1, 2, 3, 4, 5] }, jourIso)).toEqual([])
    expect(leaveClashes(conges, {}, jourIso)).toEqual([])
  })
})
