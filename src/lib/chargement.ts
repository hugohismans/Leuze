/**
 * Charger une fois, mais ne pas rester coincé sur un échec.
 *
 * L'adapter de données est chargé par un `import()` : c'est ce qui permet à la version
 * de démonstration de ne pas embarquer Firebase. La promesse était gardée dans un champ,
 * et réutilisée à chaque appel — ce qui est juste tant qu'elle aboutit.
 *
 * Quand elle échoue, en revanche, **elle échoue pour toujours**. Une promesse rejetée
 * reste rejetée : chaque nouvel essai retombe sur la même, à l'instant, sans jamais
 * retenter quoi que ce soit. Réessayer ne pouvait donc rien changer, et rien à l'écran
 * ne le disait — le bouton répondait « Quelque chose n'a pas fonctionné, réessayez »,
 * ce qui était une promesse en l'air. Seul un rechargement de la page s'en sortait.
 *
 * Le cas n'est pas théorique. Le fragment est demandé au serveur au moment où l'on
 * s'en sert ; il suffit d'une coupure de réseau à cette seconde-là — ou d'une
 * publication qui vient de remplacer les fichiers pendant qu'un onglet reste ouvert,
 * ce qui arrive à chaque mise en ligne — pour que la demande échoue.
 *
 * D'où ceci : on garde le résultat quand il arrive, on oublie la tentative quand elle
 * rate. Le geste suivant repart alors pour de bon.
 */
export function chargeurRessayable<T>(demarrer: () => Promise<T>): () => Promise<T> {
  let acquis: T | null = null
  /*
    La tentative en cours, ou `null`.

    Elle est lancée tout de suite — le fragment se télécharge pendant que la page
    s'affiche, et le premier geste ne paie pas l'attente. C'est ce que faisait déjà le
    champ d'origine, et il n'y a aucune raison de le perdre.
  */
  let enCours: Promise<T> | null = demarrer()

  return async (): Promise<T> => {
    if (acquis !== null) return acquis
    if (enCours === null) enCours = demarrer()
    try {
      acquis = await enCours
      return acquis
    } catch (erreur) {
      // On oublie la tentative ratée : la prochaine repartira de zéro.
      enCours = null
      throw erreur
    }
  }
}
