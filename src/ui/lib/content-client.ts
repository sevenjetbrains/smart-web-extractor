/**
 * Dialogue direct entre une page de l'extension et le content script d'un onglet.
 * Si le script n'est pas (ou plus) présent, le service worker le réinjecte, puis la
 * requête est renvoyée une seule fois. Chaque réponse est validée : la page est
 * un contexte non fiable.
 */
import type { z } from '../../shared/zod';
import { contentResponseSchema, type ContentRequest } from '../../shared/content-protocol';
import { fail, type Result } from '../../shared/messages';
import { sendToBackground } from './messaging';

/** Erreurs signifiant que le message n'a pas été remis (aucun écouteur dans la page). */
const NOT_DELIVERED = /Receiving end does not exist|Could not establish connection/i;

export async function callContent<S extends z.ZodType>(
  tabId: number,
  request: ContentRequest,
  dataSchema: S,
): Promise<Result<z.infer<S>>> {
  const send = () => chrome.tabs.sendMessage(tabId, request) as Promise<unknown>;

  let raw: unknown;
  try {
    raw = await send();
  } catch (first) {
    const message = first instanceof Error ? first.message : String(first);
    if (!NOT_DELIVERED.test(message)) {
      return fail('CONTENT_UNREACHABLE', 'La page a été rechargée ou fermée pendant l’opération.');
    }
    const injected = await sendToBackground({ type: 'ENSURE_CONTENT', tabId });
    if (!injected.ok) return injected;
    try {
      raw = await send();
    } catch {
      return fail('CONTENT_UNREACHABLE', 'Le script de la page ne répond pas. Rechargez la page puis réessayez.');
    }
  }

  const parsed = contentResponseSchema(dataSchema).safeParse(raw);
  if (!parsed.success) return fail('INVALID_MESSAGE', 'Réponse invalide reçue depuis la page.');
  return parsed.data as Result<z.infer<S>>;
}
