import { describe, expect, it } from 'vitest'
import { countsOf, undoToggle, withToggled, type RosterEntry } from './roster'

const ligne = (patientUid: string, status: 'confirmed' | 'waitlist' = 'confirmed'): RosterEntry => ({
  patientUid,
  status,
})

const prenoms = (lines: RosterEntry[]): string[] => lines.map((l) => l.patientUid).sort()

/** L'ordre tel qu'il est à l'écran, sans le trier : c'est justement lui qu'on vérifie. */
const ordre = (lines: RosterEntry[]): string[] => lines.map((l) => l.patientUid)

describe('le clic, affiché sans attendre le serveur', () => {
  it('ajoute la personne qui n’était pas inscrite', () => {
    expect(prenoms(withToggled([ligne('a')], ligne('b'), false))).toEqual(['a', 'b'])
  })

  it('retire la personne qui l’était', () => {
    expect(prenoms(withToggled([ligne('a'), ligne('b')], ligne('b'), true))).toEqual(['a'])
  })

  it('ne fait jamais figurer quelqu’un deux fois', () => {
    expect(prenoms(withToggled([ligne('a')], ligne('a'), false))).toEqual(['a'])
  })

  it('ne fait changer personne de rang', () => {
    /*
      Le défaut vu sur la feuille d'appel : cocher « Présent » sur Amandine la faisait
      descendre en bas de la liste, et la relecture du serveur la remontait une
      demi-seconde plus tard. Deux prénoms semblaient s'échanger de place.
    */
    const liste = [ligne('bernard'), ligne('amandine'), ligne('camille')]
    const apres = withToggled(liste, { ...ligne('amandine'), status: 'waitlist' }, false)
    expect(ordre(apres)).toEqual(['bernard', 'amandine', 'camille'])
    expect(apres[1]?.status).toBe('waitlist')
  })

  it('met la personne réellement nouvelle à la fin', () => {
    const apres = withToggled([ligne('bernard'), ligne('camille')], ligne('hugo'), false)
    expect(ordre(apres)).toEqual(['bernard', 'camille', 'hugo'])
  })
})

describe('le refus arrivé en retard', () => {
  it('remet la personne que le serveur a refusé de retirer', () => {
    const apres = undoToggle([ligne('b')], 'a', ligne('a'))
    expect(prenoms(apres)).toEqual(['a', 'b'])
  })

  it('retire la personne que le serveur a refusé d’inscrire', () => {
    expect(prenoms(undoToggle([ligne('a'), ligne('b')], 'b', null))).toEqual(['a'])
  })

  it('remet la ligne à sa place, sans déplacer personne', () => {
    const liste = [ligne('bernard'), { ...ligne('amandine'), status: 'waitlist' as const }, ligne('camille')]
    const apres = undoToggle(liste, 'amandine', ligne('amandine'))
    expect(ordre(apres)).toEqual(['bernard', 'amandine', 'camille'])
    expect(apres[1]?.status).toBe('confirmed')
  })

  it('remet à son rang quelqu’un qui avait été retiré', () => {
    const liste = [ligne('bernard'), ligne('camille')]
    expect(ordre(undoToggle(liste, 'amandine', ligne('amandine'), 1))).toEqual([
      'bernard',
      'amandine',
      'camille',
    ])
  })

  it('le met à la fin quand on ne sait plus où il était', () => {
    const liste = [ligne('bernard'), ligne('camille')]
    expect(ordre(undoToggle(liste, 'amandine', ligne('amandine')))).toEqual([
      'bernard',
      'camille',
      'amandine',
    ])
  })

  it('ne défait pas les clics qu’il n’a pas vus', () => {
    /*
      C'est le défaut qui se voyait en réunion. On clique Amandine, Bernard, Camille,
      Hugo ; la réponse d'Amandine revient en dernier et refuse. Remettre la liste
      « telle qu'elle était » avant Amandine effaçait les trois autres.
    */
    const liste = [ligne('amandine'), ligne('bernard'), ligne('camille'), ligne('hugo')]
    const apres = undoToggle(liste, 'amandine', null)
    expect(prenoms(apres)).toEqual(['bernard', 'camille', 'hugo'])
  })
})

describe('le nombre affiché', () => {
  it('se compte sur la liste, jamais ailleurs', () => {
    const liste = [ligne('a'), ligne('b'), ligne('c', 'waitlist')]
    expect(countsOf(liste)).toEqual({ confirmedCount: 2, waitlistCount: 1 })
  })

  it('vaut zéro pour une liste vide', () => {
    expect(countsOf([])).toEqual({ confirmedCount: 0, waitlistCount: 0 })
  })

  it('suit le clic qu’on vient de faire', () => {
    // Quatre prénoms cochés à l'écran, donc quatre — et non trois.
    const liste = withToggled([ligne('a'), ligne('b'), ligne('c')], ligne('hugo'), false)
    expect(countsOf(liste).confirmedCount).toBe(4)
  })
})
