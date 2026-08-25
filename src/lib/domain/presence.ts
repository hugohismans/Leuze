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
import { addLocalDays, formatDayLabel, formatTime } from './time'
import type { LocalDate, Occurrence } from './types'

export type Presence =
  | { kind: 'busy'; title: string; locationId: string; end: Date }
  /*
    « Ensuite » porte son jour.
  
    Sans lui, l'écran écrivait « Ensuite : Sport collectif à 10h00 » pour une séance qui
    avait lieu trois jours plus tard : cela se lisait comme « dans deux heures ». Le jour
    voyage donc avec l'heure, et c'est l'affichage qui décide de le taire quand c'est
    aujourd'hui.
  */
  | { kind: 'free'; next: { title: string; start: Date; localDate: LocalDate } | null }

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
    next:
      suivante === undefined
        ? null
        : { title: suivante.title, start: suivante.start, localDate: suivante.localDate },
  }
}

/**
 * « Ensuite : Sport collectif vendredi 28 août à 10h00 ».
 *
 * Le jour n'est tu que lorsqu'il est aujourd'hui — c'est le seul cas où « à 10h00 » se
 * comprend tout seul. Demain se dit « demain » : c'est ainsi qu'on parle, et cela évite
 * de faire lire une date pour rien.
 */
export function nextLabel(next: { title: string; start: Date; localDate: LocalDate }, today: LocalDate): string {
  const heure = formatTime(next.start)
  if (next.localDate === today) return `${next.title} à ${heure}`
  if (next.localDate === addLocalDays(today, 1)) return `${next.title} demain à ${heure}`
  // « Vendredi 28 août » en milieu de phrase : la majuscule du format n'a plus lieu d'être.
  const jour = formatDayLabel(next.localDate)
  return `${next.title} ${jour.charAt(0).toLowerCase()}${jour.slice(1)} à ${heure}`
}
