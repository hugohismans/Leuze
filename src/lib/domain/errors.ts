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

export const HORS_LIGNE =
  "Votre appareil n'est pas connecté à Internet. Vérifiez la connexion, puis réessayez."

export const PANNE =
  "L'opération n'a pas abouti. Réessayez dans un instant ; si cela recommence, prévenez la personne qui a installé l'application."

/**
 * `enLigne` est passé plutôt que lu ici : le domaine ne connaît ni `navigator`, ni le
 * navigateur. C'est l'adapter qui sait.
 */
export function friendlyError(raw: string, enLigne: boolean): string {
  const message = raw.replace(/^.*?:\s*/, '').trim()
  if (!enLigne) return HORS_LIGNE
  if (message === '' || OPAQUES.some((forme) => forme.test(message))) return PANNE
  return message
}
