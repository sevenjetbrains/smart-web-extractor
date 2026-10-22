import { resolve } from 'node:path';
import { defineConfig } from 'vite';

const projectRoot = import.meta.dirname;

/**
 * Build du content script : un seul fichier IIFE sans import, car les scripts
 * injectés par chrome.scripting.executeScript ne peuvent pas être des modules ES.
 * S'exécute après le build principal et ne vide pas le dossier de sortie.
 */
export default defineConfig(({ mode }) => ({
  publicDir: false,
  build: {
    outDir: resolve(projectRoot, mode === 'e2e' ? 'dist-e2e' : 'dist'),
    emptyOutDir: false,
    target: 'chrome116',
    lib: {
      entry: resolve(projectRoot, 'src/content/main.ts'),
      formats: ['iife'],
      name: 'SmartWebExtractorContent',
      fileName: () => 'content/main.js',
    },
  },
}));
