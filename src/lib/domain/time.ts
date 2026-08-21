import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'
import type { IsoWeekday, LocalDate, LocalTime } from './types'

/** Tout le métier raisonne dans ce fuseau. Jamais `getDay()` sur un instant UTC. */
export const TIME_ZONE = 'Europe/Brussels'

const pad = (n: number) => String(n).padStart(2, '0')

function parts(localDate: LocalDate): { y: number; m: number; d: number } {
  const [y, m, d] = localDate.split('-').map(Number)
  if (!y || !m || !d) throw new Error(`Date locale invalide : ${localDate}`)
  return { y, m, d }
}

/** Date « calendaire » en heure système, utilisée uniquement pour le formatage. */
function calendarDate(localDate: LocalDate): Date {
  const { y, m, d } = parts(localDate)
  return new Date(y, m - 1, d, 12, 0, 0, 0)
}

export function isValidLocalDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

/** Jour local d'un instant, dans le fuseau de l'hôpital. */
export function localDateOf(instant: Date): LocalDate {
  return formatInTimeZone(instant, TIME_ZONE, 'yyyy-MM-dd')
}

/**
 * Convertit une heure murale locale en instant.
 * « Mardi 14h00 » reste 14h00 avant et après le changement d'heure.
 */
export function instantOf(localDate: LocalDate, time: LocalTime): Date {
  return fromZonedTime(`${localDate}T${time}:00`, TIME_ZONE)
}

/** L'heure locale d'un instant, « 14:00 » — celle qu'on écrit dans une plage horaire. */
export function localTimeOf(instant: Date): LocalTime {
  return formatInTimeZone(instant, TIME_ZONE, 'HH:mm') as LocalTime
}

export function addMinutes(instant: Date, minutes: number): Date {
  return new Date(instant.getTime() + minutes * 60_000)
}

/** Arithmétique calendaire pure, insensible au changement d'heure. */
export function addLocalDays(localDate: LocalDate, days: number): LocalDate {
  const { y, m, d } = parts(localDate)
  const shifted = new Date(Date.UTC(y, m - 1, d) + days * 86_400_000)
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`
}

export function addLocalMonths(localDate: LocalDate, months: number): LocalDate {
  const { y, m, d } = parts(localDate)
  const target = new Date(Date.UTC(y, m - 1 + months, 1))
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  return `${target.getUTCFullYear()}-${pad(target.getUTCMonth() + 1)}-${pad(Math.min(d, lastDay))}`
}

/** 1 = lundi … 7 = dimanche. */
export function isoWeekdayOf(localDate: LocalDate): IsoWeekday {
  const { y, m, d } = parts(localDate)
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return (day === 0 ? 7 : day) as IsoWeekday
}

/** La semaine commence le lundi. */
export function startOfIsoWeek(localDate: LocalDate): LocalDate {
  return addLocalDays(localDate, -(isoWeekdayOf(localDate) - 1))
}

export function startOfLocalMonth(localDate: LocalDate): LocalDate {
  const { y, m } = parts(localDate)
  return `${y}-${pad(m)}-01`
}

export function endOfLocalMonth(localDate: LocalDate): LocalDate {
  const { y, m } = parts(localDate)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return `${y}-${pad(m)}-${pad(last)}`
}

/** Les 7 dates de la semaine contenant `localDate`, du lundi au dimanche. */
export function weekDays(localDate: LocalDate): LocalDate[] {
  const monday = startOfIsoWeek(localDate)
  return Array.from({ length: 7 }, (_, i) => addLocalDays(monday, i))
}

/** Grille du mois : semaines complètes (lundi → dimanche) englobant le mois. */
export function monthGrid(localDate: LocalDate): LocalDate[][] {
  const first = startOfLocalMonth(localDate)
  const last = endOfLocalMonth(localDate)
  const weeks: LocalDate[][] = []
  let cursor = startOfIsoWeek(first)
  do {
    weeks.push(weekDays(cursor))
    cursor = addLocalDays(cursor, 7)
  } while (cursor <= last)
  return weeks
}

export function localDatesBetween(from: LocalDate, to: LocalDate): LocalDate[] {
  const out: LocalDate[] = []
  for (let d = from; d <= to; d = addLocalDays(d, 1)) out.push(d)
  return out
}

export function todayLocalDate(now: Date = new Date()): LocalDate {
  return localDateOf(now)
}

// --- Formatage destiné aux patients : français simple, pas d'abréviation ---

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** « Mardi 12 août ». */
export function formatDayLabel(localDate: LocalDate): string {
  return capitalize(format(calendarDate(localDate), 'EEEE d MMMM', { locale: fr }))
}

/** « Mardi 12 août 2025 ». */
export function formatLongDayLabel(localDate: LocalDate): string {
  return capitalize(format(calendarDate(localDate), 'EEEE d MMMM yyyy', { locale: fr }))
}

/** « Mardi ». */
export function formatWeekdayLabel(localDate: LocalDate): string {
  return capitalize(format(calendarDate(localDate), 'EEEE', { locale: fr }))
}

/** « Août 2025 ». */
export function formatMonthLabel(localDate: LocalDate): string {
  return capitalize(format(calendarDate(localDate), 'MMMM yyyy', { locale: fr }))
}

export function formatDayNumber(localDate: LocalDate): string {
  return String(parts(localDate).d)
}

/** « 14h00 » — jamais « 14:00 ». */
export function formatTime(instant: Date): string {
  return formatInTimeZone(instant, TIME_ZONE, "HH'h'mm")
}

/** « 14h00 → 15h30 ». */
export function formatTimeRange(start: Date, end: Date): string {
  return `${formatTime(start)} → ${formatTime(end)}`
}

/** « Mardi 12 août, de 14h00 à 15h30 ». */
export function formatFullWhen(localDate: LocalDate, start: Date, end: Date): string {
  return `${formatDayLabel(localDate)}, de ${formatTime(start)} à ${formatTime(end)}`
}

/** « une heure trente » n'apporte rien : on reste sur « 1 h 30 ». */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m} minutes`
  if (m === 0) return h === 1 ? '1 heure' : `${h} heures`
  return `${h} h ${pad(m)}`
}
