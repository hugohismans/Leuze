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
/**
 * L'intitulé d'un motif, tel qu'il se glisse au milieu d'une phrase.
 *
 * Les motifs du catalogue portent leur article — « Le psychiatre », « L'assistant
 * social » — parce qu'ils s'affichent aussi seuls, en tête de liste. Au milieu d'une
 * phrase ils passent en minuscule. Un intitulé saisi sans article donnait « Demande
 * envoyée pour voir autre » : quand il n'y a rien à insérer proprement, la phrase se
 * passe du nom plutôt que de mal l'écrire.
 */
function dansLaPhrase(nom: string): string | null {
  const propre = nom.trim()
  if (propre === '') return null
  const minuscule = propre.charAt(0).toLocaleLowerCase('fr') + propre.slice(1)
  return /^(le |la |l’|l'|les |un |une |des )/.test(minuscule) ? minuscule : null
}

export function patientStatusLabel(appointment: Appointment, kinds: AppointmentKind[]): string {
  const qui = kindName(kinds, appointment.kindId)
  const nomme = dansLaPhrase(qui)
  switch (appointment.status) {
    case 'requested':
      /*
        Une date qui disparaît sans un mot passe pour une panne.

        Le rendez-vous était fixé ; la personne s'est déclarée absente ce jour-là, et la
        demande est retournée dans la file. Le patient n'y est pour rien et n'a rien à
        refaire : on le lui dit, sans dire pourquoi la personne s'absente — cela ne le
        regarde pas, et l'application ne le sait pas.
      */
      if (appointment.reopenedForLeave === true) {
        return nomme === null
          ? 'La personne que vous deviez voir sera absente ce jour-là. Votre demande est de nouveau en attente : un soignant vous dira quand.'
          : `La personne que vous deviez voir sera absente ce jour-là. Votre demande pour voir ${nomme} est de nouveau en attente : un soignant vous dira quand.`
      }
      return nomme === null
        ? 'Demande envoyée. Un soignant vous dira quand.'
        : `Demande envoyée pour voir ${nomme}. Un soignant vous dira quand.`
    case 'scheduled':
      return appointment.localDate && appointment.start && appointment.end
        ? `${formatFullWhen(appointment.localDate, appointment.start, appointment.end)} avec ${appointment.withWhom ?? nomme ?? qui}`
        : `Rendez-vous fixé avec ${appointment.withWhom ?? nomme ?? qui}`
    case 'cancelled':
      return appointment.cancellationReason
        ? `Rendez-vous annulé — ${appointment.cancellationReason}`
        : 'Rendez-vous annulé. Un soignant peut vous en proposer un autre.'
  }
}

/**
 * Le nom à écrire pour un rendez-vous, côté soignant.
 *
 * Un rendez-vous concerne un patient de l'hôpital — on lit alors son prénom dans la
 * liste du personnel — ou une personne extérieure, qui n'a pas de compte et dont le
 * prénom voyage avec le rendez-vous lui-même.
 *
 * La fonction existe parce que la question se pose partout : dans la file, dans les
 * rendez-vous à venir, dans le planning imprimé. Trois façons d'y répondre finiraient
 * par se contredire, et c'est un nom affiché à la mauvaise personne.
 */
export function appointmentWho(
  appointment: Pick<Appointment, 'patientUid' | 'externalName'>,
  firstNameOf: (patientUid: string) => string | undefined,
): string {
  if (appointment.patientUid !== undefined && appointment.patientUid !== '') {
    return firstNameOf(appointment.patientUid) ?? 'Prénom inconnu'
  }
  const externe = appointment.externalName?.trim() ?? ''
  // « Personne extérieure » sans prénom vaut mieux qu'un vide : la ligne reste lisible,
  // et l'on comprend au moins de quel genre de rendez-vous il s'agit.
  return externe === '' ? 'Personne extérieure' : externe
}

/** Vrai quand le rendez-vous concerne quelqu'un qui n'est pas hospitalisé ici. */
export function isExternal(appointment: Pick<Appointment, 'patientUid'>): boolean {
  return appointment.patientUid === undefined || appointment.patientUid === ''
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
 * Les rendez-vous fixés qui restent à venir, dans l'ordre.
 *
 * « Mes inscriptions » répond à « qu'est-ce que j'ai de prévu » : un rendez-vous
 * d'avant-hier y répond faux. Un rendez-vous compte jusqu'à sa fin — celui de 9h30 se
 * lit encore à 9h45, pendant qu'on y est.
 */
export function upcomingScheduled<T extends { status: string; start?: Date; end?: Date }>(
  appointments: T[],
  now: Date = new Date(),
): T[] {
  return appointments
    .filter((a) => a.status === 'scheduled' && a.start !== undefined)
    .filter((a) => (a.end ?? a.start)!.getTime() >= now.getTime())
    .sort((a, b) => (a.start?.getTime() ?? 0) - (b.start?.getTime() ?? 0))
}

/**
 * Les rendez-vous fixés déjà passés, le plus récent en tête.
 *
 * L'écran soignant les mélangeait aux autres, et la liste s'allongeait sans fin : on y
 * cherchait « ce qui est prévu » au milieu de ce qui avait déjà eu lieu. Ils ne
 * disparaissent pas pour autant — un rendez-vous manqué se retrouve, et savoir quand
 * quelqu'un a vu le psychiatre pour la dernière fois a son utilité. Ils sont seulement
 * rangés derrière une case à cocher.
 *
 * Un rendez-vous compte jusqu'à sa fin : celui de 9h30 n'est pas « passé » à 9h45.
 */
export function pastScheduled<T extends { status: string; start?: Date; end?: Date }>(
  appointments: T[],
  now: Date = new Date(),
): T[] {
  return appointments
    .filter((a) => a.status === 'scheduled' && a.start !== undefined)
    .filter((a) => (a.end ?? a.start)!.getTime() < now.getTime())
    .sort((a, b) => (b.start?.getTime() ?? 0) - (a.start?.getTime() ?? 0))
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

/**
 * Les rendez-vous annulés qu'il faut encore montrer au patient.
 *
 * Une ligne qui disparaît sans un mot passe pour une panne : la personne se souvient
 * d'avoir eu un rendez-vous mardi, l'écran n'en dit plus rien, et elle vient quand même.
 * Un rendez-vous annulé par un soignant reste donc lisible, avec son motif.
 *
 * Deux annulations n'ont pas le même sens :
 * - le patient a retiré sa demande lui-même — il le sait, la ligne s'en va ;
 * - un soignant a annulé — il faut le dire, et dire pourquoi.
 * Le motif d'annulation est ce qui distingue les deux : seul le soignant en écrit un.
 *
 * On ne les garde pas indéfiniment. Un rendez-vous daté s'efface le lendemain de sa
 * date ; une demande annulée avant d'avoir eu une date s'efface au bout de deux semaines,
 * le temps que la personne l'ait lu.
 */
export const CANCELLED_VISIBLE_DAYS = 14

export function cancelledToShow<
  T extends {
    status: string
    localDate?: string
    start?: Date
    createdAt: Date
    cancellationReason?: string
  },
>(appointments: T[], today: string, now: Date = new Date()): T[] {
  const limite = now.getTime() - CANCELLED_VISIBLE_DAYS * 86_400_000
  return appointments
    .filter((a) => a.status === 'cancelled')
    .filter((a) => (a.cancellationReason ?? '').trim() !== '')
    .filter((a) => (a.localDate !== undefined ? a.localDate >= today : a.createdAt.getTime() >= limite))
    .sort((a, b) => {
      const quand = (x: T): number => x.start?.getTime() ?? x.createdAt.getTime()
      return quand(b) - quand(a)
    })
}
