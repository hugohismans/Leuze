/**
 * Choix de la source de données. C'est le seul endroit où l'on décide entre
 * la démonstration et le vrai projet Firebase.
 */
import type { AppRepository } from './ports'
import { createMockRepository, type MockRepository } from './mock/mockRepository'
import { createFirestoreRepository } from './firestore/firestoreRepository'

export type DataSource = 'mock' | 'firestore'

/**
 * `/demo` reste toujours branché sur les données fictives : c'est l'écran montrable
 * sans backend, y compris si Firebase est injoignable. Partout ailleurs, la variable
 * `VITE_DATA_SOURCE` décide, et vaut « mock » par défaut tant que le projet n'est pas
 * en service.
 */
export function chooseSource(): DataSource {
  if (typeof window !== 'undefined' && window.location.hash.startsWith('#/demo')) return 'mock'
  return import.meta.env.VITE_DATA_SOURCE === 'firestore' ? 'firestore' : 'mock'
}

export function createRepository(source: DataSource): AppRepository {
  return source === 'firestore' ? createFirestoreRepository() : createMockRepository()
}

export const isMockRepository = (repository: AppRepository): repository is MockRepository =>
  'setDemoService' in repository
