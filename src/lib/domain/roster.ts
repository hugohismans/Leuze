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

/** Le minimum dont ce module a besoin. L'écran en met davantage ; cela ne le regarde pas. */
export type RosterEntry = {
  patientUid: string
  status: 'confirmed' | 'waitlist'
}

/**
 * La liste après un clic, affichée sans attendre le serveur.
 *
 * `registered` dit l'état **avant** le clic : inscrit, on retire ; pas inscrit, on ajoute.
 * Une personne déjà présente n'est jamais ajoutée deux fois — deux clics rapides sur le
 * même prénom ne doivent pas la faire figurer en double.
 */
export function withToggled<T extends RosterEntry>(lines: T[], entry: T, registered: boolean): T[] {
  const sansElle = lines.filter((ligne) => ligne.patientUid !== entry.patientUid)
  return registered ? sansElle : [...sansElle, entry]
}

/**
 * La liste après un refus du serveur : on défait **ce prénom-là**, et rien d'autre.
 *
 * `before` est la ligne telle qu'elle était avant le clic, ou `null` si la personne
 * n'était pas inscrite. Les autres prénoms restent où ils sont, quels que soient les
 * clics survenus depuis : une réponse ne peut pas défaire un geste qu'elle n'a pas vu.
 */
export function undoToggle<T extends RosterEntry>(lines: T[], patientUid: string, before: T | null): T[] {
  const sansElle = lines.filter((ligne) => ligne.patientUid !== patientUid)
  return before === null ? sansElle : [...sansElle, before]
}

/** Le nombre d'inscrits et celui de la liste d'attente, comptés sur la liste affichée. */
export function countsOf(lines: RosterEntry[]): { confirmedCount: number; waitlistCount: number } {
  return {
    confirmedCount: lines.filter((ligne) => ligne.status === 'confirmed').length,
    waitlistCount: lines.filter((ligne) => ligne.status === 'waitlist').length,
  }
}
