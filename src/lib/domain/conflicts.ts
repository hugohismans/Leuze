/**
 * Les chevauchements d'horaire.
 *
 * Une inscription se prenait sans regarder le reste de la journée : on pouvait s'inscrire
 * à l'atelier cuisine de 10 heures alors qu'on avait rendez-vous avec le psychiatre à
 * 10h15. Personne ne s'en apercevait avant le jour même — et c'est le rendez-vous qui
 * sautait, parce que l'activité, elle, se voyait sur la feuille.
 *
 * Deux poids, délibérément.
 *
 * **Un rendez-vous ne se rate pas.** Il a été fixé avec quelqu'un qui a bloqué du temps
 * pour cette personne-là. Une activité qui tombe dessus est refusée au patient qui
 * s'inscrit seul, et signalée au soignant qui inscrit à sa place — lui peut savoir que le
 * rendez-vous va être déplacé, l'application ne le sait pas.
 *
 * **Deux activités qui se chevauchent, c'est souvent sans importance.** On arrive en
 * retard au jeu de société parce que la marche a duré, et personne n'en fait un drame.
 * On le dit, on ne l'interdit pas.
 *
 * Ce module ne connaît que des intervalles et des libellés. Il ne lit rien, il ne décide
 * d'aucun droit, et il ignore tout de la raison d'un rendez-vous.
 */
import { formatTime } from './time'
import type { LocalDate } from './types'

/** Ce qui occupe déjà quelqu'un : une séance à laquelle il est inscrit, ou un rendez-vous. */
export type BusyEntry = {
  start: Date
  end: Date
  /** Ce qu'on affiche : « Atelier cuisine », « Rendez-vous avec le psychiatre ». */
  label: string
  kind: 'activity' | 'appointment'
}

export type TimeSpan = { start: Date; end: Date }

/**
 * Deux intervalles se chevauchent-ils ? Le contact bord à bord n'en est pas un : une
 * activité qui finit à 10h00 et un rendez-vous qui commence à 10h00 s'enchaînent.
 */
export function overlaps(a: TimeSpan, b: TimeSpan): boolean {
  return a.start.getTime() < b.end.getTime() && b.start.getTime() < a.end.getTime()
}

/** Tout ce qui tombe en même temps que le créneau visé, dans l'ordre du temps. */
export function conflictsWith(candidate: TimeSpan, busy: BusyEntry[]): BusyEntry[] {
  return busy
    .filter((entry) => overlaps(candidate, entry))
    .sort((a, b) => a.start.getTime() - b.start.getTime())
}

/** Le premier rendez-vous heurté, s'il y en a un. C'est lui qui bloque. */
export function blockingConflict(conflicts: BusyEntry[]): BusyEntry | null {
  return conflicts.find((entry) => entry.kind === 'appointment') ?? null
}

/**
 * Tous les rendez-vous heurtés — c'est-à-dire tout ce qui justifie de s'arrêter et de
 * demander. Les activités qui tombent en même temps n'y figurent pas : elles se disent,
 * elles n'arrêtent rien. Une liste vide veut donc dire « on peut inscrire ».
 */
export function blockingConflicts(conflicts: BusyEntry[]): BusyEntry[] {
  return conflicts.filter((entry) => entry.kind === 'appointment')
}

/** « Rendez-vous avec le psychiatre, de 10h00 à 10h30 ». */
export function describeConflict(entry: BusyEntry): string {
  return `${entry.label}, de ${formatTime(entry.start)} à ${formatTime(entry.end)}`
}

/**
 * Ce qu'on dit à un patient qui s'inscrit seul. `null` quand rien ne gêne.
 *
 * Un rendez-vous bloque ; le message dit lequel, et quoi faire — parler à un soignant,
 * qui pourra déplacer l'un ou l'autre. Une activité ne bloque pas : on prévient.
 */
export function patientConflictNotice(
  conflicts: BusyEntry[],
): { blocking: true; message: string } | { blocking: false; message: string } | null {
  if (conflicts.length === 0) return null
  const rendezVous = blockingConflict(conflicts)
  if (rendezVous !== null) {
    return {
      blocking: true,
      // Surtout pas de minuscule forcée : le libellé porte un nom propre, et
      // « rendez-vous avec docteur lemaire » se lit comme une faute.
      message: `Vous avez déjà quelque chose à ce moment-là : ${describeConflict(rendezVous)}. Parlez-en à un soignant si vous préférez venir à l’activité.`,
    }
  }
  const premier = conflicts[0]!
  return {
    blocking: false,
    message: `Attention : vous êtes déjà inscrit à « ${premier.label} », de ${formatTime(premier.start)} à ${formatTime(premier.end)}. Vous pouvez tout de même vous inscrire.`,
  }
}

/**
 * Ce qu'on dit au soignant qui inscrit quelqu'un. Rien ne l'empêche : il connaît la
 * situation, il peut déplacer le rendez-vous. Mais il doit le savoir avant, pas après.
 */
export function staffConflictWarning(firstName: string, conflicts: BusyEntry[]): string | null {
  if (conflicts.length === 0) return null
  const liste = conflicts.map((entry) => `• ${describeConflict(entry)}`).join('\n')
  const rendezVous = blockingConflict(conflicts)
  const tete =
    rendezVous === null
      ? `${firstName} est déjà pris à ce moment-là :`
      : `${firstName} a un rendez-vous à ce moment-là :`
  return `${tete}\n${liste}\n\nVoulez-vous l’inscrire quand même ?`
}

/**
 * Le jour d'une occurrence, lu dans son identifiant.
 *
 * Les identifiants sont déterministes — `{activityId}_{yyyyMMdd}T{HHmm}` — et cette
 * régularité évite une lecture : pour savoir si deux inscriptions tombent le même jour,
 * il suffit de comparer leurs identifiants. `null` si la forme n'est pas celle-là, ce
 * qui doit rester impossible.
 */
export function localDateOfOccurrenceId(id: string): LocalDate | null {
  const trouve = /_(\d{4})(\d{2})(\d{2})T\d{4}$/.exec(id)
  if (trouve === null) return null
  return `${trouve[1]}-${trouve[2]}-${trouve[3]}`
}
