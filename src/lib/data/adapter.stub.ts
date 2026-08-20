import type { AppRepository } from './ports'

/**
 * Remplaçant de l'adapter Firestore quand l'application est construite pour la
 * démonstration (`VITE_DATA_SOURCE` différent de « firestore »).
 *
 * L'alias `$adapter` de `vite.config.ts` pointe soit ici, soit sur le vrai adapter.
 * Résultat : le paquet de la démonstration ne contient pas une ligne du SDK Firebase —
 * il se charge vite, et il n'a aucun moyen de contacter un serveur.
 */
export const createFirestoreRepository: (() => AppRepository) | null = null
