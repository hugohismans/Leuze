/**
 * La liste des inscrits pendant la réunion, et le nombre affiché juste en dessous.
 *
 * Ces deux choses disent le même fait, et elles se contredisaient. En réunion on clique
 * dix prénoms à la suite ; chaque clic s'affiche immédiatement, puis part au serveur, et
 * les réponses reviennent dans le désordre. Trois défauts en découlaient, tous visibles à
 * l'écran :
 *
 * — un refus arrivé en retard remettait la liste **telle qu'elle était avant son propre
 *   clic**, effaçant au passage les neuf suivants, qui revenaient à la relecture : des
 *   prénoms qui se décochent puis se recochent tout seuls ;
 * — le compteur de la séance venait du programme relu, la liste venait d'ailleurs :
 *   quatre prénoms cochés, « 3 personnes notées » en dessous ;
 * — et l'on ne pouvait pas vérifier tout cela, faute d'endroit où le raisonnement vive.
 *
 * D'où ce module : la liste s'y modifie **prénom par prénom**, jamais par photographie de
 * l'ensemble, et le nombre s'y compte **sur la liste elle-même**. Rien ici ne lit ni
 * n'écrit : ce sont des tableaux et des entiers.
 */

import type { RegistrationStatus } from './types'

/** Le minimum dont ce module a besoin. L'écran en met davantage ; cela ne le regarde pas. */
export type RosterEntry = {
  patientUid: string
  status: Exclude<RegistrationStatus, 'cancelled'>
}

/**
 * La liste après un clic, affichée sans attendre le serveur.
 *
 * `registered` dit l'état **avant** le clic : inscrit, on retire ; pas inscrit, on ajoute.
 * Une personne déjà présente n'est jamais ajoutée deux fois — deux clics rapides sur le
 * même prénom ne doivent pas la faire figurer en double.
 *
 * **Personne ne change de rang.** Une ligne déjà là est remplacée où elle est ; seule une
 * personne réellement nouvelle s'ajoute à la fin. On retirait la ligne pour la remettre au
 * bout, ce qui est le même contenu mais pas la même liste : sur la feuille d'appel, cocher
 * « Présent » faisait descendre le prénom en bas, et la relecture du serveur le remontait
 * une demi-seconde plus tard. Deux prénoms semblaient s'échanger de place. Un affichage
 * immédiat doit montrer ce que le serveur va confirmer, pas une liste réarrangée.
 */
export function withToggled<T extends RosterEntry>(lines: T[], entry: T, registered: boolean): T[] {
  if (registered) return lines.filter((ligne) => ligne.patientUid !== entry.patientUid)
  const rang = lines.findIndex((ligne) => ligne.patientUid === entry.patientUid)
  if (rang === -1) return [...lines, entry]
  return lines.map((ligne, index) => (index === rang ? entry : ligne))
}

/**
 * La liste après un refus du serveur : on défait **ce prénom-là**, et rien d'autre.
 *
 * `before` est la ligne telle qu'elle était avant le clic, ou `null` si la personne
 * n'était pas inscrite. Les autres prénoms restent où ils sont, quels que soient les
 * clics survenus depuis : une réponse ne peut pas défaire un geste qu'elle n'a pas vu.
 *
 * `at` est le rang qu'occupait la ligne. Défaire, c'est remettre les choses comme elles
 * étaient — y compris l'ordre : quelqu'un qu'on a retiré par erreur doit revenir à sa
 * place, pas en fin de liste.
 */
export function undoToggle<T extends RosterEntry>(
  lines: T[],
  patientUid: string,
  before: T | null,
  at?: number,
): T[] {
  const sansElle = lines.filter((ligne) => ligne.patientUid !== patientUid)
  if (before === null) return sansElle
  const rang = lines.findIndex((ligne) => ligne.patientUid === patientUid)
  // Encore présente : on la remet telle qu'elle était, sans la déplacer.
  if (rang !== -1) return lines.map((ligne, index) => (index === rang ? before : ligne))
  // Retirée : on la replace où elle était, ou à la fin si on ne le sait pas.
  const place = at === undefined || at < 0 || at > sansElle.length ? sansElle.length : at
  return [...sansElle.slice(0, place), before, ...sansElle.slice(place)]
}

/**
 * Les trois nombres, comptés sur la liste affichée.
 *
 * Les spectateurs à part : ils ne prennent aucune place, et les ajouter aux inscrits
 * ferait afficher « 9 / 8 » sur une séance qui n'a jamais dépassé.
 */
export function countsOf(lines: RosterEntry[]): {
  confirmedCount: number
  waitlistCount: number
  spectatorCount: number
} {
  return {
    confirmedCount: lines.filter((ligne) => ligne.status === 'confirmed').length,
    waitlistCount: lines.filter((ligne) => ligne.status === 'waitlist').length,
    spectatorCount: lines.filter((ligne) => ligne.status === 'spectator').length,
  }
}
