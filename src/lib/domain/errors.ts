/**
 * Traduire une panne en phrase utile.
 *
 * Une fonction appelable injoignable renvoie « internal », que le navigateur affiche tel
 * quel : « internal [0] ». Ce message ne dit rien à personne, et surtout pas quoi faire —
 * or la cause la plus fréquente, de loin, est que l'appareil n'a plus de réseau. Un
 * soignant devant cet écran doit lire « vérifiez la connexion », pas un mot anglais.
 *
 * Les fonctions du projet renvoient déjà leurs propres messages en français : ceux-là
 * passent intacts. On ne remplace que ce qui n'apprend rien.
 */

/** Ce qui ne veut rien dire pour un humain, et qu'il faut donc traduire. */
const OPAQUES = [/^internal\b/i, /^unavailable\b/i, /^deadline[- ]exceeded\b/i, /^unknown\b/i]

/**
 * Un morceau de l'application n'a pas pu être téléchargé.
 *
 * L'application est découpée : l'espace soignant, la démonstration, la couche de données
 * ne sont demandés au serveur qu'au moment où l'on s'en sert. Si cette demande échoue —
 * réseau coupé à cette seconde-là, ou publication qui vient de remplacer les fichiers
 * pendant qu'un onglet restait ouvert, ce qui arrive à chaque mise en ligne — le
 * navigateur **retient l'échec**. Redemander le même morceau ne repart pas sur le
 * réseau : il rend la même erreur, à l'instant. Vérifié dans un navigateur : une seule
 * requête part, quel que soit le nombre d'essais.
 *
 * Dire « réessayez » serait donc une promesse en l'air. Seul un rechargement de la page
 * remet le compteur à zéro, et c'est ce qu'il faut demander.
 *
 * Les formulations varient d'un navigateur à l'autre : Chrome et Firefox parlent de
 * « dynamically imported module », Safari de « module script ».
 */
const FRAGMENT_MANQUANT = [
  /dynamically imported module/i,
  /importing a module script failed/i,
  /error loading dynamically imported module/i,
  /failed to fetch dynamically/i,
  /unable to preload/i,
]

export const RECHARGER =
  "Une partie de l'application n'a pas pu se charger. Rechargez la page, puis réessayez."

/** Faut-il recharger la page pour s'en sortir ? Voir `FRAGMENT_MANQUANT`. */
export function needsReload(raw: string): boolean {
  return FRAGMENT_MANQUANT.some((forme) => forme.test(raw))
}

export const HORS_LIGNE =
  "Votre appareil n'est pas connecté à Internet. Vérifiez la connexion, puis réessayez."

export const PANNE =
  "L'opération n'a pas abouti. Réessayez dans un instant ; si cela recommence, prévenez la personne qui a installé l'application."

/**
 * `enLigne` est passé plutôt que lu ici : le domaine ne connaît ni `navigator`, ni le
 * navigateur. C'est l'adapter qui sait.
 */
export function friendlyError(raw: string, enLigne: boolean): string {
  /*
    Le fragment manquant passe avant tout, y compris avant « hors ligne ».

    Le réseau est peut-être revenu depuis ; cela ne changera rien, parce que le navigateur
    a retenu l'échec. Lui dire de vérifier sa connexion l'enverrait tourner en rond.

    La reconnaissance se fait sur le message **brut** : la découpe sur le deux-points ne
    laissait que l'adresse du fichier, et c'est précisément ce qu'on lisait à l'écran —
    « ⚠️ https://…/assets/staffRepository-58sL4eMn.js ».
  */
  if (needsReload(raw)) return RECHARGER
  const message = raw.replace(/^.*?:\s*/, '').trim()
  if (!enLigne) return HORS_LIGNE
  if (message === '' || OPAQUES.some((forme) => forme.test(message))) return PANNE
  return message
}
