import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globals: false,
    testTimeout: 20_000,
    setupFiles: ['tests/setup.ts'],
    /*
     * Vitest charge automatiquement le fichier .env du projet. Sans cette neutralisation,
     * la suite de tests passerait de vrais appels payants au modèle et deviendrait non
     * déterministe. Les tests couvrent le chemin hors assistant ; le chemin assistant se
     * vérifie manuellement, jamais dans la suite automatique.
     */
    env: { ANTHROPIC_API_KEY: '' },
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
})
