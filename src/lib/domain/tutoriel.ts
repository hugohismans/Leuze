/**
 * Le petit tour de l'application, montré à la première connexion.
 *
 * Il s'adresse à des personnes pour qui l'informatique n'est pas familière, et souvent à
 * des personnes sous traitement : lire coûte un effort, et la concentration est courte.
 * Trois règles en découlent, et elles décident de tout ce fichier.
 *
 * **Une idée par écran.** Six écrans, deux ou trois phrases chacun. Un mode d'emploi
 * complet ne serait pas lu ; six phrases le seront.
 *
 * **On nomme les boutons tels qu'ils sont écrits.** « Appuyez sur « Voir ma semaine » »
 * et non « accédez à votre planning hebdomadaire ». La personne doit reconnaître à
 * l'écran, mot pour mot, ce qu'elle vient de lire.
 *
 * **On n'apprend que ce qui sert le premier jour.** Voir le programme, s'inscrire,
 * retrouver ses inscriptions, demander un rendez-vous. Les filtres, le mois, les idées
 * d'activités : rien de tout cela n'est ici. Ils se découvrent seuls, ou avec un
 * soignant.
 *
 * Le texte vit ici, hors de tout composant, pour une raison simple : c'est ce qu'on
 * relira à voix haute avec l'équipe avant de le montrer à quelqu'un, et une phrase se
 * corrige mieux quand elle n'est pas enfouie dans du balisage.
 */

/** Les écrans du petit tour, dans l'ordre. L'identifiant choisit l'illustration. */
export type TutorialStepId =
  | 'bienvenue'
  | 'programme'
  | 'activite'
  | 'ma-semaine'
  | 'mes-inscriptions'
  | 'fin'

export type TutorialStep = {
  id: TutorialStepId
  /** Une image vaut un titre : elle est décorative, le titre porte le sens. */
  emoji: string
  title: string
  /** Deux ou trois phrases courtes. Jamais un paragraphe. */
  lines: string[]
}

/**
 * Le nom du service, inséré sans piège de grammaire.
 *
 * Les unités de l'hôpital s'appellent « La Couturelle », « L'Ancrive », « L'Écheveau » :
 * écrire « les activités de {nom} » donnerait « de L'Escalette ». On passe donc par
 * « de votre service, L'Escalette », qui se lit bien quel que soit le nom — et qui dit
 * en plus à la personne que ce programme est le sien, pas celui de l'hôpital entier.
 */
function duService(serviceName: string | null): string {
  const propre = (serviceName ?? '').trim()
  return propre === ''
    ? 'des activités de votre service'
    : `des activités de votre service, ${propre}`
}

