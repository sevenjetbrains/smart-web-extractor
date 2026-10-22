/**
 * Source unique du manifeste. Le fichier dist/manifest.json est généré à partir
 * de cette fonction au moment du build (cf. vite.config.ts) et testé unitairement.
 */

export interface ManifestOptions {
  version: string;
  /** Build de test : accès permanent à 127.0.0.1 pour les tests de bout en bout. */
  e2e: boolean;
}

export const REQUIRED_PERMISSIONS = ['storage', 'scripting', 'activeTab', 'sidePanel'] as const;
export const OPTIONAL_HOST_PERMISSIONS = ['https://*/*', 'http://*/*'] as const;
export const E2E_HOST_PERMISSIONS = ['http://127.0.0.1/*'] as const;

export const PATHS = {
  serviceWorker: 'background/service-worker.js',
  contentScript: 'content/main.js',
  popup: 'ui/popup/index.html',
  sidePanel: 'ui/sidepanel/index.html',
  dashboard: 'ui/dashboard/index.html',
} as const;

const ICONS = {
  '16': 'icons/icon-16.png',
  '32': 'icons/icon-32.png',
  '48': 'icons/icon-48.png',
  '128': 'icons/icon-128.png',
};

export function buildManifest({ version, e2e }: ManifestOptions): chrome.runtime.ManifestV3 {
  const manifest: chrome.runtime.ManifestV3 = {
    manifest_version: 3,
    name: e2e ? 'Smart Web Extractor (tests)' : 'Smart Web Extractor',
    version,
    description: 'Extraction locale de données depuis des tableaux et des fiches, avec apprentissage du parcours.',
    minimum_chrome_version: '116',
    icons: ICONS,
    action: {
      default_title: 'Smart Web Extractor',
      default_popup: PATHS.popup,
      default_icon: ICONS,
    },
    background: {
      service_worker: PATHS.serviceWorker,
      type: 'module',
    },
    side_panel: {
      default_path: PATHS.sidePanel,
    },
    options_page: PATHS.dashboard,
    permissions: [...REQUIRED_PERMISSIONS],
    optional_host_permissions: [...OPTIONAL_HOST_PERMISSIONS],
  };
  if (e2e) {
    manifest.host_permissions = [...E2E_HOST_PERMISSIONS];
  }
  return manifest;
}
