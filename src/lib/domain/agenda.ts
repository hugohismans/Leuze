/**
 * Trouver un créneau qui convienne aux deux.
 *
 * Fixer un rendez-vous demandait de tenir trois choses de tête en même temps : quand la
 * personne reçoit, ce qu'elle a déjà, et ce que le patient a déjà. On ouvrait deux
 * écrans, on comparait des heures, et l'on posait quand même le rendez-vous par-dessus
 * l'atelier cuisine.
 *
 * Ce module répond à la question telle qu'on se la pose : « quand peut-on les mettre
 * ensemble ? » Il croise les plages de l'intervenant, son agenda, celui du patient, et
 * il rend les trous — puis le meilleur d'entre eux, compte tenu du moment souhaité.
 *
 * Il ne lit rien et ne décide d'aucun droit : ce sont des intervalles, rien d'autre.
 */
import { minutesOf, normalizeAvailability, windowsOn } from './availability'
import { addLocalDays, instantOf, isoWeekdayOf } from './time'
import type { AppointmentPreference, AvailabilityWindow, LocalDate, LocalTime } from './types'
import type { BusyEntry } from './conflicts'

/** Un trou : une heure de début, une heure de fin, le même jour. */
export type FreeSlot = { from: LocalTime; to: LocalTime }

/** Ce qu'on affiche pour un jour : la plage annoncée, ce qui est pris, ce qui reste. */
export type AgendaDay = {
  localDate: LocalDate
  windows: AvailabilityWindow[]
  taken: BusyEntry[]
  free: FreeSlot[]
}

const MIDI = 12 * 60

