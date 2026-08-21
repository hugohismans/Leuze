/**
 * Les plages où un intervenant reçoit.
 *
 * Sans elles, fixer un rendez-vous avec le psychiatre revient à deviner : on propose un
 * jeudi à 15h, et l'on apprend le lendemain qu'il n'est là que le mardi matin. Les plages
 * ne sont donc pas un agenda de plus — elles répondent à une seule question, posée au
 * moment où on en a besoin : « est-il là ? »
 *
 * Trois choix délibérés.
 *
 * **Une semaine type, et rien de plus.** Un psychiatre reçoit le mardi matin et le jeudi
 * après-midi ; cela ne change pas d'une semaine sur l'autre. Modéliser les congés, les
 * remplacements et les exceptions demanderait un vrai agenda, que personne ne tiendrait
 * à jour — et un agenda faux est pire que pas d'agenda du tout.
 *
 * **Cela n'interdit rien.** Un hôpital fonctionne à coups d'exceptions : une urgence se
 * cale hors des plages, et l'application n'a pas à s'y opposer. Elle prévient, on décide.
 *
 * **Aucune donnée de santé, ici non plus.** Une plage dit un jour et deux heures. Elle ne
 * dit ni pourquoi la personne est absente, ni ce qu'elle fait le reste du temps.
 */
import type { AvailabilityWindow, IsoWeekday, LocalTime } from './types'

export type { AvailabilityWindow }

const JOURS: Record<IsoWeekday, string> = {
  1: 'Lundi',
  2: 'Mardi',
  3: 'Mercredi',
  4: 'Jeudi',
  5: 'Vendredi',
  6: 'Samedi',
  7: 'Dimanche',
}

/** « 09:00 » → 540. Une heure mal formée vaut `null` : on ne devine pas. */
export function minutesOf(time: LocalTime): number | null {
  const trouve = /^(\d{2}):(\d{2})$/.exec(time)
  if (trouve === null) return null
  const heures = Number(trouve[1])
  const minutes = Number(trouve[2])
  if (heures > 23 || minutes > 59) return null
  return heures * 60 + minutes
}

/** « 09:00 » → « 09h00 ». Jamais « 9:00 » : les deux chiffres se lisent mieux de loin. */
export function formatLocalTime(time: LocalTime): string {
  return time.replace(':', 'h')
}

function valide(fenetre: AvailabilityWindow): boolean {
  const debut = minutesOf(fenetre.from)
  const fin = minutesOf(fenetre.to)
  return debut !== null && fin !== null && debut < fin
}

/**
 * Remet de l'ordre : les plages mal formées ou vides disparaissent, le reste est trié et
 * les chevauchements d'un même jour sont fondus. « Mardi 9h–11h » et « mardi 10h–12h »
 * deviennent « mardi 9h–12h » — c'est ce que la personne voulait dire.
 */
export function normalizeAvailability(windows: AvailabilityWindow[]): AvailabilityWindow[] {
  const propres = windows
    .filter(valide)
    .sort((a, b) => a.weekday - b.weekday || minutesOf(a.from)! - minutesOf(b.from)!)

  const fondues: AvailabilityWindow[] = []
  for (const fenetre of propres) {
    const derniere = fondues[fondues.length - 1]
    // `minutesOf` a déjà été vérifié par `valide` : les deux bornes sont lisibles.
    if (
      derniere !== undefined &&
      derniere.weekday === fenetre.weekday &&
      minutesOf(fenetre.from)! <= minutesOf(derniere.to)!
    ) {
      if (minutesOf(fenetre.to)! > minutesOf(derniere.to)!) derniere.to = fenetre.to
      continue
    }
    fondues.push({ ...fenetre })
  }
  return fondues
}

/** Les plages d'un jour de la semaine, dans l'ordre. */
export function windowsOn(windows: AvailabilityWindow[], weekday: IsoWeekday): AvailabilityWindow[] {
  return normalizeAvailability(windows).filter((fenetre) => fenetre.weekday === weekday)
}

/**
 * Le rendez-vous tient-il **entièrement** dans une plage ? Un rendez-vous qui déborde de
 * dix minutes déborde : c'est le genre de détail qui fait attendre quelqu'un dans un
 * couloir.
 */
export function coversAppointment(
  windows: AvailabilityWindow[],
  weekday: IsoWeekday,
  time: LocalTime,
  durationMin: number,
): boolean {
  const debut = minutesOf(time)
  if (debut === null) return false
  const fin = debut + durationMin
  return windowsOn(windows, weekday).some(
    (fenetre) => minutesOf(fenetre.from)! <= debut && fin <= minutesOf(fenetre.to)!,
  )
}

/**
 * Ce qu'on dit quand le rendez-vous tombe en dehors. `null` quand tout va bien, et aussi
 * quand aucune plage n'est renseignée : on ne reproche pas à quelqu'un de n'avoir rien
 * déclaré.
 */
export function availabilityWarning(
  windows: AvailabilityWindow[],
  weekday: IsoWeekday,
  time: LocalTime,
  durationMin: number,
): string | null {
  if (normalizeAvailability(windows).length === 0) return null
  if (coversAppointment(windows, weekday, time, durationMin)) return null

  const duJour = windowsOn(windows, weekday)
  if (duJour.length === 0) {
    return `Cette personne ne reçoit pas le ${JOURS[weekday].toLowerCase()}. Vous pouvez tout de même fixer le rendez-vous.`
  }
  const quand = duJour.map((f) => `${formatLocalTime(f.from)} → ${formatLocalTime(f.to)}`).join(' et ')
  return `Ce ${JOURS[weekday].toLowerCase()}, cette personne reçoit de ${quand}. Vous pouvez tout de même fixer le rendez-vous.`
}

/** « Mardi de 09h00 à 12h00 · Jeudi de 14h00 à 17h00 ». Vide quand rien n'est renseigné. */
export function availabilityLabel(windows: AvailabilityWindow[]): string {
  return normalizeAvailability(windows)
    .map((f) => `${JOURS[f.weekday]} de ${formatLocalTime(f.from)} à ${formatLocalTime(f.to)}`)
    .join(' · ')
}

/** Le nom du jour, pour les écrans. Il vit ici pour n'être écrit qu'une fois. */
export function weekdayName(weekday: IsoWeekday): string {
  return JOURS[weekday]
}
