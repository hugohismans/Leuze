/**
 * La semaine d'un patient : ses activités et ses rendez-vous, mêlés et remis dans l'ordre.
 *
 * C'est la seule vue qui réunit les deux. Le calendrier commun ne montre jamais un
 * rendez-vous individuel, et la feuille affichée dans l'unité encore moins.
 */
import type { Appointment, LocalDate, Occurrence } from './types'

export type WeekEntry =
  | {
      kind: 'activity'
      start: Date
      end: Date
      title: string
      locationId: string
      categoryId: string
      cancelled: boolean
      cancellationReason?: string
      /** Vrai quand la personne est sur la liste d'attente et non encore inscrite. */
      waiting: boolean
    }
  | {
      kind: 'appointment'
      start: Date
      end: Date
      kindId: string
      /**
       * La personne d'en face : le professionnel sur la feuille du patient, le patient
       * sur celle du professionnel. C'est le même champ, lu des deux côtés.
       */
      withWhom?: string
      /** Pour retrouver le prénom et le service côté soignant. Jamais affiché tel quel. */
      patientUid?: string
      /**
       * Le prénom d'une personne extérieure à l'hôpital, quand le rendez-vous n'est pas
       * celui d'un patient d'ici. Sans lui, la feuille imprimée du soignant n'aurait
       * affiché que le motif — et c'est le nom qu'on y cherche des yeux.
       */
      externalName?: string
      locationId?: string
      /**
       * Le rendez-vous a été annulé.
       *
       * Il reste sur la feuille, barré, comme une séance annulée : la personne se
       * souvenait d'un rendez-vous jeudi, et « Rien de prévu » à sa place se lit comme une
       * panne — ou pire, la fait venir pour rien.
       */
      cancelled?: boolean
      cancellationReason?: string
    }

export type WeekDay = {
  date: LocalDate
  entries: WeekEntry[]
}

type Registration = {
  occurrence: Occurrence
  status: 'confirmed' | 'waitlist'
}

/**
 * Assemble la semaine. Les activités annulées restent visibles : les faire disparaître
 * d'un programme qu'on a peut-être imprimé serait pire que de les barrer.
 */
export function myWeek(
  days: LocalDate[],
  registrations: Registration[],
  appointments: Appointment[],
): WeekDay[] {
  const parJour = new Map<LocalDate, WeekEntry[]>(days.map((date) => [date, []]))

  for (const { occurrence, status } of registrations) {
    const entries = parJour.get(occurrence.localDate)
    if (!entries) continue
    entries.push({
      kind: 'activity',
      start: occurrence.start,
      end: occurrence.end,
      title: occurrence.title,
      locationId: occurrence.locationId,
      categoryId: occurrence.categoryId,
      cancelled: occurrence.status === 'cancelled',
      ...(occurrence.cancellationReason !== undefined
        ? { cancellationReason: occurrence.cancellationReason }
        : {}),
      waiting: status === 'waitlist',
    })
  }

  for (const appointment of appointments) {
    if (appointment.localDate === undefined || appointment.start === undefined || appointment.end === undefined) {
      continue
    }
    const entries = parJour.get(appointment.localDate)
    if (!entries) continue
    entries.push({
      kind: 'appointment',
      start: appointment.start,
      end: appointment.end,
      kindId: appointment.kindId,
      patientUid: appointment.patientUid,
      ...(appointment.externalName !== undefined ? { externalName: appointment.externalName } : {}),
      ...(appointment.withWhom !== undefined ? { withWhom: appointment.withWhom } : {}),
      ...(appointment.locationId !== undefined ? { locationId: appointment.locationId } : {}),
      ...(appointment.status === 'cancelled' ? { cancelled: true } : {}),
      ...(appointment.cancellationReason !== undefined
        ? { cancellationReason: appointment.cancellationReason }
        : {}),
    })
  }

  return days.map((date) => ({
    date,
    entries: (parJour.get(date) ?? []).sort((a, b) => a.start.getTime() - b.start.getTime()),
  }))
}

export function weekEntryCount(week: WeekDay[]): number {
  return week.reduce((total, jour) => total + jour.entries.length, 0)
}

/**
 * Ce que porte une feuille, en toutes lettres.
 *
 * Un décompte seul — « 2 lignes : activités et rendez-vous » — annonçait des rendez-vous
 * même quand il n'y en avait aucun. Un soignant lisait donc qu'une personne en avait un,
 * cherchait sur la feuille imprimée, et n'y trouvait rien : la feuille avait raison,
 * l'étiquette mentait. Elle dit désormais ce qu'il y a, et rien de plus.
 */
export function weekSummary(week: WeekDay[]): string {
  const entries = week.flatMap((jour) => jour.entries)
  const activites = entries.filter((e) => e.kind === 'activity' && !e.cancelled).length
  const annulees = entries.filter((e) => e.kind === 'activity' && e.cancelled).length
  const rendezVous = entries.filter((e) => e.kind === 'appointment').length

  const morceaux: string[] = []
  if (activites > 0) morceaux.push(`${activites} ${activites > 1 ? 'activités' : 'activité'}`)
  // « rendez-vous » ne prend pas de « s » : il en a déjà un.
  if (rendezVous > 0) morceaux.push(`${rendezVous} rendez-vous`)
  if (annulees > 0) morceaux.push(`${annulees} ${annulees > 1 ? 'annulées' : 'annulée'}`)

  if (morceaux.length === 0) return 'Rien de prévu — feuille vierge'
  if (morceaux.length === 1) return morceaux[0] as string
  return `${morceaux.slice(0, -1).join(', ')} et ${morceaux[morceaux.length - 1] as string}`
}
