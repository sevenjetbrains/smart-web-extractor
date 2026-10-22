/**
 * Routeur de messages du service worker.
 * - n'accepte que les messages venant de cette extension (sender.id) ;
 * - n'accepte les requêtes de pilotage que depuis les pages de l'extension,
 *   jamais depuis un content script (dont l'URL est celle du site visité) ;
 * - valide chaque message par schéma avant de l'aiguiller.
 */
import {
  BackgroundRequest,
  fail,
  type BackgroundResponseMap,
  type Result,
} from '../shared/messages';

export type Handlers = {
  [K in BackgroundRequest['type']]: (
    request: Extract<BackgroundRequest, { type: K }>,
  ) => Promise<Result<BackgroundResponseMap[K]>>;
};

export interface SenderInfo {
  id?: string;
  url?: string;
}

export interface RouterContext {
  extensionId: string;
  /** Origine des pages de l'extension, ex. "chrome-extension://<id>/". */
  extensionOrigin: string;
}

export type Router = (message: unknown, sender: SenderInfo) => Promise<Result<unknown>>;

export function createRouter(ctx: RouterContext, handlers: Handlers): Router {
  return async (message, sender) => {
    if (sender.id !== ctx.extensionId) {
      return fail('FORBIDDEN_SENDER', 'Message refusé : expéditeur inconnu.');
    }
    if (!sender.url?.startsWith(ctx.extensionOrigin)) {
      return fail('FORBIDDEN_SENDER', 'Message refusé : seules les pages de l’extension peuvent piloter le service worker.');
    }

    const parsed = BackgroundRequest.safeParse(message);
    if (!parsed.success) {
      return fail('INVALID_MESSAGE', 'Message refusé : format invalide.');
    }

    try {
      const request = parsed.data;
      switch (request.type) {
        case 'GET_STATUS':
          return await handlers.GET_STATUS(request);
        case 'PING_TAB':
          return await handlers.PING_TAB(request);
        case 'ENSURE_CONTENT':
          return await handlers.ENSURE_CONTENT(request);
      }
    } catch {
      return fail('INTERNAL_ERROR', 'Erreur interne du service worker.');
    }
  };
}
