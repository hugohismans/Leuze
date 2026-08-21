import type { Firestore } from 'firebase-admin/firestore'
import { GENERATION_WINDOW_WEEKS, expand, mergeOccurrences, type MergeOptions } from '../domain/recurrence'
import { addLocalDays, startOfIsoWeek, todayLocalDate } from '../domain/time'
import type { Activity, LocalDate } from '../domain/types'
import { COLLECTIONS, docToActivity, docToOccurrence, occurrenceToDoc } from './firestore'

/**
 * Matérialisation des occurrences sur une fenêtre glissante.
 *
 * Toute la décision est prise par `mergeOccurrences`, une fonction pure et testée :
 * ne jamais écraser une occurrence qu'un soignant a modifiée isolément, ne jamais
 * faire disparaître une occurrence portant des inscriptions — l'annuler, avec un motif.
 * Ici, il ne reste que la lecture, l'écriture et le découpage en lots.
 */

/** Commence au lundi de la semaine en cours — voir `src/lib/data/generation.ts`. */
export function generationWindow(from: LocalDate = todayLocalDate()): { from: LocalDate; to: LocalDate } {
  const debut = startOfIsoWeek(from)
  return { from: debut, to: addLocalDays(debut, GENERATION_WINDOW_WEEKS * 7) }
}

export type RegenerationReport = {
  created: number
  updated: number
  preserved: number
  cancelled: number
  removed: number
}

export async function regenerateActivity(
  database: Firestore,
  activityId: string,
  options: MergeOptions & { window?: { from: LocalDate; to: LocalDate } } = {},
): Promise<RegenerationReport> {
  const window = options.window ?? generationWindow()
  const activitySnapshot = await database.collection(COLLECTIONS.activities).doc(activityId).get()
  const activity: Activity | null = activitySnapshot.exists ? docToActivity(activitySnapshot) : null

  // Activité supprimée ou désactivée : `expand` renvoie une liste vide, et le plan
  // se charge d'annuler ce qui porte des inscriptions.
  const drafts = activity === null ? [] : expand(activity, window.from, window.to)

  const existingSnapshot = await database
    .collection(COLLECTIONS.occurrences)
    .where('activityId', '==', activityId)
    .where('localDate', '>=', window.from)
    .where('localDate', '<=', window.to)
    .get()
  const existing = existingSnapshot.docs.map(docToOccurrence)

  const mergeOptions: MergeOptions = options.overrideFrom === undefined ? {} : { overrideFrom: options.overrideFrom }
  const plan = mergeOccurrences(drafts, existing, mergeOptions)

  const writes = [
    ...[...plan.create, ...plan.update, ...plan.cancel].map((occurrence) => ({
      kind: 'set' as const,
      id: occurrence.id,
      data: occurrenceToDoc(occurrence),
    })),
    ...plan.remove.map((id) => ({ kind: 'delete' as const, id, data: null })),
  ]

  // 500 opérations par lot : au-delà, Firestore refuse le commit.
  for (let i = 0; i < writes.length; i += 400) {
    const batch = database.batch()
    for (const write of writes.slice(i, i + 400)) {
      const reference = database.collection(COLLECTIONS.occurrences).doc(write.id)
      if (write.kind === 'delete') batch.delete(reference)
      else batch.set(reference, write.data)
    }
    await batch.commit()
  }

  return {
    created: plan.create.length,
    updated: plan.update.length,
    preserved: plan.preserved.length,
    cancelled: plan.cancel.length,
    removed: plan.remove.length,
  }
}

/** Repousse la fenêtre pour toutes les activités actives (fonction planifiée quotidienne). */
export async function regenerateAll(database: Firestore): Promise<RegenerationReport> {
  const window = generationWindow()
  const activities = await database.collection(COLLECTIONS.activities).where('isActive', '==', true).get()
  const total: RegenerationReport = { created: 0, updated: 0, preserved: 0, cancelled: 0, removed: 0 }
  for (const document of activities.docs) {
    const report = await regenerateActivity(database, document.id, { window })
    total.created += report.created
    total.updated += report.updated
    total.preserved += report.preserved
    total.cancelled += report.cancelled
    total.removed += report.removed
  }
  return total
}
