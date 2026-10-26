/**
 * Content script injecté à la demande (IIFE, sans état entre deux pages).
 * Il n'accepte que les messages des pages de l'extension, valide chaque requête,
 * et ne lit jamais la valeur des champs sensibles.
 */
import { detectPage } from './detector';
import { extract } from './extractor';
import { flashElement, isPicking, pickElement, cancelPick } from './picker';
import { describePickedElement } from './pick-resolve';
import { isSensitiveField } from './sensitive';
import { resolveLocator, clearLocatorCaches } from './locator';
import { waitForStable } from './wait';
import { ContentRequestSchema, type ContentRequest } from '../shared/content-protocol';
import { fail, ok, type PageSummary, type Result } from '../shared/messages';

type Listener = Parameters<typeof chrome.runtime.onMessage.addListener>[0];

declare global {
  interface Window {
    __swxContent?: { listener: Listener; cancelPick: () => void };
  }
}

function summarizePage(): PageSummary {
  const fields = Array.from(document.querySelectorAll<HTMLElement>('input, select, textarea'));
  const sensitive = fields.filter(isSensitiveField).length;
  return {
    title: document.title.slice(0, 500),
    url: location.href.slice(0, 2048),
    tableCount: document.querySelectorAll('table').length,
    formFieldCount: fields.length - sensitive,
    sensitiveFieldCount: sensitive,
  };
}

async function handle(request: ContentRequest): Promise<Result<unknown>> {
  switch (request.type) {
    case 'CONTENT_PING':
      return ok(summarizePage());

    case 'CONTENT_DETECT': {
      const start = Date.now();
      const stability = await waitForStable(document, { timeoutMs: request.waitTimeoutMs ?? 5000 });
      const report = detectPage(document, { headerOverrides: request.headerOverrides });
      if (!stability.stable) {
        report.warnings.unshift({
          code: 'PAGE_NOT_STABLE',
          message: 'La page continuait de changer : relancez l’analyse si des données manquent.',
        });
      }
      return ok({ ...report, durationMs: Date.now() - start });
    }

    case 'CONTENT_EXTRACT':
      return extract(document, request);

    case 'CONTENT_PICK': {
      if (isPicking()) return fail('PICK_IN_PROGRESS', 'Une sélection est déjà en cours dans cette page.');
      const el = await pickElement(document);
      if (!el) return ok({ cancelled: true });
      return describePickedElement(document, el, { headerOverrides: request.headerOverrides });
    }

    case 'CONTENT_CANCEL_PICK':
      cancelPick();
      return ok({ done: true });

    case 'CONTENT_HIGHLIGHT': {
      clearLocatorCaches();
      const resolution = resolveLocator(request.locator, document.body ?? document.documentElement);
      if (resolution.status === 'notFound') return fail('SOURCE_NOT_FOUND', 'Élément introuvable sur la page.');
      if (resolution.status === 'ambiguous') return fail('AMBIGUOUS_SOURCE', resolution.reason ?? 'Plusieurs éléments correspondent.');
      flashElement(document, resolution.elements[0]!);
      return ok({ found: true });
    }
  }
}

const listener: Listener = (message, sender, sendResponse) => {
  // Seules les pages de l'extension (service worker, panneau) peuvent s'adresser au content script.
  if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL(''))) return false;
  const parsed = ContentRequestSchema.safeParse(message);
  if (!parsed.success) {
    sendResponse(fail('INVALID_MESSAGE', 'Message refusé : format invalide.'));
    return false;
  }
  handle(parsed.data).then(sendResponse, () => sendResponse(fail('INTERNAL_ERROR', 'Erreur interne du script de la page.')));
  return true;
};

// Le script peut être injecté plusieurs fois (nouvelle analyse, extension rechargée) :
// l'écouteur précédent est remplacé pour qu'un seul reste actif.
const previous = window.__swxContent;
if (previous) {
  try {
    previous.cancelPick();
    chrome.runtime.onMessage.removeListener(previous.listener);
  } catch {
    // Ancienne instance d'une extension rechargée : son contexte n'est plus valide.
  }
}
chrome.runtime.onMessage.addListener(listener);
window.__swxContent = { listener, cancelPick };
