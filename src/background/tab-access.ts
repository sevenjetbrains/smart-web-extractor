/**
 * Injection à la demande du content script et dialogue avec lui (cahier §4.2, points 2 et 4).
 */
import { PATHS } from '../manifest';
import { ContentPingResponse, fail, type ContentRequest, type PageSummary, type Result } from '../shared/messages';

/** Traduit une erreur de chrome.scripting en erreur compréhensible. */
export function classifyInjectionError(message: string): Result<never> {
  if (/No tab with id/i.test(message)) {
    return fail('TAB_NOT_FOUND', 'L’onglet n’existe plus.');
  }
  if (/chrome:\/\/|chrome-extension:\/\/|extensions gallery|webstore|edge:\/\//i.test(message)) {
    return fail('RESTRICTED_PAGE', 'Chrome n’autorise pas les extensions sur cette page (pages internes ou boutique).');
  }
  return fail(
    'NO_SITE_ACCESS',
    'L’extension n’a pas accès à cette page. Cliquez sur l’icône de l’extension depuis la page, ou autorisez durablement ce domaine.',
  );
}

export async function pingTab(tabId: number): Promise<Result<PageSummary>> {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: [PATHS.contentScript] });
  } catch (e) {
    return classifyInjectionError(e instanceof Error ? e.message : String(e));
  }

  let raw: unknown;
  try {
    const request: ContentRequest = { type: 'CONTENT_PING' };
    raw = await chrome.tabs.sendMessage(tabId, request);
  } catch {
    return fail('CONTENT_UNREACHABLE', 'Le script de la page ne répond pas. Rechargez la page puis réessayez.');
  }

  // La réponse provient d'un contexte exposé à la page : elle est revalidée.
  const parsed = ContentPingResponse.safeParse(raw);
  if (!parsed.success) {
    return fail('INVALID_MESSAGE', 'Réponse invalide reçue depuis la page.');
  }
  return parsed.data;
}
