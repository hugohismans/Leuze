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
import { normalizeAvailability, minutesOf, windowsOn } from './availability'
import { addLocalDays, isoWeekdayOf } from './time'
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

export type FoundSlot = {
  localDate: LocalDate
  time: LocalTime
  /** Faux quand le moment de la journée souhaité n'était pas disponible. */
  matchesPreference: boolean
}

/** La durée d'un rendez-vous placé automatiquement. Elle se modifie ensuite à la main. */
export const AUTO_DURATION_MIN = 30

/** L'horizon de recherche : trois semaines. Au-delà, la place n'est plus une réponse. */
export const AUTO_HORIZON_DAYS = 21

const MIDI = 12 * 60

function toTime(minutes: number): LocalTime {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** Le moment de la journée convient-il à ce qui a été demandé ? */
function suitPreference(debut: number, fin: number, preference: AppointmentPreference): boolean {
  if (preference === 'matin') return fin <= MIDI
  if (preference === 'apres-midi') return debut >= MIDI
  return true
}

function chevauche(debut: number, fin: number, occupes: BusySlot[]): boolean {
  return occupes.some((pris) => {
    const d = minutesOf(pris.from)
    const f = minutesOf(pris.to)
    // Un créneau mal formé ne peut rien libérer : on le tient pour occupé toute la journée.
    if (d === null || f === null) return true
    return debut < f && d < fin
  })
}

/**
 * La première place libre, ou `null` s'il n'y en a aucune dans l'horizon. La préférence
 * est tentée d'abord ; à défaut, on repasse sans elle.
 */
export function findFirstSlot(search: SlotSearch): FoundSlot | null {
  const plages = normalizeAvailability(search.windows)
  if (plages.length === 0 || search.durationMin <= 0) return null

  const strict = chercher(search, plages, true)
  if (strict !== null) return strict
  if (search.preference === 'peu-importe') return null
  return chercher(search, plages, false)
}

function chercher(
  search: SlotSearch,
  plages: AvailabilityWindow[],
  respecterLaPreference: boolean,
): FoundSlot | null {
  const pas = search.stepMin ?? 15
  for (let jour = 0; jour < search.horizonDays; jour += 1) {
    const date = addLocalDays(search.from, jour)
    const duJour = windowsOn(plages, isoWeekdayOf(date))
    if (duJour.length === 0) continue
    const occupes = search.busy.filter((pris) => pris.localDate === date)

    for (const plage of duJour) {
      // `minutesOf` a déjà été validé par `normalizeAvailability` : les bornes sont lisibles.
      const ouverture = minutesOf(plage.from)!
      const fermeture = minutesOf(plage.to)!
      for (let debut = ouverture; debut + search.durationMin <= fermeture; debut += pas) {
        const fin = debut + search.durationMin
        if (respecterLaPreference && !suitPreference(debut, fin, search.preference)) continue
        if (chevauche(debut, fin, occupes)) continue
        return { localDate: date, time: toTime(debut), matchesPreference: respecterLaPreference }
      }
    }
  }
  return null
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
