/**
 * Où en est une personne, maintenant.
 *
 * La question que se pose un soignant en cherchant quelqu'un : « est-elle quelque part,
 * ou disponible ? ». Une réponse utile dit aussi **jusqu'à quand** — sans quoi il faut
 * ouvrir le planning pour savoir s'il faut attendre cinq minutes ou une heure.
 *
 * Une inscription en liste d'attente ne compte pas : la personne n'y participe pas.
 * Une séance annulée non plus.
 */
import type { Occurrence } from './types'

export type Presence =
  | { kind: 'busy'; title: string; locationId: string; end: Date }
  | { kind: 'free'; next: { title: string; start: Date } | null }

export type PresenceLine = { occurrence: Occurrence; status: 'confirmed' | 'waitlist' }

export function presenceOf(lines: PresenceLine[], now: Date): Presence {
  const retenues = lines
    .filter((ligne) => ligne.status === 'confirmed' && ligne.occurrence.status !== 'cancelled')
    .map((ligne) => ligne.occurrence)
    .sort((a, b) => a.start.getTime() - b.start.getTime())

  const maintenant = now.getTime()
  const enCours = retenues.find((o) => o.start.getTime() <= maintenant && o.end.getTime() > maintenant)
  if (enCours !== undefined) {
    return { kind: 'busy', title: enCours.title, locationId: enCours.locationId, end: enCours.end }
  }

  const suivante = retenues.find((o) => o.start.getTime() > maintenant)
  return {
    kind: 'free',
    next: suivante === undefined ? null : { title: suivante.title, start: suivante.start },
  }
}
