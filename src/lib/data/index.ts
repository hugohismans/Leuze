/**
 * Choix de la source de données. C'est le seul endroit où l'on décide entre
 * la démonstration et le vrai projet Firebase.
 */
import type { AppRepository } from './ports'
import { createMockRepository, type MockRepository } from './mock/mockRepository'
import { createFirestoreRepository } from '$adapter'

export type DataSource = 'mock' | 'firestore'

// `$adapter` est résolu à la construction (voir vite.config.ts) : le vrai adapter
// Firestore, ou un remplaçant vide pour la démonstration.
/**
 * `/demo` reste toujours branché sur les données fictives : c'est l'écran montrable
 * sans backend, y compris si Firebase est injoignable.
 */
export function chooseSource(): DataSource {
  if (createFirestoreRepository === null) return 'mock'
  if (typeof window !== 'undefined' && window.location.hash.startsWith('#/demo')) return 'mock'
  return 'firestore'
}

export function createRepository(source: DataSource): AppRepository {
  return source === 'firestore' && createFirestoreRepository !== null
    ? createFirestoreRepository()
    : createMockRepository()
}

export const isMockRepository = (repository: AppRepository): repository is MockRepository =>
  'setDemoService' in repository
