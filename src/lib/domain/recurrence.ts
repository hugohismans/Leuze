import type { Activity, LocalDate, LocalTime, Occurrence } from './types'
import { addLocalDays, addMinutes, instantOf, isoWeekdayOf, localDatesBetween } from './time'

/** Fenêtre glissante de matérialisation des occurrences. */
export const GENERATION_WINDOW_WEEKS = 12

/**
 * Identifiant déterministe d'une occurrence : `{activityId}_{yyyyMMdd}T{HHmm}`.
 * Conséquence : régénérer deux fois la même fenêtre ne crée jamais de doublon,
 * et une occurrence modifiée isolément reste identifiable sans registre d'exceptions.
 */
export function occurrenceId(activityId: string, localDate: LocalDate, startTime: LocalTime): string {
  return `${activityId}_${localDate.replaceAll('-', '')}T${startTime.replace(':', '')}`
}

function draftFrom(activity: Activity, localDate: LocalDate, startTime: LocalTime, durationMin: number): Occurrence {
  const start = instantOf(localDate, startTime)
  return {
    id: occurrenceId(activity.id, localDate, startTime),
    activityId: activity.id,
    seriesId: activity.seriesId,
    start,
    end: addMinutes(start, durationMin),
    localDate,
    title: activity.title,
    description: activity.description,
    categoryId: activity.categoryId,
    locationId: activity.locationId,
    ...(activity.facilitator === undefined ? {} : { facilitator: activity.facilitator }),
    capacity: activity.capacity,
    registrationRequired: activity.registrationRequired,
    waitlistEnabled: activity.waitlistEnabled,
    status: 'scheduled',
    overridden: false,
    confirmedCount: 0,
    waitlistCount: 0,
  }
}

/**
 * Déplie une activité en occurrences sur la fenêtre [from, to] (dates locales incluses).
 * Fonction pure : c'est elle que la Cloud Function de génération appelle.
 */
export function expand(activity: Activity, from: LocalDate, to: LocalDate): Occurrence[] {
  if (!activity.isActive) return []

  if (activity.recurrence === null) {
    const single = activity.singleStart
    if (!single) return []
    if (single.date < from || single.date > to) return []
    return [draftFrom(activity, single.date, single.time, single.durationMin)]
  }

  const rule = activity.recurrence
  const start = rule.from > from ? rule.from : from
  const end = rule.until !== null && rule.until < to ? rule.until : to
  if (start > end) return []

  const weekdays = new Set(rule.byWeekday)
  const skipped = new Set(rule.skipDates)

  return localDatesBetween(start, end)
    .filter((date) => weekdays.has(isoWeekdayOf(date)) && !skipped.has(date))
    .map((date) => draftFrom(activity, date, rule.startTime, rule.durationMin))
}

export type MergePlan = {
  /** Occurrences à créer. */
  create: Occurrence[]
  /** Occurrences existantes à rafraîchir (champs dénormalisés mis à jour). */
  update: Occurrence[]
  /** Occurrences laissées intactes parce qu'un soignant les a modifiées isolément. */
  preserved: Occurrence[]
  /** Occurrences devenues hors série mais portant des inscriptions : annulées, pas supprimées. */
  cancel: Occurrence[]
  /** Occurrences devenues hors série et sans inscription : supprimables. */
  remove: string[]
}

export type MergeOptions = {
  /**
   * Date à partir de laquelle les modifications écrasent aussi les occurrences
   * modifiées isolément (choix « cette occurrence et les suivantes »).
   */
  overrideFrom?: LocalDate
}

const hasRegistrations = (o: Occurrence) => o.confirmedCount > 0 || o.waitlistCount > 0

/**
 * Rapproche les occurrences théoriques et celles déjà en base sur la même fenêtre.
 * Règle d'or : ne jamais écraser une exception saisie par un soignant, ni faire
 * disparaître une occurrence sur laquelle des patients sont inscrits.
 */
export function mergeOccurrences(
  drafts: Occurrence[],
  existing: Occurrence[],
  options: MergeOptions = {},
): MergePlan {
  const plan: MergePlan = { create: [], update: [], preserved: [], cancel: [], remove: [] }
  const byId = new Map(existing.map((o) => [o.id, o]))
  const draftIds = new Set(drafts.map((d) => d.id))

  for (const draft of drafts) {
    const current = byId.get(draft.id)
    if (!current) {
      plan.create.push(draft)
      continue
    }
    const forced = options.overrideFrom !== undefined && draft.localDate >= options.overrideFrom
    if (current.overridden && !forced) {
      plan.preserved.push(current)
      continue
    }
    plan.update.push({
      ...draft,
      // L'état vécu de l'occurrence n'appartient pas à la série.
      status: forced ? 'scheduled' : current.status,
      ...(current.cancellationReason !== undefined && !forced
        ? { cancellationReason: current.cancellationReason }
        : {}),
      overridden: forced ? false : current.overridden,
      confirmedCount: current.confirmedCount,
      waitlistCount: current.waitlistCount,
    })
  }

  for (const current of existing) {
    if (draftIds.has(current.id)) continue
    if (hasRegistrations(current)) {
      if (current.status === 'cancelled') {
        plan.preserved.push(current)
      } else {
        plan.cancel.push({
          ...current,
          status: 'cancelled',
          cancellationReason: current.cancellationReason ?? "L'activité a été modifiée",
        })
      }
    } else {
      plan.remove.push(current.id)
    }
  }

  return plan
}

export type SeriesEdit = Partial<
  Pick<
    Activity,
    | 'title'
    | 'description'
    | 'categoryId'
    | 'locationId'
    | 'facilitator'
    | 'capacity'
    | 'registrationRequired'
    | 'waitlistEnabled'
    | 'recurrence'
  >
>

/**
 * « Cette occurrence et les suivantes » : la série en cours est close la veille,
 * une nouvelle activité prend le relais à partir de `fromDate`. Les occurrences
 * passées ne bougent pas — c'est le comportement d'un calendrier classique.
 */
export function splitSeries(
  activity: Activity,
  fromDate: LocalDate,
  edit: SeriesEdit,
  newActivityId: string,
): { previous: Activity; next: Activity } {
  if (activity.recurrence === null) {
    throw new Error("Seule une activité récurrente peut être scindée")
  }
  const previous: Activity = {
    ...activity,
    recurrence: { ...activity.recurrence, until: addLocalDays(fromDate, -1) },
  }
  const baseRecurrence = edit.recurrence ?? activity.recurrence
  const next: Activity = {
    ...activity,
    ...edit,
    id: newActivityId,
    seriesId: activity.seriesId,
    recurrence: baseRecurrence === null ? null : { ...baseRecurrence, from: fromDate, until: activity.recurrence.until },
  }
  return { previous, next }
}

/**
 * Annulation en série (congé de l'animateur, travaux) : les occurrences restent
 * visibles et barrées, avec le motif. Jamais de suppression.
 */
export function cancelRange(
  occurrences: Occurrence[],
  from: LocalDate,
  to: LocalDate,
  reason: string,
): Occurrence[] {
  return occurrences
    .filter((o) => o.localDate >= from && o.localDate <= to && o.status !== 'cancelled')
    .map((o) => ({ ...o, status: 'cancelled' as const, cancellationReason: reason, overridden: true }))
}
