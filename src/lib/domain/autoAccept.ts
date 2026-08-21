/**
 * L'acceptation automatique des demandes de rendez-vous.
 *
 * Une demande ne porte ni jour ni heure : le patient dit **qui** il veut voir, et
 * seulement s'il préfère le matin ou l'après-midi. Aujourd'hui, quelqu'un doit ouvrir la
 * file, regarder un agenda et fixer. C'est un travail réel, et une demande peut y dormir
 * plusieurs jours.
 *
 * Une personne qui reçoit à heures fixes peut donc décider que ses demandes se placent
 * toutes seules : la première place libre dans ses plages est retenue, et le patient a sa
 * réponse tout de suite au lieu d'attendre sans savoir. C'est un choix, jamais un défaut :
 * on n'impose pas un rendez-vous à l'agenda de quelqu'un qui ne l'a pas demandé.
 *
 * Trois précautions.
 *
 * **Jamais aujourd'hui.** Un rendez-vous posé dans deux heures, sans que personne l'ait
 * dit de vive voix, est un rendez-vous manqué. La recherche commence le lendemain.
 *
 * **La préférence d'abord, mais pas au prix du délai.** On cherche d'abord une place au
 * moment souhaité ; si le matin est plein trois semaines durant, on propose l'après-midi
 * plutôt que rien — en le disant.
 *
 * **Rien n'est verrouillé.** Le rendez-vous fixé automatiquement est un rendez-vous
 * ordinaire : il se déplace, il s'annule avec un motif, comme tous les autres.
 */
import { suggestSlot, type Suggestion } from './agenda'
import { instantOf } from './time'
import type { BusyEntry } from './conflicts'
import type { AppointmentPreference, AvailabilityWindow, LocalDate, LocalTime } from './types'

/** Un créneau déjà pris dans l'agenda de la personne. */
export type BusySlot = { localDate: LocalDate; from: LocalTime; to: LocalTime }

export type SlotSearch = {
  windows: AvailabilityWindow[]
  busy: BusySlot[]
  preference: AppointmentPreference
  /** Premier jour envisagé — le lendemain de la demande, jamais le jour même. */
  from: LocalDate
  /** Nombre de jours regardés. Au-delà, mieux vaut qu'un humain s'en occupe. */
  horizonDays: number
  durationMin: number
  /** Pas de la recherche, en minutes. Quinze : l'agenda reste lisible. */
  stepMin?: number
}

export type FoundSlot = Suggestion

/** La durée d'un rendez-vous placé automatiquement. Elle se modifie ensuite à la main. */
export const AUTO_DURATION_MIN = 30

/** L'horizon de recherche : trois semaines. Au-delà, la place n'est plus une réponse. */
export const AUTO_HORIZON_DAYS = 21

/**
 * Un créneau pris, tel que l'agenda le comprend.
 *
 * Une heure illisible ne peut rien libérer : la journée entière est alors tenue pour
 * occupée. Mieux vaut ne pas proposer de rendez-vous que d'en poser un par-dessus une
 * donnée qu'on ne sait pas lire.
 */
function enIntervalle(pris: BusySlot): BusyEntry {
  const debut = instantOf(pris.localDate, pris.from)
  const fin = instantOf(pris.localDate, pris.to)
  const lisible = !Number.isNaN(debut.getTime()) && !Number.isNaN(fin.getTime()) && debut < fin
  return {
    start: lisible ? debut : instantOf(pris.localDate, '00:00'),
    end: lisible ? fin : instantOf(pris.localDate, '23:59'),
    label: 'Occupé',
    kind: 'appointment',
  }
}

/**
 * La première place libre, ou `null` s'il n'y en a aucune dans l'horizon.
 *
 * La recherche elle-même vit dans `agenda.ts`, où elle sert aussi à proposer un créneau
 * au soignant : deux façons de chercher une place donneraient deux réponses différentes
 * à la même question.
 */
export function findFirstSlot(search: SlotSearch): FoundSlot | null {
  return suggestSlot({
    windows: search.windows,
    practitionerBusy: search.busy.map(enIntervalle),
    patientBusy: [],
    preference: search.preference,
    from: search.from,
    horizonDays: search.horizonDays,
    durationMin: search.durationMin,
    ...(search.stepMin === undefined ? {} : { stepMin: search.stepMin }),
  })
}

/**
 * Ce que le patient lit quand sa demande a trouvé une place toute seule. Il doit
 * comprendre en une phrase que c'est fixé, et quand — pas qu'un algorithme est passé par
 * là.
 */
export function autoAcceptMessage(slot: FoundSlot, whenLabel: string, withWhom: string): string {
  const base = `C'est noté : ${whenLabel} avec ${withWhom}.`
  return slot.matchesPreference
    ? base
    : `${base} Ce n'était pas possible au moment que vous souhaitiez ; si cela ne va pas, dites-le à un soignant.`
}
