import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { HttpsError } from 'firebase-functions/v2/https'
import { db } from './firestore'

/**
 * Limitation de débit pour l'échange d'un code contre une session.
 * Sans elle, un code de six caractères serait devinable en ligne.
 *
 * TODO : doubler par App Check une fois l'application déployée — ce compteur protège
 * du balayage, pas d'un attaquant qui change d'adresse à chaque essai.
 */

const WINDOW_MS = 15 * 60 * 1000
const MAX_FAILURES = 10

const key = (raw: string) => encodeURIComponent(raw).slice(0, 200)

export async function assertNotRateLimited(clientKey: string): Promise<void> {
  const reference = db().collection('rateLimits').doc(key(clientKey))
  const snapshot = await reference.get()
  if (!snapshot.exists) return

  const data = snapshot.data() as { failures?: number; firstFailureAt?: Timestamp }
  const startedAt = data.firstFailureAt?.toMillis() ?? 0
  const withinWindow = Date.now() - startedAt < WINDOW_MS
  if (withinWindow && (data.failures ?? 0) >= MAX_FAILURES) {
    throw new HttpsError(
      'resource-exhausted',
      'Trop d’essais. Patientez un quart d’heure, ou demandez de l’aide à un soignant.',
    )
  }
}

export async function recordFailure(clientKey: string): Promise<void> {
  const reference = db().collection('rateLimits').doc(key(clientKey))
  await db().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference)
    const data = snapshot.data() as { failures?: number; firstFailureAt?: Timestamp } | undefined
    const startedAt = data?.firstFailureAt?.toMillis() ?? 0
    const expired = Date.now() - startedAt >= WINDOW_MS
    transaction.set(reference, {
      failures: expired ? 1 : (data?.failures ?? 0) + 1,
      firstFailureAt: expired || !data?.firstFailureAt ? Timestamp.now() : data.firstFailureAt,
      updatedAt: FieldValue.serverTimestamp(),
    })
  })
}

export async function clearFailures(clientKey: string): Promise<void> {
  await db().collection('rateLimits').doc(key(clientKey)).delete()
}
