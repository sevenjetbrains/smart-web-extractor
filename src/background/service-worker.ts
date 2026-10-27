/**
 * Service worker : orchestration et routage des messages.
 * Il peut être arrêté à tout moment par Chrome (cf. cahier §4.2, point 1) :
 * aucun état n'est conservé uniquement en mémoire.
 *
 * Les échanges interactifs (détection, sélection dans la page, extraction
 * manuelle) passent directement du panneau latéral au content script : ils
 * attendent des actions de l'utilisateur et ne doivent pas dépendre de la durée
 * de vie du service worker. Celui-ci reste seul responsable de l'injection.
 */
import { createRouter } from './message-router';
import { ensureContent, pingTab } from './tab-access';
import { ok } from '../shared/messages';
import { purgeExpiredRuns } from '../storage/purge';
import { pauseInterruptedRuns } from '../storage/runs';
import { getSettings } from '../storage/settings';

const CURRENT_PHASE = 3;

const router = createRouter(
  { extensionId: chrome.runtime.id, extensionOrigin: chrome.runtime.getURL('') },
  {
    GET_STATUS: async () => ok({ version: chrome.runtime.getManifest().version, phase: CURRENT_PHASE }),
    PING_TAB: async ({ tabId }) => pingTab(tabId),
    ENSURE_CONTENT: async ({ tabId }) => ensureContent(tabId),
  },
);

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  void router(message, { id: sender.id, url: sender.url }).then(sendResponse);
  return true; // réponse asynchrone
});

/**
 * À chaque démarrage du service worker : une exécution restée « en cours » a
 * été interrompue et passe en pause (cahier §7) ; les exécutions dont la durée
 * de conservation est dépassée sont purgées (cahier §6.2).
 */
async function startupMaintenance(): Promise<void> {
  try {
    await pauseInterruptedRuns();
    await purgeExpiredRuns((await getSettings()).retentionDays);
  } catch {
    // Stockage indisponible (quota, base verrouillée) : nouvelle tentative au prochain démarrage.
  }
}

void startupMaintenance();
