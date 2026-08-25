/**
 * Les activités proposées par les patients.
 *
 * Le programme se construit pour les patients ; rien n'oblige à ce qu'il se construise
 * sans eux. Quelqu'un qui sait jouer aux échecs, qui tricote, qui jongle ou qui connaît
 * un jeu de société peut proposer une séance — et l'animer lui-même s'il s'en sent
 * capable et si l'équipe est d'accord. Ce n'est pas un détail d'organisation : une
 * personne qui propose n'est plus seulement destinataire du programme.
 *
 * Trois garde-fous, et ils ne sont pas négociables.
 *
 * **Rien ne paraît sans validation.** Une proposition n'est pas une activité : c'est une
 * demande. L'équipe la lit, la refuse ou en fait une activité — qu'elle animera, ou dont
 * elle confiera l'animation à la personne qui l'a proposée.
 *
 * **Deux champs, et courts.** Un titre et une description de l'activité. Le texte libre
 * est le réceptacle naturel du contenu clinique : on le tient volontairement court, on
 * dit à quoi il sert, et l'équipe le relit avant que quiconque le voie.
 *
 * **Ce n'est jamais une réclamation.** Ce formulaire propose une activité ; il ne
 * remplace pas la parole, il ne transporte pas de message à un soignant, et il n'y a rien
 * à y répondre sinon oui ou non.
 */
import { accorde } from './francais'
import { calendarDaysSince } from './time'

export type ProposalStatus = 'proposed' | 'accepted' | 'declined'

export type ActivityProposal = {
  id: string
  /** UID Firebase Auth du patient. Aucun nom de famille, ici comme ailleurs. */
  patientUid: string
  /**
   * Le prénom, recopié au moment du dépôt.
   *
   * La collection des patients n'est lisible par aucun client, pas même par
   * l'administrateur : sans cette copie, il répondrait à un identifiant. Un prénom, et
   * rien d'autre — comme partout ailleurs dans l'application.
   */
  patientFirstName?: string
  title: string
  description: string
  /** La personne se propose de l'animer elle-même. L'équipe reste seule à en décider. */
  wantsToLead: boolean
  status: ProposalStatus
  createdAt: Date
  /** Renseignés par l'équipe au moment de répondre. */
  decidedAt?: Date
  declineReason?: string
  /** L'activité née de cette proposition, quand elle a été acceptée. */
  activityId?: string
}

export type ProposalDraft = {
  title: string
  description: string
  wantsToLead: boolean
}

export const TITLE_MAX = 80
export const DESCRIPTION_MAX = 300

/**
 * Ce qu'on peut proposer, en exemples.
 *
 * Devant un champ vide, personne ne sait quoi écrire — et quelqu'un qui hésite déjà à
 * demander n'insistera pas. Ces exemples sont là pour ça : ils montrent l'échelle
 * attendue (une séance, pas un projet) et la variété admise.
 */
export const PROPOSAL_IDEAS: readonly string[] = [
  'Un jeu de société que vous connaissez bien : les échecs, les cartes, le Scrabble.',
  'Un savoir-faire à montrer : le tricot, le dessin, la cuisine, le bricolage.',
  'Un talent, même inattendu : la jonglerie, la guitare, un tour de magie.',
  'Une sortie simple : une promenade, un jardin, un marché.',
  'Un moment ensemble : écouter de la musique, regarder un film, parler d’un livre.',
  'Un sport doux : la marche, le ping-pong, le badminton.',
]

/** Ce que le formulaire dit de lui-même, pour que le texte libre reste à sa place. */
/**
 * À partir de combien de caractères restants on annonce la limite.
 *
 * Les deux champs de l'écran ne suivaient pas la même règle : le nom se taisait jusqu'aux
 * vingt derniers caractères, la description annonçait « Il vous reste 300 caractères »
 * sur un champ vide. Trois cents ne veut rien dire avant d'avoir écrit, et cette phrase
 * de plus se lit comme une consigne pour qui lit avec effort.
 */
export const REMAINING_NOTICE_FROM = 20

