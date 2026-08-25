import { describe, expect, it } from 'vitest'
import {
  MAX_LEAVE_DAYS,
  daysCovered,
  isOnLeave,
  isValidLeave,
  leaveClashes,
  leaveConflictSummary,
  leaveRefusal,
  leaveWarning,
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

describe('un congé posé sur le passé', () => {
  it('est refusé quand il est entièrement passé : il ne réécrit rien', () => {
    const refus = leaveRefusal({ from: '2026-08-10', to: '2026-08-21' }, '2026-08-25')
    expect(refus).not.toBeNull()
    expect(refus).toContain('entièrement passé')
  })

  it('reste accepté quand il a commencé hier et court encore', () => {
    // On tombe malade sans prévenir : c'est le lendemain qu'on le déclare.
    expect(leaveRefusal({ from: '2026-08-24', to: '2026-08-28' }, '2026-08-25')).toBeNull()
  })

  it('accepte un congé qui se termine aujourd’hui', () => {
    expect(leaveRefusal({ from: '2026-08-20', to: '2026-08-25' }, '2026-08-25')).toBeNull()
  })

  it('ne juge rien du passé quand on ne lui dit pas quel jour on est', () => {
    expect(leaveRefusal({ from: '2020-01-01', to: '2020-01-05' })).toBeNull()
  })
})

describe('les séances qu’un congé viendrait heurter', () => {
  const conges = [{ from: '2026-08-20', to: '2026-08-30' }]
  const jourDe = (localDate: string): number => {
    const [a, m, j] = localDate.split('-').map(Number)
    return ((new Date(Date.UTC(a!, m! - 1, j!)).getUTCDay() + 6) % 7) + 1
  }

  it('écarte celles qui ont déjà eu lieu', () => {
    const heurtees = leaveClashes(conges, { dates: ['2026-08-21', '2026-08-27'] }, jourDe, '2026-08-25')
    expect(heurtees).toEqual(['2026-08-27'])
  })

  it('garde celles d’aujourd’hui : la séance de cet après-midi n’a pas encore eu lieu', () => {
    const heurtees = leaveClashes(conges, { dates: ['2026-08-25'] }, jourDe, '2026-08-25')
    expect(heurtees).toEqual(['2026-08-25'])
  })

  it('écarte aussi le passé d’une récurrence hebdomadaire', () => {
    // Jeudi : le 20 et le 27 août 2026 tombent tous deux dans le congé.
    const heurtees = leaveClashes(conges, { weekdays: [4] }, jourDe, '2026-08-25')
    expect(heurtees).toEqual(['2026-08-27'])
  })

  it('garde tout quand on ne lui dit pas quel jour on est', () => {
    const heurtees = leaveClashes(conges, { weekdays: [4] }, jourDe)
    expect(heurtees).toEqual(['2026-08-20', '2026-08-27'])
  })
})

describe('l’avertissement de congé au moment de fixer un rendez-vous', () => {
  const conges = [{ from: '2026-08-31', to: '2026-09-04' }]

  it('prévient, en nommant la personne', () => {
    const texte = leaveWarning(conges, '2026-09-01', 'Docteur Lemaire')
    expect(texte).toContain('Docteur Lemaire')
    expect(texte).toContain('en congé')
    // Il avertit, il n'interdit pas : une urgence se cale où l'on veut.
    expect(texte).toContain('Vous pouvez tout de même')
  })

  it('se tait les autres jours', () => {
    expect(leaveWarning(conges, '2026-09-05', 'Docteur Lemaire')).toBeNull()
    expect(leaveWarning([], '2026-09-01', 'Docteur Lemaire')).toBeNull()
  })
})

/**
 * Une phrase qui parlait de vous à la troisième personne.
 *
 * Elle vivait en trois exemplaires — le serveur, la démonstration, le titre de la liste
 * juste en dessous — et ils ne disaient pas la même chose : le titre savait écrire
 * « Séances que vous animez » sur son propre congé, la phrase du dessus restait à
 * « animées par cette personne ». On lisait, l'un sous l'autre, deux façons de désigner
 * le même être — et une consigne qui demandait de se prévenir soi-même.
 */
describe('ce qu’un congé bouscule, en une phrase', () => {
  it('compte les séances et les rendez-vous, dans cet ordre', () => {
    expect(leaveConflictSummary(1, 3, { name: 'Claire' })).toBe(
      'Ce congé tombe sur 3 séances qu’anime Claire et un rendez-vous fixé.',
    )
  })

  it('accorde le singulier', () => {
    expect(leaveConflictSummary(0, 1)).toBe('Ce congé tombe sur une séance animée par cette personne.')
    expect(leaveConflictSummary(2, 0)).toBe('Ce congé tombe sur 2 rendez-vous fixés.')
  })

  it('dit « vous » sur son propre congé', () => {
    const sien = leaveConflictSummary(1, 4, { name: 'Claire', isSelf: true })
    expect(sien).toContain('4 séances que vous animez')
    expect(sien).not.toContain('Claire')
    expect(sien).not.toContain('cette personne')
  })

  it('dit « une séance que vous animez » au singulier aussi', () => {
    expect(leaveConflictSummary(0, 1, { isSelf: true })).toBe(
      'Ce congé tombe sur une séance que vous animez.',
    )
  })
})

/**
 * L'avertissement posé sur un rendez-vous qui tombe un jour de congé.
 *
 * Il était écrit à la troisième personne même sur son propre agenda, juste sous celui
 * des plages qui, lui, avait appris à dire « vous » — et il demandait de prévenir la
 * personne concernée, c'est-à-dire soi-même.
 */
describe('l’avertissement de congé, selon qui le lit', () => {
  const conges = [{ from: '2026-08-24', to: '2026-08-28' }]

  it('se tait en dehors du congé', () => {
    expect(leaveWarning(conges, '2026-08-31', 'Claire')).toBeNull()
  })

  it('nomme la personne quand ce n’est pas soi', () => {
    const avis = leaveWarning(conges, '2026-08-25', 'Claire')!
    expect(avis).toContain('Claire est en congé')
    expect(avis).toContain('prévenez la personne concernée')
  })

  it('s’adresse à vous sur votre propre congé, sans vous demander de vous prévenir', () => {
    const avis = leaveWarning(conges, '2026-08-25', 'Claire', true)!
    expect(avis).toContain('Vous êtes en congé')
    expect(avis).not.toContain('Claire')
    expect(avis).not.toContain('la personne concernée')
  })
})
