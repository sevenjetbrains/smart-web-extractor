/**
 * Content script injecté à la demande (IIFE, sans état entre deux pages).
 * Il ne lit jamais la valeur des champs de formulaire : seuls des comptes sont renvoyés.
 */
import { ContentRequest, fail, ok, type PageSummary, type Result } from '../shared/messages';
import { isSensitiveField } from './sensitive';

declare global {
  interface Window {
    __swxContentInstalled?: boolean;
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

function handle(message: unknown): Result<PageSummary> {
  const parsed = ContentRequest.safeParse(message);
  if (!parsed.success) {
    return fail('INVALID_MESSAGE', 'Message refusé : format invalide.');
  }
  switch (parsed.data.type) {
    case 'CONTENT_PING':
      return ok(summarizePage());
  }
}

// Le script peut être injecté plusieurs fois dans la même page : un seul écouteur.
if (!window.__swxContentInstalled) {
  window.__swxContentInstalled = true;
  chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    // Seul le service worker de cette extension peut s'adresser au content script.
    if (sender.id !== chrome.runtime.id || sender.tab) return false;
    sendResponse(handle(message));
    return false;
  });
}
