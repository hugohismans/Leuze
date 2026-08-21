import { describe, expect, it } from 'vitest'
import { countsOf, undoToggle, withToggled, type RosterEntry } from './roster'

const ligne = (patientUid: string, status: 'confirmed' | 'waitlist' = 'confirmed'): RosterEntry => ({
  patientUid,
  status,
})

const prenoms = (lines: RosterEntry[]): string[] => lines.map((l) => l.patientUid).sort()

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
})

describe('le refus arrivé en retard', () => {
  it('remet la personne que le serveur a refusé de retirer', () => {
    const apres = undoToggle([ligne('b')], 'a', ligne('a'))
    expect(prenoms(apres)).toEqual(['a', 'b'])
  })

  it('retire la personne que le serveur a refusé d’inscrire', () => {
    expect(prenoms(undoToggle([ligne('a'), ligne('b')], 'b', null))).toEqual(['a'])
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
