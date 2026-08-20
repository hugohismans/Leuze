import { defineConfig } from 'vitest/config'

/**
 * Tests des règles Firestore : ils tournent sur l'émulateur, jamais sur un vrai projet.
 * Lancer avec `npm run test:rules`, qui démarre l'émulateur autour de cette suite.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/rules/**/*.test.ts'],
    testTimeout: 20_000,
    hookTimeout: 20_000,
    // Les suites partagent une même base émulée : les faire tourner l'une après l'autre.
    fileParallelism: false,
  },
})
