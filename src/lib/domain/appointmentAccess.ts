/**
 * Qui voit quel rendez-vous, et qui peut en fixer un.
 *
 * Un rendez-vous individuel est ce que cette application contient de plus sensible. Il
 * ne dit pas pourquoi — le projet s'y refuse — mais il dit avec qui, et « avec le
 * psychiatre » en apprend déjà beaucoup sur quelqu'un. La liste complète n'a donc rien à
 * faire sous les yeux de toute l'équipe.
 *
 * Deux règles, et pas une de plus :
 *
 * 1. **Un intervenant voit son agenda, et rien d'autre.** Ce qui le concerne
 *    directement : les rendez-vous où c'est lui qu'on vient voir.
 * 2. **Il ne fixe de rendez-vous que pour lui-même.** Il choisit la personne, le jour,
 *    l'heure et le lieu ; il ne choisit pas le professionnel — c'est lui.
 *
 * L'administrateur voit tout et fixe pour n'importe qui : c'est lui qui répartit les
 * demandes, et quelqu'un doit pouvoir le faire.
 *
 * Une demande encore en attente ne nomme personne : elle ne concerne donc aucun
 * intervenant en particulier, et seul l'administrateur la voit tant qu'elle n'est pas
 * attribuée.
 *
 * Rien ici n'accorde de droit : les règles Firestore appliquent la même chose sur le
 * jeton. Ceci ne fait qu'accorder l'interface.
 */

export type AppointmentViewer = {
  role: 'staff' | 'admin' | null
  /** L'intervenant auquel ce compte est relié. Sans lui, pas d'agenda du tout. */
  practitionerId?: string | null
}

type SeenAppointment = {
  status: 'requested' | 'scheduled' | 'cancelled'
  practitionerId?: string
}

/** L'administrateur répartit les demandes : il lui faut la vue d'ensemble. */
export function seesEveryAppointment(viewer: AppointmentViewer): boolean {
  return viewer.role === 'admin'
}

/** Vrai quand ce rendez-vous concerne directement la personne qui regarde. */
export function concernsViewer(viewer: AppointmentViewer, appointment: SeenAppointment): boolean {
  if (seesEveryAppointment(viewer)) return true
  if (viewer.role !== 'staff') return false
  const lien = viewer.practitionerId
  if (lien === undefined || lien === null || lien === '') return false
  // Une demande en attente ne nomme encore personne.
  return appointment.practitionerId === lien
}

export function visibleAppointments<T extends SeenAppointment>(
  viewer: AppointmentViewer,
  appointments: T[],
): T[] {
  if (seesEveryAppointment(viewer)) return appointments
  return appointments.filter((appointment) => concernsViewer(viewer, appointment))
}

/** Peut-on fixer un rendez-vous au nom de cet intervenant ? */
export function canScheduleAs(viewer: AppointmentViewer, practitionerId: string | null): boolean {
  if (seesEveryAppointment(viewer)) return true
  if (viewer.role !== 'staff') return false
  const lien = viewer.practitionerId
  if (lien === undefined || lien === null || lien === '') return false
  return practitionerId === lien
}

/**
 * Ce que l'écran explique, en une phrase. `null` quand il n'y a rien à expliquer —
 * l'administrateur voit tout, et n'a pas besoin qu'on le lui dise.
 */
export function appointmentAccessNotice(viewer: AppointmentViewer): string | null {
  if (seesEveryAppointment(viewer)) return null
  if (viewer.role !== 'staff') return 'Cet écran est réservé au personnel soignant.'
  const lien = viewer.practitionerId
  if (lien === undefined || lien === null || lien === '') {
    return "Votre compte n'est relié à aucune personne du personnel : vous n'avez pas d'agenda. Demandez à un administrateur de faire le lien."
  }
  return 'Vous voyez vos rendez-vous, et vous en fixez pour vous. Ceux de vos collègues ne vous regardent pas.'
}
