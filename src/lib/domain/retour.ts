/**
 * Où le bouton « Retour » ramène, et ce qu'il annonce.
 *
 * Il menait toujours au calendrier. C'était juste tant qu'on n'ouvrait une activité que
 * depuis là — mais « Mes inscriptions » et « Ma semaine » y mènent aussi, et l'on se
 * retrouvait alors sur le calendrier après avoir simplement regardé une fiche. Il fallait
 * refaire tout le chemin, en se demandant ce qu'on avait fait de travers.
 *
 * La correction d'alors regardait l'écran précédent, quel qu'il soit. Et cela enfermait.
 *
 * **Le piège, constaté en service.** « Mes inscriptions », puis « Ma semaine », puis
 * « Mes inscriptions » : chacun des deux écrans devenait le retour de l'autre, et le
 * bouton faisait l'aller-retour entre eux sans fin. Le calendrier — le seul point de
 * repère de l'application — n'était plus atteignable autrement qu'en fermant la page.
 * Pour quelqu'un qui apprend, c'est pire qu'un bouton absent : le bouton répond, et
 * pourtant on ne sort pas.
 *
 * **Ce qui remplace l'historique : une hiérarchie.** Chaque écran a un parent fixe, et
 * tous les chemins remontent au calendrier. Un arbre ne boucle jamais — c'est une
 * propriété de sa forme, pas une précaution qu'on pourrait oublier d'écrire. Le test
 * suivant remonte la chaîne depuis chaque écran et vérifie qu'elle aboutit.
 *
 * **Ce qui garde le bénéfice d'origine.** Deux écrans seulement regardent d'où l'on
 * vient, et toujours vers un parent plus proche de la racine :
 *
 * - la **fiche d'une activité**, ouverte depuis le calendrier, depuis sa semaine ou
 *   depuis ses inscriptions — c'était le cas qui avait motivé le changement ;
 * - la **demande de rendez-vous**, qu'on atteint depuis le calendrier comme depuis ses
 *   inscriptions.
 *
 * Les écrans de premier niveau, eux, ramènent au calendrier sans se poser de question.
 * C'est ce qui casse la boucle : « Ma semaine » ne renvoie plus vers « Mes inscriptions ».
 *
 * Le bouton reste à la même place, toujours, et c'est la règle du projet. Seules sa
 * destination et sa phrase changent — et elles disent la même chose.
 */
export type BackTarget = { to: string; label: string }

export const RETOUR_PAR_DEFAUT: BackTarget = { to: '/', label: 'Retour au calendrier' }

const VERS_MA_SEMAINE: BackTarget = { to: '/ma-semaine', label: 'Retour à ma semaine' }
const VERS_MES_INSCRIPTIONS: BackTarget = {
  to: '/mes-inscriptions',
  label: 'Retour à mes inscriptions',
}

/**
 * Le parent de chaque écran de premier niveau : le calendrier, et rien d'autre.
 *
 * Écrit en toutes lettres plutôt que déduit : ajouter un écran ici oblige à répondre à
 * la question « d'où vient-on ? », et c'est la bonne question à se poser.
 */
const PREMIER_NIVEAU = new Set(['/ma-semaine', '/mes-inscriptions', '/proposer'])

/** Les écrans depuis lesquels on peut ouvrir la fiche d'une activité. */
const OUVREURS_DE_FICHE: Record<string, BackTarget> = {
  '/ma-semaine': VERS_MA_SEMAINE,
  '/mes-inscriptions': VERS_MES_INSCRIPTIONS,
}

/**
 * Où ramène le bouton, depuis l'écran courant, sachant d'où l'on vient.
 *
 * `previousPath` n'est consulté que là où il ne peut pas enfermer : vers un parent, et
 * jamais vers un frère.
 */
export function backTarget(currentPath: string, previousPath: string | null): BackTarget {
  if (PREMIER_NIVEAU.has(currentPath)) return RETOUR_PAR_DEFAUT

  /*
    La demande de rendez-vous s'atteint des deux côtés.

    Depuis le calendrier — le bouton y a été posé parce que les personnes en test ne
    pensaient pas à passer par leurs inscriptions — et depuis « Mes inscriptions ». Les
    deux ramènent plus près de la racine : il n'y a pas de boucle possible.
  */
  if (currentPath === '/rendez-vous') {
    return previousPath === '/mes-inscriptions' ? VERS_MES_INSCRIPTIONS : RETOUR_PAR_DEFAUT
  }

  if (currentPath.startsWith('/activite/')) {
    return (previousPath === null ? undefined : OUVREURS_DE_FICHE[previousPath]) ?? RETOUR_PAR_DEFAUT
  }

  return RETOUR_PAR_DEFAUT
}
