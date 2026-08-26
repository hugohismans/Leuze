/**
 * Pourquoi une connexion a échoué, et ce qu'on en dit.
 *
 * Le code n'avait qu'une phrase pour tout : « L'adresse ou le mot de passe ne correspond
 * pas. » Elle était juste dans un cas et fausse dans tous les autres — réseau coupé,
 * serveur trop lent, compte mis en pause après plusieurs essais, méthode de connexion
 * fermée. Quelqu'un qui est sûr de son mot de passe se voyait donc répondre qu'il se
 * trompe, et il n'avait aucun moyen de savoir que le problème était ailleurs. C'est la
 * pire chose qu'un écran de connexion puisse faire : envoyer chercher une clé qu'on a
 * déjà dans la poche.
 *
 * Une exception demeure, et elle est volontaire : on ne dit jamais **lequel** des deux
 * est faux, l'adresse ou le mot de passe. Le dire permettrait de deviner qui possède un
 * compte ici, en essayant des adresses au hasard.
 */

/** Ce qui a réellement empêché la connexion. */
export type LoginFailure =
  | 'identifiants'
  | 'trop-d-essais'
  | 'compte-desactive'
  | 'reseau'
  | 'methode-fermee'
  | 'panne'

/**
 * La cause, lue dans le code d'erreur de la bibliothèque d'authentification.
 *
 * Les codes sont ceux de Firebase (`auth/…`). Tout ce qui n'est pas reconnu vaut
 * « panne » : on préfère avouer qu'on ne sait pas plutôt que d'accuser quelqu'un de mal
 * taper son mot de passe.
 */
export function loginFailureOf(code: string): LoginFailure {
  const propre = code.trim().toLowerCase()
  switch (propre) {
    /*
      `invalid-credential` est le code moderne : quand la protection contre l'énumération
      des adresses est active, Firebase ne distingue plus « adresse inconnue » de « mot de
      passe faux ». Les deux anciens codes restent servis par des versions plus vieilles.
    */
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
    case 'auth/invalid-email':
    case 'auth/missing-password':
      return 'identifiants'
    case 'auth/too-many-requests':
      return 'trop-d-essais'
    case 'auth/user-disabled':
      return 'compte-desactive'
    case 'auth/network-request-failed':
    case 'auth/timeout':
      return 'reseau'
    // La connexion par adresse et mot de passe a été fermée dans la console. Tout le
    // monde se voit alors refuser, et personne ne peut le deviner depuis l'écran.
    case 'auth/operation-not-allowed':
      return 'methode-fermee'
    default:
      return 'panne'
  }
}

/**
 * Ce que la personne lit. Chaque phrase dit quoi faire — c'est la règle de l'application,
 * et elle vaut doublement ici : on est bloqué dehors, sans autre écran où chercher.
 */
export function loginFailureMessage(cause: LoginFailure): string {
  switch (cause) {
    case 'identifiants':
      // Jamais lequel des deux : cela permettrait de deviner qui a un compte ici.
      return "L'adresse ou le mot de passe ne correspond pas."
    case 'trop-d-essais':
      return 'Trop d’essais de suite : l’accès est mis en pause quelques minutes, par sécurité. Attendez un peu, puis réessayez.'
    case 'compte-desactive':
      return 'Ce compte a été désactivé. Demandez à l’administrateur de le rouvrir.'
    case 'reseau':
      return 'La connexion au serveur n’a pas abouti. Vérifiez votre connexion, puis réessayez.'
    case 'methode-fermee':
      return 'La connexion par adresse et mot de passe est fermée sur ce serveur. Prévenez l’administrateur.'
    case 'panne':
      return 'Quelque chose n’a pas fonctionné. Réessayez dans un instant.'
  }
}

/**
 * Le code d'erreur porté par ce qui a été attrapé, ou `''`.
 *
 * Les erreurs de Firebase portent un champ `code` ; celles du garde-temps du projet n'en
 * ont pas, et se reconnaissent à leur nom. Rien ici ne connaît Firebase : on lit une
 * forme, pas une bibliothèque.
 */
export function loginErrorCode(error: unknown): string {
  if (typeof error !== 'object' || error === null) return ''
  const code = (error as { code?: unknown }).code
  if (typeof code === 'string') return code
  // Le délai dépassé du projet : voir `data/firestore/reseau.ts`.
  const name = (error as { name?: unknown }).name
  return name === 'DelaiDepasse' ? 'auth/timeout' : ''
}

/**
 * Ce qu'on répond à une demande de nouveau mot de passe.
 *
 * **La même phrase, que le compte existe ou non.** C'est la même discipline que l'écran
 * de connexion : dire « cette adresse n'a pas de compte » permettrait d'apprendre, en
 * essayant des adresses au hasard, qui travaille ici. Le courriel part si le compte
 * existe ; sinon rien ne part, et personne d'autre que son propriétaire ne peut le
 * savoir.
 *
 * Deux échecs se disent quand même, parce qu'ils appellent un geste : une adresse
 * visiblement mal écrite, et l'accès mis en pause après trop de demandes.
 */
export type ResetOutcome = 'envoye' | 'adresse-invalide' | 'trop-d-essais' | 'panne'

export function resetOutcomeOf(code: string): ResetOutcome {
  const propre = code.trim().toLowerCase()
  switch (propre) {
    /*
      « Adresse inconnue » vaut succès, et c'est voulu : la réponse doit être la même dans
      les deux cas. Firebase ne le renvoie d'ailleurs plus quand la protection contre
      l'énumération des adresses est active — mais les versions plus anciennes, si.
    */
    case '':
    case 'auth/user-not-found':
      return 'envoye'
    case 'auth/invalid-email':
    case 'auth/missing-email':
      return 'adresse-invalide'
    case 'auth/too-many-requests':
      return 'trop-d-essais'
    default:
      return 'panne'
  }
}

export function resetMessage(outcome: ResetOutcome): string {
  switch (outcome) {
    case 'envoye':
      return 'Si cette adresse a un compte, un courriel vient de partir. Ouvrez-le et suivez le lien pour choisir un nouveau mot de passe. Regardez aussi dans les courriers indésirables.'
    case 'adresse-invalide':
      return 'Cette adresse électronique n’est pas écrite correctement. Vérifiez-la, puis réessayez.'
    case 'trop-d-essais':
      return 'Trop de demandes de suite : attendez quelques minutes, puis réessayez.'
    case 'panne':
      return 'La demande n’a pas abouti. Réessayez dans un instant ; si cela recommence, demandez à l’administrateur.'
  }
}
