import { config } from '../config'
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
  if (!occurrence.registrationRequired) return { kind: 'no-registration' }
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

/** Libellé destiné au personnel : toujours les chiffres exacts. */
export function staffCapacityLabel(occurrence: Occurrence): string {
  if (!occurrence.registrationRequired) return 'Sans inscription'
  if (occurrence.capacity === null) return `${occurrence.confirmedCount} inscrits, places illimitées`
  const remaining = remainingSeats(occurrence) ?? 0
  const waitlist = occurrence.waitlistCount > 0 ? `, ${occurrence.waitlistCount} en attente` : ''
  return `${occurrence.confirmedCount} / ${occurrence.capacity} inscrits (${remaining} restantes)${waitlist}`
}

export type RegistrationBlock =
  | 'cancelled'
  | 'past'
  | 'no-registration-required'
  | 'full-no-waitlist'

/** `null` = l'inscription est possible. Sinon, la raison du refus. */
export function registrationBlock(occurrence: Occurrence, now: Date): RegistrationBlock | null {
  if (occurrence.status === 'cancelled') return 'cancelled'
  if (!occurrence.registrationRequired) return 'no-registration-required'
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
    case 'no-registration-required':
      return "Vous pouvez venir sans vous inscrire."
    case 'full-no-waitlist':
      return "Cette activité est complète. Adressez-vous à un soignant."
  }
}
