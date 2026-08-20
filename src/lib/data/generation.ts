/**
 * Matérialisation des occurrences côté client.
 *
 * Le même travail que la Cloud Function `onActivityWritten`, avec les mêmes fonctions
 * pures du domaine — `expand` puis `mergeOccurrences`. Sur le plan gratuit de Firebase,
 * il n'y a pas de fonction pour le faire : c'est l'application soignante qui s'en charge,
 * au moment où elle enregistre l'activité.
 *
 * Les règles Firestore encadrent ce que le navigateur peut écrire : jamais les compteurs
 * de places, jamais la suppression d'une occurrence portant des inscriptions.
 */
import { config } from '../config'
import { expand, mergeOccurrences, type MergeOptions } from '../domain/recurrence'
import { addLocalDays, todayLocalDate } from '../domain/time'
import type { Activity, LocalDate, Occurrence } from '../domain/types'
import type { GenerationReport } from './staffPorts'

export type GenerationWindow = { from: LocalDate; to: LocalDate }

export function generationWindow(from: LocalDate = todayLocalDate()): GenerationWindow {
  return { from, to: addLocalDays(from, config.generationWindowWeeks * 7) }
}

export type GenerationPlan = {
  write: Occurrence[]
  remove: string[]
  report: GenerationReport
}

/**
 * Calcule ce qu'il faut écrire et effacer. Aucune écriture ici : la fonction reste pure,
 * ce qui la rend testable et réutilisable par les deux adapters.
 */
export function planGeneration(
  activity: Activity | null,
  existing: Occurrence[],
  window: GenerationWindow,
  options: MergeOptions = {},
): GenerationPlan {
  const drafts = activity === null ? [] : expand(activity, window.from, window.to)
  const plan = mergeOccurrences(drafts, existing, options)
  return {
    write: [...plan.create, ...plan.update, ...plan.cancel],
    remove: plan.remove,
    report: {
      created: plan.create.length,
      updated: plan.update.length,
      preserved: plan.preserved.length,
      cancelled: plan.cancel.length,
      removed: plan.remove.length,
    },
  }
}

/** Phrase destinée au soignant, en français simple. Toujours dire ce qui a été fait. */
export function describeGeneration(report: GenerationReport): string {
  const morceaux: string[] = []
  if (report.created > 0) morceaux.push(`${report.created} séance${report.created > 1 ? 's' : ''} ajoutée${report.created > 1 ? 's' : ''}`)
  if (report.updated > 0) morceaux.push(`${report.updated} mise${report.updated > 1 ? 's' : ''} à jour`)
  if (report.cancelled > 0) morceaux.push(`${report.cancelled} annulée${report.cancelled > 1 ? 's' : ''}`)
  if (report.removed > 0) morceaux.push(`${report.removed} retirée${report.removed > 1 ? 's' : ''}`)
  if (report.preserved > 0) morceaux.push(`${report.preserved} laissée${report.preserved > 1 ? 's' : ''} telle${report.preserved > 1 ? 's' : ''} quelle${report.preserved > 1 ? 's' : ''}`)
  return morceaux.length === 0 ? 'Aucun changement dans le calendrier.' : `${morceaux.join(', ')}.`
}
