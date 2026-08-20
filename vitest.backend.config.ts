import { defineConfig } from 'vitest/config'

/**
 * Tests du code des Cloud Functions contre l'émulateur Firestore : transactions
 * d'inscription et génération d'occurrences. Lancer avec `npm run test:backend`.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/backend/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
    env: {
      GCLOUD_PROJECT: 'demo-leuze',
      FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
      FUNCTIONS_EMULATOR: 'true',
    },
  },
})
