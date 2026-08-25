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
      /**
       * La séance, pour pouvoir l'ouvrir depuis la feuille.
       *
       * Les personnes qui ont essayé l'application appuyaient sur les lignes de « Ma
       * semaine » et il ne se passait rien : une carte qui ressemble à une carte se
       * touche. C'est cet identifiant qui mène à la fiche.
       */
      occurrenceId: string
      title: string
      locationId: string
      categoryId: string
      cancelled: boolean
      cancellationReason?: string
      /** Vrai quand la personne est sur la liste d'attente et non encore inscrite. */
      waiting: boolean
      /**
       * Vrai quand la personne vient seulement regarder.
       *
       * La ligne est la même — c'est bien à cette heure-là qu'elle sera là — mais elle ne
       * doit pas se lire comme une inscription : on n'attend pas d'elle qu'elle
       * participe, et lui laisser croire le contraire est la meilleure façon de la faire
       * renoncer à venir.
       */
      watching: boolean
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
  status: 'confirmed' | 'waitlist' | 'spectator'
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
      occurrenceId: occurrence.id,
      title: occurrence.title,
      locationId: occurrence.locationId,
      categoryId: occurrence.categoryId,
      cancelled: occurrence.status === 'cancelled',
      ...(occurrence.cancellationReason !== undefined
        ? { cancellationReason: occurrence.cancellationReason }
        : {}),
      waiting: status === 'waitlist',
      watching: status === 'spectator',
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

/**
 * Ce qui, le même jour, tombe en même temps qu'une entrée donnée.
 *
 * « Ma semaine » alignait deux activités de quatorze heures l'une sous l'autre, sans un
 * mot : rien ne disait qu'on ne pouvait pas aller aux deux. Constaté en service — une
 * personne s'est inscrite aux deux, et c'est ici qu'elle aurait dû s'en apercevoir.
 *
 * Ce qui est annulé ne chevauche plus rien : la séance n'aura pas lieu, et la barrer puis
 * l'annoncer comme un conflit serait deux fois faux.
 */
export function clashesWith(entries: WeekEntry[], entry: WeekEntry): WeekEntry[] {
  if (entry.cancelled === true) return []
  return entries.filter(
    (autre) =>
      autre !== entry &&
      autre.cancelled !== true &&
      entry.start.getTime() < autre.end.getTime() &&
      autre.start.getTime() < entry.end.getTime(),
  )
}

/** Le nom de ce qui tombe en même temps. `null` quand rien ne se chevauche. */
export function clashLabel(
  entries: WeekEntry[],
  entry: WeekEntry,
  appointmentLabel: (kindId: string) => string,
): string | null {
  const autres = clashesWith(entries, entry)
  if (autres.length === 0) return null
  const nomme = (e: WeekEntry): string =>
    e.kind === 'activity' ? e.title : `Rendez-vous avec ${e.withWhom ?? appointmentLabel(e.kindId)}`
  if (autres.length === 1) return `En même temps que « ${nomme(autres[0]!)} »`
  return `En même temps que ${autres.length} autres choses`
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