function toTime(minutes: number): LocalTime {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

/** Les minutes occupées ce jour-là, fondues et triées. */
function occupeDuJour(busy: BusyEntry[], localDate: LocalDate): { debut: number; fin: number }[] {
  const jour = instantOf(localDate, '00:00').getTime()
  const finDuJour = jour + 86_400_000
  return busy
    .filter((entry) => entry.end.getTime() > jour && entry.start.getTime() < finDuJour)
    .map((entry) => ({
      debut: Math.max(0, Math.round((entry.start.getTime() - jour) / 60_000)),
      fin: Math.min(1440, Math.round((entry.end.getTime() - jour) / 60_000)),
    }))
    .sort((a, b) => a.debut - b.debut)
}

/**
 * Ce qui reste libre dans les plages d'un jour, une fois retiré ce qui est déjà pris.
 * Les trous plus courts que la durée demandée ne sont pas rendus : ils ne servent à rien.
 */
export function freeSlotsOn(
  windows: AvailabilityWindow[],
  busy: BusyEntry[],
  localDate: LocalDate,
  durationMin: number,
): FreeSlot[] {
  const plages = windowsOn(windows, isoWeekdayOf(localDate))
  if (plages.length === 0) return []
  const pris = occupeDuJour(busy, localDate)

  const trous: FreeSlot[] = []
  for (const plage of plages) {
    // `normalizeAvailability` a validé les bornes : elles sont lisibles.
    let curseur = minutesOf(plage.from)!
    const fermeture = minutesOf(plage.to)!
    for (const creneau of pris) {
      if (creneau.fin <= curseur || creneau.debut >= fermeture) continue
      if (creneau.debut - curseur >= durationMin) {
        trous.push({ from: toTime(curseur), to: toTime(creneau.debut) })
      }
      curseur = Math.max(curseur, creneau.fin)
    }
    if (fermeture - curseur >= durationMin) trous.push({ from: toTime(curseur), to: toTime(fermeture) })
  }
  return trous
}

/**
 * La semaine d'un intervenant, telle qu'on la lit pour poser un rendez-vous : ce qu'il
 * annonce, ce qu'il a déjà, ce qui reste.
 */
/**
 * Une activité peut être dans les deux agendas à la fois : l'intervenant l'anime, et la
 * personne reçue y est inscrite. C'est le même événement, et l'afficher deux fois n'est
 * pas seulement inélégant — c'est faux, cela laisse croire à deux occupations distinctes.
 *
 * Deux entrées sont le même événement quand elles ont les mêmes bornes, la même nature et
 * le même libellé. Rien de plus : deux ateliers différents à la même heure restent deux.
 */
export function dedupeBusy(entries: BusyEntry[]): BusyEntry[] {
  const vues = new Set<string>()
  return entries.filter((entry) => {
    const clef = `${entry.start.getTime()}|${entry.end.getTime()}|${entry.kind}|${entry.label}`
    if (vues.has(clef)) return false
    vues.add(clef)
    return true
  })
}

export function agendaWeek(
  days: LocalDate[],
  windows: AvailabilityWindow[],
  busy: BusyEntry[],
  durationMin: number,
): AgendaDay[] {
  const plages = normalizeAvailability(windows)
  return days.map((localDate) => ({
    localDate,
    windows: windowsOn(plages, isoWeekdayOf(localDate)),
    taken: dedupeBusy(
      busy
        .filter((entry) => {
          const jour = instantOf(localDate, '00:00').getTime()
          return entry.end.getTime() > jour && entry.start.getTime() < jour + 86_400_000
        })
        .sort((a, b) => a.start.getTime() - b.start.getTime()),
    ),
    free: freeSlotsOn(plages, busy, localDate, durationMin),
  }))
}

export type Suggestion = {
  localDate: LocalDate
  time: LocalTime
  /** Faux quand le moment de la journée souhaité n'était pas libre. */
  matchesPreference: boolean
}

export type SuggestionSearch = {
  windows: AvailabilityWindow[]
  /** L'agenda de l'intervenant. */
  practitionerBusy: BusyEntry[]
  /** Celui du patient : activités et rendez-vous confondus. */
  patientBusy: BusyEntry[]
  preference: AppointmentPreference
  from: LocalDate
  horizonDays: number
  durationMin: number
  stepMin?: number
  /**
   * Jusqu'où l'on tient au moment souhaité avant de préférer une date plus proche.
   *
   * Une semaine, par défaut. En deçà, « le matin » est respecté même s'il faut attendre
   * quelques jours ; au-delà, une place jeudi après-midi vaut mieux qu'une place mardi
   * matin dans quinze jours — c'est ce qu'un soignant proposerait de vive voix.
   */
  preferenceWindowDays?: number
}

function convientAuMoment(debut: number, fin: number, preference: AppointmentPreference): boolean {
  if (preference === 'matin') return fin <= MIDI
  if (preference === 'apres-midi') return debut >= MIDI
  return true
}

/**
 * Le premier créneau qui convienne aux deux, ou `null`.
 *
 * La préférence d'abord ; à défaut, on repasse sans elle plutôt que de ne rien proposer —
 * et l'on dit alors que ce n'était pas possible au moment souhaité. Un « je n'ai rien »
 * n'aide personne quand il reste de la place l'après-midi.
 */
export function suggestSlot(search: SuggestionSearch): Suggestion | null {
  const plages = normalizeAvailability(search.windows)
  if (plages.length === 0 || search.durationMin <= 0) return null

  if (search.preference === 'peu-importe') return chercher(search, plages, false, search.horizonDays)

  // Le moment souhaité d'abord, dans la semaine qui vient…
  const fenetre = Math.min(search.preferenceWindowDays ?? 7, search.horizonDays)
  const strict = chercher(search, plages, true, fenetre)
  if (strict !== null) return strict

  // …puis, si l'on n'a rien trouvé, le plus tôt possible, quel que soit le moment.
  return chercher(search, plages, false, search.horizonDays)
}

function chercher(
  search: SuggestionSearch,
  plages: AvailabilityWindow[],
  respecterLaPreference: boolean,
  jours: number,
): Suggestion | null {
  const pas = search.stepMin ?? 15
  const tous = [...search.practitionerBusy, ...search.patientBusy]

  for (let i = 0; i < jours; i += 1) {
    const localDate = addLocalDays(search.from, i)
    for (const trou of freeSlotsOn(plages, tous, localDate, search.durationMin)) {
      const ouverture = minutesOf(trou.from)!
      const fermeture = minutesOf(trou.to)!
      for (let debut = ouverture; debut + search.durationMin <= fermeture; debut += pas) {
        if (respecterLaPreference && !convientAuMoment(debut, debut + search.durationMin, search.preference)) {
          continue
        }
        // Sans moment souhaité, il n'y a rien à manquer : la préférence est respectée
        // par construction.
        return {
          localDate,
          time: toTime(debut),
          matchesPreference: respecterLaPreference || search.preference === 'peu-importe',
        }
      }
    }
  }
  return null
}

/** Ce que l'écran dit du créneau proposé. Le refus d'une préférence se dit, il ne se tait pas. */
export function suggestionMessage(
  suggestion: Suggestion | null,
  preference: AppointmentPreference,
  whenLabel: string,
): string {
  if (suggestion === null) {
    return "Aucun créneau ne convient aux deux dans les trois semaines qui viennent. Vous pouvez tout de même fixer le rendez-vous à l'heure de votre choix."
  }
  if (suggestion.matchesPreference) return `Créneau proposé : ${whenLabel}.`
  const souhaite = preference === 'matin' ? 'le matin' : "l'après-midi"
  return `Rien de libre ${souhaite} dans la semaine qui vient. Créneau proposé : ${whenLabel}.`
}
