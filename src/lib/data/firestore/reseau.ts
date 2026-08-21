/**
 * Une limite de temps sur tout ce qui traverse le réseau.
 *
 * Les deux bibliothèques de Firebase ne rendent jamais la main d'elles-mêmes. Une
 * lecture Firestore lancée pendant que le téléphone bascule du wifi à la 5G n'échoue
 * pas : elle attend, indéfiniment, en réessayant en silence. Une fonction appelable dont
 * la réponse se perd fait la même chose.
 *
 * Vu de l'écran, cela donne exactement ce qu'on nous a décrit : « Un instant… » qui ne
 * s'en va plus, et des boutons qui ne répondent pas — parce qu'ils se sont désactivés le
 * temps d'une action qui, elle, n'est jamais revenue. Le troisième appui « marche » :
 * c'est en réalité la première réponse qui finit par arriver.
 *
 * D'où cette limite. Passé le délai, on renonce et l'on dit pourquoi. Une erreur qu'on
 * peut lire vaut mieux qu'une attente qu'on ne peut pas quitter.
 */

/** Une lecture : le cache local répond en général tout de suite. */
export const DELAI_LECTURE = 12_000

/**
 * Une écriture, ou une fonction appelable. Plus long : une fonction qui n'a pas tourné
 * depuis un moment démarre à froid, et cela prend parfois une dizaine de secondes. Ce
 * délai-ci doit laisser passer un démarrage à froid, et arrêter le reste.
 */
export const DELAI_ECRITURE = 25_000

export class DelaiDepasse extends Error {
  constructor() {
    super('Le serveur met trop de temps à répondre. Vérifiez la connexion, puis réessayez.')
    this.name = 'DelaiDepasse'
  }
}

/**
 * La même promesse, mais qui finit toujours par se terminer.
 *
 * L'opération n'est pas annulée — on ne peut pas annuler une écriture partie sur le
 * réseau, et prétendre le contraire serait pire. On cesse simplement de l'attendre :
 * l'écran redevient utilisable, et la personne peut réessayer.
 */
export async function avecDelai<T>(action: Promise<T>, ms: number): Promise<T> {
  let minuteur: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      action,
      new Promise<never>((_, rejeter) => {
        minuteur = setTimeout(() => rejeter(new DelaiDepasse()), ms)
      }),
    ])
  } finally {
    if (minuteur !== undefined) clearTimeout(minuteur)
  }
}

/** Une lecture qui ne peut pas durer indéfiniment. */
export const lire = <T>(action: Promise<T>): Promise<T> => avecDelai(action, DELAI_LECTURE)

/** Une écriture — ou un appel de fonction — qui ne peut pas durer indéfiniment. */
export const ecrire = <T>(action: Promise<T>): Promise<T> => avecDelai(action, DELAI_ECRITURE)
