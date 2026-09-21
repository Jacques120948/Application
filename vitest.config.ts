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
  /*
   * Le JSX est transformé avec la fabrique moderne, comme dans Next. Sans cela, esbuild
   * produit des appels à `React.createElement` alors que les composants n'importent pas
   * React — et un test qui rend un composant échoue sur « React is not defined », pour une
   * raison qui n'a rien à voir avec le composant.
   */
  esbuild: { jsx: 'automatic' },
})
