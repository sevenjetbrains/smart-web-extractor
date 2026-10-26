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

const CURRENT_PHASE = 2;

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
