import { config } from '../config'
import { accorde, motAccorde } from './francais'
import type { Occurrence } from './types'

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

/** La phrase qui accompagne le bouton, ou `null` quand il se suffit à lui-même. */
export function registrationInvitation(occurrence: Occurrence): string | null {
  if (occurrence.registrationRequired) return null
  return 'Vous pouvez venir sans vous inscrire. En le notant, l’activité apparaîtra dans votre semaine.'
}

/** Libellé destiné au personnel : toujours les chiffres exacts. */
export function staffCapacityLabel(occurrence: Occurrence): string {
  if (!occurrence.registrationRequired && occurrence.capacity === null) {
    const n = occurrence.confirmedCount
    // Zéro prend le singulier en français : « 0 personne notée ».
    return `Sans inscription — ${n} ${n > 1 ? 'personnes notées' : 'personne notée'}`
  }
  if (occurrence.capacity === null) {
    return `${accorde(occurrence.confirmedCount, 'inscrit', 'inscrits')}, places illimitées`
  }
  const remaining = remainingSeats(occurrence) ?? 0
  const waitlist = occurrence.waitlistCount > 0 ? `, ${occurrence.waitlistCount} en attente` : ''
  // « 1 / 8 inscrits (1 restantes) » : l'accord manquait, à côté d'une phrase correcte.
  const inscrits = motAccorde(occurrence.confirmedCount, 'inscrit', 'inscrits')
  return `${occurrence.confirmedCount} / ${occurrence.capacity} ${inscrits} (${accorde(remaining, 'restante', 'restantes')})${waitlist}`
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
export function registrationBlock(occurrence: Occurrence, now: Date): RegistrationBlock | null {
  if (occurrence.status === 'cancelled') return 'cancelled'
  if (occurrence.start.getTime() <= now.getTime()) return 'past'
  const state = capacityOf(occurrence)
  if (state.kind === 'full' && !state.waitlistEnabled) return 'full-no-waitlist'
  return null
}

/** Message affiché au patient quand l'inscription est impossible. Dit toujours quoi faire. */
export function registrationBlockMessage(block: RegistrationBlock): string {
  switch (block) {
    case 'cancelled':
      return "Cette activité est annulée. Un soignant peut vous proposer autre chose."
    case 'past':
      return "Cette activité a déjà commencé. L'inscription n'est plus possible."
    case 'full-no-waitlist':
      return "Cette activité est complète. Adressez-vous à un soignant."
  }
}
