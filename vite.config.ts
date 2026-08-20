import { defineConfig, loadEnv } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig(({ mode }) => ({
  plugins: [svelte(), tailwindcss()],
  resolve: {
    alias: {
      $lib: fileURLToPath(new URL('./src/lib', import.meta.url)),
      // Construction pour la démonstration : l'adapter Firestore est remplacé par un
      // module vide, ce qui retire tout le SDK Firebase du paquet (884 Ko -> 129 Ko).
      $adapter: fileURLToPath(
        new URL(
          (loadEnv(mode, process.cwd(), 'VITE_').VITE_DATA_SOURCE ?? process.env.VITE_DATA_SOURCE) ===
          'firestore'
            ? './src/lib/data/firestore/firestoreRepository.ts'
            : './src/lib/data/adapter.stub.ts',
          import.meta.url,
        ),
      ),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
}))
