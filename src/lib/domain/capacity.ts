import { config } from '../config'
import { accorde, motAccorde } from './francais'
import type { Occurrence, RegistrationStatus } from './types'

/**
 * Participer, ou regarder.
 *
 * Deux façons d'être à une activité, et une seule différence qui compte pour le calcul :
 * le spectateur ne prend pas de place. Tout le reste — l'heure, le lieu, le fait d'être
 * quelque part — est identique.
 */
export type RegistrationKind = 'participant' | 'spectator'

/** Les spectateurs d'une séance. Absent vaut zéro : voir `Occurrence.spectatorCount`. */
export function spectatorsOf(occurrence: Pick<Occurrence, 'spectatorCount'>): number {
  return occurrence.spectatorCount ?? 0
}

export type CapacityState =
  | { kind: 'cancelled' }
  | { kind: 'no-registration' }
  | { kind: 'unlimited' }
  | { kind: 'available'; remaining: number }
  | { kind: 'last-places'; remaining: number }
  | { kind: 'full'; waitlistEnabled: boolean; waitlistCount: number }

export function remainingSeats(occurrence: Occurrence): number | null {
  if (occurrence.capacity === null) return null
  return Math.max(0, occurrence.capacity - occurrence.confirmedCount)
}

export function capacityOf(occurrence: Occurrence): CapacityState {
  if (occurrence.status === 'cancelled') return { kind: 'cancelled' }
  // Une activité ouverte à tous et sans limite de places n'a pas d'état de remplissage.
  // Dès qu'une capacité est fixée, elle compte — même si l'inscription reste facultative.
  if (!occurrence.registrationRequired && occurrence.capacity === null) return { kind: 'no-registration' }
  const remaining = remainingSeats(occurrence)
  if (remaining === null) return { kind: 'unlimited' }
  if (remaining === 0) {
    return { kind: 'full', waitlistEnabled: occurrence.waitlistEnabled, waitlistCount: occurrence.waitlistCount }
  }
  if (remaining <= config.lastPlacesThreshold) return { kind: 'last-places', remaining }
  return { kind: 'available', remaining }
}

/**
 * Libellé destiné au patient. Français simple, jamais de chiffre anxiogène par défaut
 * (voir PLAN.md §6.7 : `config.patientShowsExactPlaces` bascule ce comportement).
 */
export function patientCapacityLabel(occurrence: Occurrence): string {
  const state = capacityOf(occurrence)
  switch (state.kind) {
    case 'cancelled':
      return 'Cette activité est annulée'
    case 'no-registration':
      return 'Ouvert à tous, sans inscription'
    case 'unlimited':
      return 'Inscription nécessaire, places non limitées'
    case 'available':
      return config.patientShowsExactPlaces
        ? `Il reste ${state.remaining} places`
        : 'Il reste des places'
    case 'last-places':
      return config.patientShowsExactPlaces
        ? `Il reste ${state.remaining} ${state.remaining === 1 ? 'place' : 'places'}`
        : 'Dernières places'
    case 'full':
      return state.waitlistEnabled ? "Complet — vous pouvez vous mettre en attente" : 'Complet'
  }
}

/**
 * Ce qui va se passer si l'on s'inscrit maintenant : une place, ou la liste d'attente.
 *
 * C'est une prévision, pas une décision : seul le serveur tranche, dans une transaction,
 * et deux personnes peuvent viser la même dernière place. Elle sert à deux choses qui ne
 * doivent jamais se contredire — le texte du bouton, et ce que l'écran affiche pendant la
 * seconde où la réponse voyage. Les faire dériver reviendrait à promettre une place puis
 * à la reprendre.
 */
export function likelyStatus(occurrence: Occurrence): 'confirmed' | 'waitlist' {
  return capacityOf(occurrence).kind === 'full' ? 'waitlist' : 'confirmed'
}

/**
 * Ce que dit le bouton d'inscription. Sur une activité ouverte à tous, s'inscrire n'est
 * pas une condition d'accès mais une façon de la retrouver dans sa semaine : le mot
 * « inscription » y serait trompeur.
 */
export function registrationActionLabel(occurrence: Occurrence): string {
  if (likelyStatus(occurrence) === 'waitlist') return "Je m'inscris sur la liste d'attente"
  return occurrence.registrationRequired ? "Je m'inscris" : 'Je note que je viens'
}

/**
 * Ce que dit le second bouton : venir sans prendre de place.
 *
 * « Spectateur » est un mot juste, et c'est celui de l'équipe. Ce n'est pourtant pas
 * celui du bouton : « Je viens seulement regarder » dit la même chose en disant ce qu'on
 * va faire, et c'est ce qui se comprend sans y revenir. Le mot « seulement » porte tout
 * le sens — il répond d'avance à « et si je change d'avis ? ».
 */
