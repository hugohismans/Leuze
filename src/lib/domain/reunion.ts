/**
 * Le geste de la réunion du lundi : un prénom, trois états, un seul appui.
 *
 * En réunion, l'équipe passe la liste des patients devant chaque activité et clique. Le
 * geste doit tenir en un doigt, sans menu, sans boîte de dialogue : on en fait dix par
 * minute. Jusqu'ici il n'y avait que deux états — inscrit, ou pas. Depuis qu'on peut
 * venir regarder sans prendre de place, il en faut trois, et ils s'enchaînent en boucle :
 *
 *     rien → inscrit → vient regarder → rien → …
 *
 * L'ordre n'est pas arbitraire. Le cas courant est de loin le premier appui : on inscrit.
 * Le second sert à la personne dont on dit « elle ne fera pas, mais elle viendra » — c'est
 * une correction du premier, elle se fait donc juste après. Le troisième défait tout, et
 * c'est bien qu'il soit le plus loin : retirer quelqu'un par mégarde d'une réunion où l'on
 * clique vite est l'erreur la plus difficile à rattraper, parce que personne ne la voit.
 *
 * Rien ici ne lit ni n'écrit : ce sont trois mots et une flèche.
 */
import type { RegistrationStatus } from './types'

/** Ce qu'on lit d'un prénom en réunion. Trois états, et pas un de plus. */
export type MeetingState = 'rien' | 'inscrit' | 'regarde'

/**
 * L'état d'un prénom, d'après ce que la liste dit de lui.
 *
 * La liste d'attente compte comme « inscrit » : la personne a demandé sa place, elle
 * l'aura si quelqu'un se retire, et l'appui suivant doit lui proposer la même chose qu'à
 * un inscrit. Un quatrième état pour elle n'apporterait rien qu'une couleur de plus à
 * apprendre — la mention « en liste d'attente » est écrite à côté du prénom.
 */
export function meetingStateOf(status: RegistrationStatus | undefined | null): MeetingState {
  if (status === 'spectator') return 'regarde'
  if (status === 'confirmed' || status === 'waitlist') return 'inscrit'
  return 'rien'
}

/** L'état suivant dans le cycle. Trois appuis ramènent au point de départ. */
export function nextMeetingState(current: MeetingState): MeetingState {
  if (current === 'rien') return 'inscrit'
  if (current === 'inscrit') return 'regarde'
  return 'rien'
}

/**
 * Ce que l'appui va demander au serveur.
 *
 * Trois gestes seulement, et le second n'est pas une seconde inscription : c'est la ligne
 * existante qui change de nature, ce que la transaction sait faire depuis qu'on peut venir
 * regarder. Voir `register` dans `domain/waitlist`.
 */
export type MeetingAction =
  | { kind: 'inscrire' }
  | { kind: 'faire-spectateur' }
  | { kind: 'retirer' }

export function meetingAction(current: MeetingState): MeetingAction {
  const suivant = nextMeetingState(current)
  if (suivant === 'inscrit') return { kind: 'inscrire' }
  if (suivant === 'regarde') return { kind: 'faire-spectateur' }
  return { kind: 'retirer' }
}

/**
 * Ce que le prénom porte à l'écran : un signe, et un mot.
 *
 * Jamais la couleur seule — c'est un critère de refus en revue, et il mord précisément
 * ici : bleu et orange se ressemblent pour beaucoup de gens, et le geste consiste
 * justement à distinguer les deux d'un coup d'œil sur une liste de quarante prénoms.
 * Le signe et le mot voyagent donc avec la couleur, toujours.
 */
export type MeetingBadge = {
  /** Décoratif : c'est le mot qui porte le sens. */
  icon: string
  /** Vide pour « rien » : on n'écrit pas « pas inscrit » à côté de trente-neuf prénoms. */
  word: string
  /** Ce que fera le prochain appui, dit en toutes lettres au lecteur d'écran. */
  next: string
}

export function meetingBadge(current: MeetingState): MeetingBadge {
  switch (current) {
    case 'inscrit':
      return { icon: '✓', word: 'inscrit', next: 'Appuyez pour qu’il vienne seulement regarder' }
    case 'regarde':
      return { icon: '👀', word: 'vient regarder', next: 'Appuyez pour le retirer' }
    case 'rien':
      return { icon: '＋', word: '', next: 'Appuyez pour l’inscrire' }
  }
}

/**
 * Le rappel écrit au-dessus de la liste.
 *
 * Un cycle de trois ne se devine pas. Il s'apprend en un essai — mais il faut avoir eu
 * l'idée d'appuyer une deuxième fois, et rien à l'écran ne le suggérait.
 */
export const MEETING_HINT =
  'Appuyez sur un prénom pour l’inscrire. Appuyez encore : il vient seulement regarder, sans prendre de place. Une troisième fois le retire.'
