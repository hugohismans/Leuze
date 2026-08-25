import { describe, expect, it } from 'vitest'
import { RETOUR_PAR_DEFAUT, backTarget } from './retour'

/**
 * Le bouton « Retour » ramène d'où l'on vient.
 *
 * Il menait toujours au calendrier. Depuis que les lignes de « Ma semaine » s'ouvrent,
 * cela voulait dire perdre sa semaine pour avoir simplement regardé une activité — et
 * refaire tout le chemin en se demandant ce qu'on avait fait de travers.
 */
describe('où ramène le bouton « Retour »', () => {
  it('ramène à sa semaine quand on en vient', () => {
    expect(backTarget('/ma-semaine')).toEqual({ to: '/ma-semaine', label: 'Retour à ma semaine' })
  })

  it('ramène à ses inscriptions quand on en vient', () => {
    expect(backTarget('/mes-inscriptions')).toEqual({
      to: '/mes-inscriptions',
      label: 'Retour à mes inscriptions',
    })
  })

  it('ramène au calendrier par défaut, et après un rechargement', () => {
    expect(backTarget('/')).toEqual(RETOUR_PAR_DEFAUT)
    expect(backTarget(null)).toEqual(RETOUR_PAR_DEFAUT)
    expect(RETOUR_PAR_DEFAUT.label).toBe('Retour au calendrier')
  })

  it('ne ramène jamais sur un écran qui n’aurait pas de sens', () => {
    /*
      Une liste fermée, et non l'adresse précédente quelle qu'elle soit : revenir sur
      l'écran du code, ou sur une fiche qu'on vient de quitter, laisserait quelqu'un
      tourner en rond. Le calendrier est le point de repère.
    */
    for (const ailleurs of ['/activite/atelier_20260825T1000', '/proposer', '/rendez-vous', '/n-importe-quoi']) {
      expect(backTarget(ailleurs)).toEqual(RETOUR_PAR_DEFAUT)
    }
  })

  it('annonce toujours où il mène, en toutes lettres', () => {
    for (const venu of ['/ma-semaine', '/mes-inscriptions', '/', null]) {
      expect(backTarget(venu).label.startsWith('Retour ')).toBe(true)
    }
  })
})
