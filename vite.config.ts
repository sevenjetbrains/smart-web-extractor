import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { buildManifest } from './src/manifest.ts';

const projectRoot = import.meta.dirname;
const srcRoot = resolve(projectRoot, 'src');
const pkg = JSON.parse(readFileSync(resolve(projectRoot, 'package.json'), 'utf8')) as { version: string };

/** Génère dist/manifest.json à partir de src/manifest.ts. */
function manifestPlugin(e2e: boolean): Plugin {
  return {
    name: 'swx-manifest',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'manifest.json',
        source: JSON.stringify(buildManifest({ version: pkg.version, e2e }), null, 2),
      });
    },
  };
}

/**
 * Build principal : pages de l'extension (popup, panneau latéral, tableau de bord)
 * et service worker, en modules ES. Le content script est compilé séparément en
 * IIFE autonome (cf. vite.content.config.ts).
 */
export default defineConfig(({ mode }) => {
  const e2e = mode === 'e2e';
  return {
    root: srcRoot,
    publicDir: resolve(projectRoot, 'public'),
    base: '/',
    plugins: [react(), manifestPlugin(e2e)],
    build: {
      outDir: resolve(projectRoot, e2e ? 'dist-e2e' : 'dist'),
      emptyOutDir: true,
      target: 'chrome116',
      modulePreload: { polyfill: false },
      rolldownOptions: {
        input: {
          popup: resolve(srcRoot, 'ui/popup/index.html'),
          sidepanel: resolve(srcRoot, 'ui/sidepanel/index.html'),
          dashboard: resolve(srcRoot, 'ui/dashboard/index.html'),
          'service-worker': resolve(srcRoot, 'background/service-worker.ts'),
        },
        output: {
          entryFileNames: (chunk) =>
            chunk.name === 'service-worker' ? 'background/service-worker.js' : 'assets/[name]-[hash].js',
        },
      },
    },
  };
});