export function spectatorActionLabel(): string {
  return 'Je viens seulement regarder'
}

/** Ce qu'on lit une fois noté comme spectateur. */
export function spectatorLabel(): string {
  return 'Vous venez regarder'
}

/**
 * Passer de l'un à l'autre, dans les deux sens. Des phrases entières, jamais « Oui ».
 *
 * Quitter la file d'attente se dit : quelqu'un qui attendait une place la perd en
 * choisissant de venir regarder, et il doit le savoir avant d'appuyer, pas après.
 */
export function becomeSpectatorLabel(status?: RegistrationStatus): string {
  if (status === 'waitlist') return "Quitter la liste d'attente et venir seulement regarder"
  return 'Finalement, je viens seulement regarder'
}

export function becomeParticipantLabel(occurrence: Occurrence): string {
  // Complet : ce qui attend la personne est la liste d'attente, et cela se dit avant.
  if (likelyStatus(occurrence) === 'waitlist') return "Je veux participer : mettez-moi sur la liste d'attente"
  return 'Je veux participer, finalement'
}

/**
 * Ce qu'on lit une fois inscrit — le pendant exact de `registrationActionLabel`.
 *
 * Les deux se contredisaient : le bouton disait « Je note que je viens », et l'écran
 * répondait « ✓ Vous êtes inscrit », sur une carte qui portait au même moment « Ouvert à
 * tous, sans inscription ». Deux phrases opposées mot pour mot, sur la même carte.
 */
export function registeredLabel(occurrence: Occurrence): string {
  return occurrence.registrationRequired ? 'Vous êtes inscrit' : 'Vous avez noté que vous venez'
}

/**
 * Ce qu'on lit sur une séance annulée, à propos de ce qu'on avait fait.
 *
 * Le bandeau écrivait « Vous étiez inscrit » à tout le monde : à qui s'était noté sur
 * une activité sans inscription, comme à qui attendait une place. C'est la faute que le
 * reste de l'écran venait d'apprendre à ne plus faire.
 */
export function wasRegisteredLabel(occurrence: Occurrence, status: RegistrationStatus): string {
  if (status === 'waitlist') return "Vous étiez sur la liste d'attente"
  if (status === 'spectator') return 'Vous veniez regarder'
  return occurrence.registrationRequired ? 'Vous étiez inscrit' : 'Vous aviez noté que vous veniez'
}

/**
 * Le geste inverse, dans les mêmes mots.
 *
 * « Me désinscrire » n'a pas de sens pour quelqu'un qui venait seulement regarder : il ne
 * s'était pas inscrit, il avait dit qu'il passerait.
 */
export function unregisterActionLabel(occurrence: Occurrence, status?: RegistrationStatus): string {
  if (status === 'spectator') return 'Finalement, je ne viendrai pas'
  return occurrence.registrationRequired ? 'Me désinscrire' : 'Je ne viendrai pas'
}

/**
 * Ce qu'on lit après s'être retiré.
 *
 * « Vous n'êtes plus inscrit » ne veut rien dire pour quelqu'un qui ne s'était pas
 * inscrit : il avait dit qu'il passerait regarder, et il vient de dire le contraire.
 */
export function unregisteredMessage(status?: RegistrationStatus): string {
  return status === 'spectator' ? 'C’est noté : vous ne viendrez pas.' : 'Vous n’êtes plus inscrit.'
}

/**
 * Complet — mais plus un cul-de-sac.
 *
 * `registrationBlockMessage('full-no-waitlist')` finit par « Adressez-vous à un
 * soignant », ce qui était juste tant qu'il n'y avait rien d'autre à faire. Depuis qu'on
 * peut venir regarder, envoyer quelqu'un déranger un soignant pour une chose qu'il peut
 * faire lui-même, sur l'écran qu'il a sous les yeux, est un mauvais conseil.
 */
export function fullButWatchableMessage(): string {
  return 'Toutes les places sont prises. Vous pouvez quand même venir regarder, sans participer.'
}

/** La phrase qui accompagne le bouton, ou `null` quand il se suffit à lui-même. */
export function registrationInvitation(occurrence: Occurrence): string | null {
  if (occurrence.registrationRequired) return null
  return 'Vous pouvez venir sans vous inscrire. En le notant, l’activité apparaîtra dans votre semaine.'
}

