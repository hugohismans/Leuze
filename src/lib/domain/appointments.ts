/**
 * Rendez-vous individuels : demande par le patient, mise à l'agenda par un soignant.
 *
 * Fonctions pures, comme le reste du domaine. Ce module ne décide de rien de clinique :
 * il ne connaît que des états, des dates et des libellés.
 */
import { formatFullWhen, formatLongDayLabel } from './time'
import type { Appointment, AppointmentKind, AppointmentPreference } from './types'

export const PREFERENCE_LABELS: Record<AppointmentPreference, string> = {
  matin: 'Plutôt le matin',
  'apres-midi': "Plutôt l'après-midi",
  'peu-importe': 'Peu importe le moment',
}

export function kindName(kinds: AppointmentKind[], kindId: string): string {
  return kinds.find((k) => k.id === kindId)?.name ?? 'Un professionnel'
}

export function kindIcon(kinds: AppointmentKind[], kindId: string): string {
  return kinds.find((k) => k.id === kindId)?.icon ?? '📅'
}

/**
 * Ce que le patient lit sur sa demande. Toujours dire où l'on en est, sans jamais
 * promettre un délai que personne ne peut tenir.
 */
export function patientStatusLabel(appointment: Appointment, kinds: AppointmentKind[]): string {
  const qui = kindName(kinds, appointment.kindId)
  switch (appointment.status) {
    case 'requested':
      return `Demande envoyée pour voir ${qui.toLowerCase()}. Un soignant vous dira quand.`
    case 'scheduled':
      return appointment.localDate && appointment.start && appointment.end
        ? `${formatFullWhen(appointment.localDate, appointment.start, appointment.end)} avec ${appointment.withWhom ?? qui.toLowerCase()}`
        : `Rendez-vous fixé avec ${qui.toLowerCase()}`
    case 'cancelled':
      return appointment.cancellationReason
        ? `Rendez-vous annulé — ${appointment.cancellationReason}`
        : 'Rendez-vous annulé. Un soignant peut vous en proposer un autre.'
  }
}

/** Libellé court pour la file des demandes, côté soignant. */
export function staffRequestLabel(appointment: Appointment, kinds: AppointmentKind[]): string {
  return appointment.status === 'scheduled' && appointment.localDate
    ? `${kindName(kinds, appointment.kindId)} — ${formatLongDayLabel(appointment.localDate)}`
    : kindName(kinds, appointment.kindId)
}

/**
 * Depuis combien de jours la demande attend. Une demande qui traîne doit se voir :
 * c'est la seule chose qui protège d'un oubli, faute de notification.
 */
export function waitingDays(appointment: Appointment, now: Date = new Date()): number {
  const jours = Math.floor((now.getTime() - appointment.createdAt.getTime()) / 86_400_000)
  return jours < 0 ? 0 : jours
}

export function waitingLabel(days: number): string {
  if (days === 0) return "Demandé aujourd'hui"
  if (days === 1) return 'Demandé hier'
  return `En attente depuis ${days} jours`
}

/** Les demandes en attente, les plus anciennes d'abord — c'est l'ordre à traiter. */
export function pendingFirst(appointments: Appointment[]): Appointment[] {
  return [...appointments]
    .filter((a) => a.status === 'requested')
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
}

/**
 * Le prochain rendez-vous fixé, ou `null`. C'est la seule chose qu'un patient a besoin
 * de voir en arrivant : ce qui l'attend, pas la liste de ce qui est passé.
 */
export function nextScheduled<T extends { status: string; start?: Date }>(
  appointments: T[],
  now: Date = new Date(),
): T | null {
  return (
    appointments
      .filter((a) => a.status === 'scheduled' && a.start !== undefined && a.start.getTime() >= now.getTime())
      .sort((a, b) => (a.start?.getTime() ?? 0) - (b.start?.getTime() ?? 0))[0] ?? null
  )
}
