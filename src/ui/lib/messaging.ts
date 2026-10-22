import type { BackgroundRequest, BackgroundResponse, Result } from '../../shared/messages';

/** Envoie une requête typée au service worker. */
export async function sendToBackground<R extends BackgroundRequest>(
  request: R,
): Promise<BackgroundResponse<R['type']>> {
  try {
    return (await chrome.runtime.sendMessage(request)) as BackgroundResponse<R['type']>;
  } catch {
    const failure: Result<never> = {
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: 'Le service worker ne répond pas.' },
    };
    return failure;
  }
}

export interface ActiveTabInfo {
  id: number;
  windowId: number;
  /** Absente si l'extension n'a pas accès à l'onglet. */
  url?: string;
  title?: string;
}

/** Onglet actif de la fenêtre courante (la page consultée, pas l'interface de l'extension). */
export async function getActiveTab(): Promise<ActiveTabInfo | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return null;
  return { id: tab.id, windowId: tab.windowId, url: tab.url, title: tab.title };
}

/** Motif de permission d'hôte pour le domaine d'une URL http(s), sinon null. */
export function originPattern(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return `${u.protocol}//${u.hostname}/*`;
  } catch {
    return null;
  }
}
