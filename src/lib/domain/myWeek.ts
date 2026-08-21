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
      locationId?: string
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
      ...(appointment.withWhom !== undefined ? { withWhom: appointment.withWhom } : {}),
      ...(appointment.locationId !== undefined ? { locationId: appointment.locationId } : {}),
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
