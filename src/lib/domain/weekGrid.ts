/**
 * Disposition d'une semaine en grille horaire, pour la feuille imprimée du patient.
 *
 * Contrairement au programme affiché dans l'unité — où deux activités simultanées sont
 * groupées sous un même repère horaire — la feuille personnelle est une vraie grille :
 * les heures en colonne, les jours en ligne, et les activités placées à leur place.
 * Les trous sont voulus : c'est là que la personne écrit à la main ce qu'elle ajoute.
 */
import type { LocalDate } from './types'
import type { WeekDay, WeekEntry } from './myWeek'

export type PlacedEntry = {
  entry: WeekEntry
  /** Rangs de créneaux occupés, à partir de 0 en haut de la grille. */
  fromSlot: number
  toSlot: number
  /** Position quand deux choses se chevauchent : `lane` sur `lanes` colonnes. */
  lane: number
  lanes: number
}

export type GridDay = {
  date: LocalDate
  placed: PlacedEntry[]
}

export type WeekGrid = {
  /** Heures pleines affichées à gauche, de la première à la dernière incluse. */
  hours: number[]
  slotsPerHour: number
  days: GridDay[]
}

const SLOT_MINUTES = 30

/** Heure locale (Bruxelles) d'un instant, en minutes depuis minuit. */
function minutesOfDay(instant: Date): number {
  const [h, m] = new Intl.DateTimeFormat('fr-BE', {
    timeZone: 'Europe/Brussels',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
    .format(instant)
    .split(':')
    .map(Number)
  return (h ?? 0) * 60 + (m ?? 0)
}

/**
 * Plage horaire de la feuille. On part d'une amplitude de confort — 9 h à 18 h — et on
 * l'élargit si une activité tombe en dehors. Jamais l'inverse : une grille qui se
 * resserre autour d'une seule activité ne laisserait pas de place pour écrire.
 */
export function hourRange(week: WeekDay[], confort = { from: 9, to: 18 }): { from: number; to: number } {
  let from = confort.from
  let to = confort.to
  for (const jour of week) {
    for (const entree of jour.entries) {
      from = Math.min(from, Math.floor(minutesOfDay(entree.start) / 60))
      /*
        Minuit en fin d'activité, c'est la fin du jour et non son début.

        `minutesOfDay` rendait 0, la grille ne s'élargissait donc pas, et l'activité était
        posée sous son bord inférieur : sur la feuille imprimée, elle sortait du cadre.
      */
      const finEnMinutes = minutesOfDay(entree.end)
      to = Math.max(to, Math.ceil((finEnMinutes === 0 ? 24 * 60 : finEnMinutes) / 60))
    }
  }
  return { from: Math.max(0, from), to: Math.min(24, Math.max(to, from + 1)) }
}

/**
 * Répartit en colonnes les entrées qui se chevauchent — un rendez-vous pendant une
 * activité, par exemple. Algorithme glouton : chaque entrée prend la première colonne
 * libre à son heure de début.
 */
function assignLanes(entries: Array<{ fromSlot: number; toSlot: number }>): number[] {
  const finDeColonne: number[] = []
  return entries.map((entree) => {
    const libre = finDeColonne.findIndex((fin) => fin <= entree.fromSlot)
    const colonne = libre === -1 ? finDeColonne.length : libre
    finDeColonne[colonne] = entree.toSlot
    return colonne
  })
}

export function weekGrid(week: WeekDay[], range = hourRange(week)): WeekGrid {
  const slotsPerHour = 60 / SLOT_MINUTES
  const premierCreneau = range.from * slotsPerHour
  const dernierCreneau = range.to * slotsPerHour

  const days: GridDay[] = week.map((jour) => {
    const triees = [...jour.entries].sort((a, b) => a.start.getTime() - b.start.getTime())
    const bornes = triees.map((entree) => {
      const debut = Math.floor(minutesOfDay(entree.start) / SLOT_MINUTES)
      const fin = Math.ceil(minutesOfDay(entree.end) / SLOT_MINUTES)
      return {
        fromSlot: Math.max(0, debut - premierCreneau),
        // Au moins un créneau : une activité d'un quart d'heure doit rester visible.
        toSlot: Math.max(debut + 1, Math.min(fin, dernierCreneau)) - premierCreneau,
      }
    })
    const colonnes = assignLanes(bornes)
    const lanes = colonnes.length === 0 ? 1 : Math.max(...colonnes) + 1

    return {
      date: jour.date,
      placed: triees.map((entry, i) => ({
        entry,
        fromSlot: bornes[i]!.fromSlot,
        toSlot: bornes[i]!.toSlot,
        lane: colonnes[i]!,
        lanes,
      })),
    }
  })

  const hours: number[] = []
  for (let h = range.from; h < range.to; h += 1) hours.push(h)

  return { hours, slotsPerHour, days }
}