/** Ce qu'on écrit sous un champ dont la longueur est limitée. `null` tant qu'il reste de la place. */
export function remainingNotice(restant: number, atteint: string): string | null {
  if (restant > REMAINING_NOTICE_FROM) return null
  if (restant <= 0) return atteint
  return `Il vous reste ${accorde(restant, 'caractère', 'caractères')}.`
}

export const PROPOSAL_GUIDANCE =
  'Décrivez l’activité : ce qu’on y ferait, et ce qu’il faudrait pour la faire. Ce n’est pas un message à un soignant : ce que vous écrivez ici sert seulement à comprendre votre idée.'

/**
 * La proposition est-elle recevable ? Les messages disent quoi faire, jamais ce qui
 * cloche dans l'abstrait.
 */
export function validateProposal(draft: ProposalDraft): { ok: true } | { ok: false; message: string } {
  const titre = draft.title.trim()
  const texte = draft.description.trim()
  if (titre.length < 3) {
    return { ok: false, message: 'Donnez un nom à votre activité. Par exemple : « Tournoi d’échecs ».' }
  }
  if (titre.length > TITLE_MAX) {
    return { ok: false, message: `Ce nom est trop long. Gardez ${TITLE_MAX} caractères au maximum.` }
  }
  if (texte.length < 10) {
    return { ok: false, message: 'Dites en une phrase ce qu’on ferait pendant cette activité.' }
  }
  if (texte.length > DESCRIPTION_MAX) {
    return { ok: false, message: `Votre texte est trop long. Gardez ${DESCRIPTION_MAX} caractères au maximum.` }
  }
  return { ok: true }
}

/** Le brouillon, nettoyé : c'est cette version-là qui part au serveur. */
export function cleanProposal(draft: ProposalDraft): ProposalDraft {
  return {
    title: draft.title.trim(),
    description: draft.description.trim(),
    wantsToLead: draft.wantsToLead === true,
  }
}

/** Ce que le patient lit sur sa proposition. Toujours dire où l'on en est. */
export function patientProposalLabel(proposal: ActivityProposal): string {
  switch (proposal.status) {
    case 'proposed':
      return 'Votre idée est envoyée. Un soignant va la lire.';
    case 'accepted':
      /*
        « Retenue », et non « au programme ».

        Retenir une idée ouvre le formulaire de création ; l'activité n'existe pas encore,
        et le soignant peut être appelé ailleurs avant de l'avoir enregistrée — ou la créer
        sans la mettre au programme tout de suite. Le patient lisait « l'activité est au
        programme » et allait la chercher dans un calendrier où elle ne figurait pas.
      */
      return 'Votre idée est retenue. Un soignant prépare l’activité.'
    case 'declined':
      return proposal.declineReason
        ? `Votre idée n’a pas été retenue — ${proposal.declineReason}`
        : 'Votre idée n’a pas été retenue cette fois. Vous pouvez en proposer une autre.'
  }
}

/** Les propositions en attente, les plus anciennes d'abord : c'est l'ordre à traiter. */
export function pendingProposals(proposals: ActivityProposal[]): ActivityProposal[] {
  return proposals
    .filter((p) => p.status === 'proposed')
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
}

/**
 * Depuis combien de jours une idée attend. Une idée oubliée décourage plus sûrement
 * qu'un refus : l'attente doit se voir.
 */
export function waitingDays(proposal: ActivityProposal, now: Date = new Date()): number {
  /*
    La même règle que la file des rendez-vous, et pour la même raison.

    Celle-ci comptait des tranches de vingt-quatre heures : deux dépôts faits au même
    instant s'affichaient « Demandé hier » d'un côté et « Déposée aujourd'hui » de
    l'autre, sur deux écrans voisins du même espace soignant.
  */
  return calendarDaysSince(proposal.createdAt, now)
}

/**
 * Une seule idée en attente à la fois. Ce n'est pas une brimade : une file où la même
 * personne dépose dix idées cesse d'être lue, et ce sont les idées des autres qui en
 * pâtissent.
 */
export function alreadyWaiting(proposals: ActivityProposal[], patientUid: string): boolean {
  return proposals.some((p) => p.patientUid === patientUid && p.status === 'proposed')
}
