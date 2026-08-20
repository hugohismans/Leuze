/**
 * Choix de la source de données.
 *
 * `DATA_SOURCE` est une constante de compilation : Vite remplace `import.meta.env` par
 * une chaîne littérale, ce qui rend l'une des deux branches ci-dessous morte et permet
 * à Rollup de la supprimer entièrement. Conséquences concrètes :
 *  - la version de démonstration ne contient **pas une ligne** du SDK Firebase, ni la
 *    configuration du projet : l'adresse publique ne peut pas atteindre la base, même
 *    en principe, et la page pèse sept fois moins ;
 *  - dans la version réelle, les données fictives partent dans un fragment séparé, qui
 *    n'est téléchargé que si quelqu'un ouvre `/demo`.
 *
 * C'est pour cela que les adapters sont chargés par `import()` et que la création du
 * dépôt est asynchrone : un import statique retiendrait les deux.
 */
import type { AppRepository } from './ports'
import type { MockRepository } from './mock/mockRepository'
import type { StaffApp } from './staffPorts'

export type DataSource = 'mock' | 'firestore'

export const DATA_SOURCE: DataSource =
  import.meta.env.VITE_DATA_SOURCE === 'firestore' ? 'firestore' : 'mock'

/** `/demo` reste sur les données fictives même dans une version branchée sur Firestore. */
export function isDemoRoute(): boolean {
  return typeof window !== 'undefined' && window.location.hash.startsWith('#/demo')
}

export function usesMock(): boolean {
  return DATA_SOURCE === 'mock' || isDemoRoute()
}

export async function createRepository(): Promise<AppRepository> {
  if (DATA_SOURCE === 'firestore' && !isDemoRoute()) {
    const { createFirestoreRepository } = await import('./firestore/firestoreRepository')
    return createFirestoreRepository()
  }
  const { createMockRepository } = await import('./mock')
  return createMockRepository()
}

export async function createStaffApp(): Promise<StaffApp> {
  if (DATA_SOURCE === 'firestore' && !isDemoRoute()) {
    const { createFirestoreStaffApp } = await import('./firestore/staffRepository')
    return createFirestoreStaffApp()
  }
  const { createMockStaffApp } = await import('./mock')
  return createMockStaffApp()
}

export const isMockRepository = (repository: AppRepository): repository is MockRepository =>
  'setDemoService' in repository