/** Les six écrans, le nom du service déjà posé dedans. */
export function tutorialSteps(serviceName: string | null): TutorialStep[] {
  return [
    {
      id: 'bienvenue',
      emoji: '👋',
      title: 'Bienvenue dans Hodie',
      lines: [
        `Hodie, c'est le programme ${duService(serviceName)}.`,
        'Vous y voyez ce qui est prévu, et vous choisissez ce qui vous plaît.',
        'Ce petit tour dure une minute. Vous pouvez l’arrêter quand vous voulez.',
      ],
    },
    {
      id: 'programme',
      emoji: '📅',
      title: 'Ce qui est prévu',
      lines: [
        'Voici le premier écran : les activités de la semaine, jour par jour.',
        '« Semaine » est déjà choisi. « Jour » n’en montre qu’une, « Mois » montre le mois entier.',
        'Les deux flèches vous font avancer dans le temps.',
      ],
    },
    {
      id: 'activite',
      emoji: '👀',
      title: 'S’inscrire à une activité',
      lines: [
        'Appuyez sur une activité : vous verrez l’heure, le lieu et qui l’anime.',
        'Le bouton « Je m’inscris » vous inscrit à cette séance.',
        'Vous pourrez vous retirer plus tard. Rien n’est définitif.',
      ],
    },
    {
      id: 'ma-semaine',
      emoji: '🗓️',
      /*
        Deux boutons, une seule idée : « et moi, dans tout ça ? ».

        Ils sont voisins à l'écran, et c'est ce voisinage qui se retient. Leur donner deux
        écrans séparés reviendrait à faire lire une phrase de plus pour la même chose ; et
        laisser le second sans mention le laissait introuvable — personne n'a eu l'idée
        d'aller chercher un rendez-vous dans « Mes inscriptions ».

        Le titre reste court, et il n'énumère pas : « Votre semaine, vos rendez-vous »
        tenait sur trois lignes et coupait le mot en « rendez- / vous ». Ce sont les deux
        phrases et le dessin qui nomment les boutons ; un titre est un repère, pas un
        résumé.
      */
      title: 'Votre semaine à vous',
      lines: [
        'Le bouton « Voir ma semaine » montre tout ce qui est prévu pour vous.',
        'Juste en dessous, « Demander un rendez-vous » prévient un professionnel que vous voulez le voir.',
      ],
    },
    {
      id: 'mes-inscriptions',
      emoji: '📋',
      // Court : sur un téléphone, ce titre tenait sur quatre lignes et repoussait le
      // reste sous le pli. Les rendez-vous sont annoncés par la phrase du dessous.
      title: 'Vos inscriptions',
      lines: [
        'Tout en haut, le bouton « Mes inscriptions » rassemble ce à quoi vous êtes inscrit.',
        'Vous pouvez y retirer une inscription.',
        'Vous y retrouvez aussi vos rendez-vous, et où ils en sont.',
      ],
    },
    {
      id: 'fin',
      emoji: '🎉',
      title: 'C’est tout !',
      lines: [
        'Vous savez l’essentiel.',
        'Si quelque chose n’est pas clair, demandez à un soignant : il connaît l’application.',
        'Bonne semaine !',
      ],
    },
  ]
}

/**
 * « Étape 2 sur 6 », en toutes lettres.
 *
 * Les points sous le texte ne suffisent pas : l'information ne se porte jamais par la
 * seule couleur, et « où j'en suis » est justement ce qui rassure quelqu'un qui hésite à
 * continuer.
 */
export function progressLabel(index: number, total: number): string {
  const rang = Math.min(Math.max(index, 0), Math.max(total - 1, 0)) + 1
  return `Étape ${rang} sur ${total}`
}

/**
 * Combien de comptes on retient au maximum comme ayant vu le petit tour.
 *
 * Une tablette posée dans une unité sert à tout le monde : sans borne, la liste
 * grossirait sans fin dans le navigateur. Cinquante couvre largement une unité, et
 * quelqu'un qui reviendrait après cinquante autres personnes reverra le petit tour —
 * ce qui n'est pas un défaut.
 */
export const SEEN_MAX = 50

/**
 * Ajoute un compte à la liste de ceux qui ont vu le petit tour.
 *
 * Le dernier arrivé est en tête : c'est lui qu'on garde si la liste doit être coupée.
 */
export function rememberSeen(seen: string[], uid: string, max = SEEN_MAX): string[] {
  const propre = uid.trim()
  if (propre === '') return seen
  return [propre, ...seen.filter((u) => u !== propre)].slice(0, Math.max(max, 1))
}

/** A-t-on déjà montré le petit tour à ce compte, sur cet appareil ? */
export function hasSeen(seen: string[], uid: string | null): boolean {
  return uid !== null && uid.trim() !== '' && seen.includes(uid.trim())
}

/**
 * Faut-il ouvrir le petit tour tout seul ?
 *
 * Trois conditions, et la deuxième est celle qu'on oublie.
 *
 * `alreadyOfferedTo` est le compte auquel la page l'a déjà proposé depuis qu'elle est
 * ouverte. Sans lui, refermer le petit tour le rouvrirait au prochain calcul. Avec un
 * simple « déjà fait », en revanche, on raterait le cas qui compte : une tablette posée
 * dans une unité voit passer plusieurs personnes sans jamais recharger la page. Quelqu'un
 * ferme son accès, la suivante entre son code — et c'est pour elle une première
 * connexion. C'est le compte qu'on retient, donc, et non un drapeau.
 */
export function shouldOfferTutorial(
  uid: string | null,
  alreadyOfferedTo: string | null,
  seen: string[],
): boolean {
  if (uid === null || uid.trim() === '') return false
  if (uid === alreadyOfferedTo) return false
  return !hasSeen(seen, uid)
}
