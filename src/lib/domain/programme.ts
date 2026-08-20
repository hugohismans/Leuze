/**
 * Mise en forme du programme d'une semaine.
 *
 * Le problème à résoudre : deux activités peuvent avoir lieu au même moment. Une grille
 * proportionnelle au temps obligerait à les faire se chevaucher ou à rétrécir les
 * colonnes — illisible sur une feuille A4 comme sur une tablette.
 *
 * La réponse retenue : dans une journée, les activités sont **groupées par heure de
 * début**. Un seul repère horaire, et sous lui, une ou plusieurs activités. Deux
 * activités simultanées se lisent alors d'un coup d'œil, sans calcul, et c'est aussi
 * la façon dont le programme est écrit à la main sur le tableau papier aujourd'hui.
 */
import { isVisibleToService } from './audience'
import { formatTime } from './time'
import type { LocalDate, Occurrence } from './types'

export type TimeGroup = {
  /** Heure de début, telle qu'affichée : « 14h00 ». */
  label: string
  occurrences: Occurrence[]
}

export type DayProgramme = {
  date: LocalDate
  groups: TimeGroup[]
  /** Vrai si au moins deux activités partagent un créneau, ce jour-là. */
  hasSimultaneous: boolean
}

export function groupByStartTime(occurrences: Occurrence[]): TimeGroup[] {
  const groups = new Map<string, Occurrence[]>()
  for (const occurrence of [...occurrences].sort((a, b) => a.start.getTime() - b.start.getTime())) {
    const label = formatTime(occurrence.start)
    const existing = groups.get(label)
    if (existing) existing.push(occurrence)
    else groups.set(label, [occurrence])
  }
  return [...groups.entries()].map(([label, items]) => ({ label, occurrences: items }))
}

/**
 * Programme d'une semaine, éventuellement restreint à un service.
 * `serviceId` à `null` = tout le programme (vue du personnel).
 */
export function weekProgramme(
  days: LocalDate[],
  occurrences: Occurrence[],
  serviceId: string | null = null,
): DayProgramme[] {
  return days.map((date) => {
    const duJour = occurrences.filter(
      (o) => o.localDate === date && (serviceId === null || isVisibleToService(o, serviceId)),
    )
    const groups = groupByStartTime(duJour)
    return {
      date,
      groups,
      hasSimultaneous: groups.some((g) => g.occurrences.length > 1),
    }
  })
}

/** Nombre d'activités de la semaine — sert à dire « rien cette semaine » sans ambiguïté. */
export function programmeCount(programme: DayProgramme[]): number {
  return programme.reduce((total, jour) => total + jour.groups.reduce((n, g) => n + g.occurrences.length, 0), 0)
}
