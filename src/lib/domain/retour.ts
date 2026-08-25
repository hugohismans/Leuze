/**
 * Où le bouton « Retour » ramène, et ce qu'il annonce.
 *
 * Il menait toujours au calendrier. C'était juste tant qu'on n'ouvrait une activité que
 * depuis là — mais « Mes inscriptions » et, depuis peu, « Ma semaine » y mènent aussi, et
 * l'on se retrouvait alors sur le calendrier après avoir simplement regardé une fiche. Il
 * fallait refaire tout le chemin, en se demandant ce qu'on avait fait de travers.
 *
 * Le bouton reste à la même place, toujours, et c'est la règle du projet. Ce qui change
 * est sa destination et sa phrase — et elles disent la même chose : on revient d'où l'on
 * vient.
 *
 * Une liste fermée, et non l'adresse précédente quelle qu'elle soit. Revenir sur l'écran
 * du code, ou sur une fiche qu'on a quittée, n'aurait aucun sens ; le calendrier est le
 * point de repère, et il reste la réponse par défaut.
 */
export type BackTarget = { to: string; label: string }

const CONNUS: Record<string, BackTarget> = {
  '/ma-semaine': { to: '/ma-semaine', label: 'Retour à ma semaine' },
  '/mes-inscriptions': { to: '/mes-inscriptions', label: 'Retour à mes inscriptions' },
}

export const RETOUR_PAR_DEFAUT: BackTarget = { to: '/', label: 'Retour au calendrier' }

export function backTarget(previousPath: string | null): BackTarget {
  if (previousPath === null) return RETOUR_PAR_DEFAUT
  return CONNUS[previousPath] ?? RETOUR_PAR_DEFAUT
}