/**
 * Les spectateurs, dits au personnel — et jamais mêlés aux inscrits.
 *
 * L'animateur a besoin des deux chiffres, et il a besoin qu'ils restent distincts :
 * « 8 / 8 inscrits » lui dit combien de personnes feront l'activité, « 3 spectateurs »
 * lui dit combien de chaises ajouter au fond. Les additionner reviendrait à lui faire
 * croire à un dépassement qui n'existe pas.
 */
function spectateurs(occurrence: Occurrence): string {
  const n = spectatorsOf(occurrence)
  if (n === 0) return ''
  return `, ${n} ${n > 1 ? 'spectateurs' : 'spectateur'}`
}

/** Libellé destiné au personnel : toujours les chiffres exacts. */
export function staffCapacityLabel(occurrence: Occurrence): string {
  if (!occurrence.registrationRequired && occurrence.capacity === null) {
    const n = occurrence.confirmedCount
    // Zéro prend le singulier en français : « 0 personne notée ».
    return `Sans inscription — ${n} ${n > 1 ? 'personnes notées' : 'personne notée'}${spectateurs(occurrence)}`
  }
  if (occurrence.capacity === null) {
    return `${accorde(occurrence.confirmedCount, 'inscrit', 'inscrits')}, places illimitées${spectateurs(occurrence)}`
  }
  const remaining = remainingSeats(occurrence) ?? 0
  const waitlist = occurrence.waitlistCount > 0 ? `, ${occurrence.waitlistCount} en attente` : ''
  // « 1 / 8 inscrits (1 restantes) » : l'accord manquait, à côté d'une phrase correcte.
  const inscrits = motAccorde(occurrence.confirmedCount, 'inscrit', 'inscrits')
  return `${occurrence.confirmedCount} / ${occurrence.capacity} ${inscrits} (${accorde(remaining, 'restante', 'restantes')})${waitlist}${spectateurs(occurrence)}`
}

export type RegistrationBlock = 'cancelled' | 'past' | 'full-no-waitlist'

/**
 * `null` = l'inscription est possible. Sinon, la raison du refus.
 *
 * Une activité « sans inscription » n'est pas un refus : on peut s'y inscrire tout de
 * même, et c'est même souhaitable — c'est ce qui la fait apparaître dans la semaine du
 * patient et sur la liste que le soignant a sous les yeux. « Sans inscription » veut
 * dire « venir sans s'être inscrit reste possible », pas « s'inscrire est interdit ».
 */
export function registrationBlock(
  occurrence: Occurrence,
  now: Date,
  /**
   * Venir regarder ne se heurte jamais au nombre de places.
   *
   * C'est toute la raison d'être du spectateur : il ne prend rien à personne, donc rien
   * ne peut être « pris » avant lui. Une séance complète, ou complète sans liste
   * d'attente, lui reste ouverte. Ce qui la ferme — annulée, déjà commencée — la ferme
   * pour tout le monde, et pour la même raison.
   */
  as: RegistrationKind = 'participant',
): RegistrationBlock | null {
  if (occurrence.status === 'cancelled') return 'cancelled'
  if (occurrence.start.getTime() <= now.getTime()) return 'past'
  if (as === 'spectator') return null
  const state = capacityOf(occurrence)
  if (state.kind === 'full' && !state.waitlistEnabled) return 'full-no-waitlist'
  return null
}

/**
 * Le message d'un refus d'inscription. Il dit toujours quoi faire.
 *
 * `by` change à qui l'on parle, et donc ce qu'on propose de faire. Le serveur renvoyait
 * au soignant les phrases écrites pour le patient : « Adressez-vous à un soignant » lu
 * par le soignant lui-même, et « Un soignant peut vous proposer autre chose » sur un
 * écran où l'on peut rétablir la séance d'un bouton.
 */
export function registrationBlockMessage(
  block: RegistrationBlock,
  by: 'patient' | 'staff' = 'patient',
): string {
  if (by === 'staff') {
    switch (block) {
      case 'cancelled':
        return 'Cette séance est annulée : on ne peut pas y inscrire quelqu’un. Rétablissez-la, ou proposez autre chose à cette personne.'
      case 'past':
        return "Cette séance a déjà commencé. L'inscription n'est plus possible."
      case 'full-no-waitlist':
        return 'Cette séance est complète et la liste d’attente est fermée. Ouvrez-la, ou ajoutez des places, sur la fiche de l’activité.'
    }
  }
  switch (block) {
    case 'cancelled':
      return "Cette activité est annulée. Un soignant peut vous proposer autre chose."
    case 'past':
      return "Cette activité a déjà commencé. L'inscription n'est plus possible."
    case 'full-no-waitlist':
      return "Cette activité est complète. Adressez-vous à un soignant."
  }
}
