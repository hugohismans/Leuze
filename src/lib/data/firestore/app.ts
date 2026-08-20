/**
 * Initialisation de Firebase côté navigateur.
 *
 * Seul ce fichier — et le reste de `data/firestore/` — connaît Firebase.
 * L'interface, elle, ne consomme que les interfaces de `data/ports.ts`.
 */
import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app'
import { connectAuthEmulator, getAuth, type Auth } from 'firebase/auth'
import {
  connectFirestoreEmulator,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from 'firebase/firestore'
import { connectFunctionsEmulator, getFunctions, type Functions } from 'firebase/functions'

const REGION = 'europe-west1'

function readConfig(): Record<string, string> {
  const config = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
  }
  const missing = Object.entries(config)
    .filter(([, value]) => value === undefined || value === '')
    .map(([key]) => key)
  if (missing.length > 0) {
    throw new Error(
      `Configuration Firebase incomplète : ${missing.join(', ')}. ` +
        'Copiez .env.example en .env et renseignez les valeurs du projet.',
    )
  }
  return config as Record<string, string>
}

export const usesEmulators = (): boolean => import.meta.env.VITE_USE_EMULATORS === '1'

let cached: { app: FirebaseApp; db: Firestore; auth: Auth; functions: Functions } | null = null

export function firebase(): { app: FirebaseApp; db: Firestore; auth: Auth; functions: Functions } {
  if (cached) return cached

  const app = getApps().length > 0 ? getApp() : initializeApp(readConfig())

  // Cache persistant : le programme de la semaine reste lisible quand le wifi lâche.
  // L'inscription, elle, exige d'être en ligne — voir PLAN.md §4.6.
  const db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  })
  const auth = getAuth(app)
  const functions = getFunctions(app, REGION)

  if (usesEmulators()) {
    connectFirestoreEmulator(db, '127.0.0.1', 8080)
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
    connectFunctionsEmulator(functions, '127.0.0.1', 5001)
  }

  cached = { app, db, auth, functions }
  return cached
}
