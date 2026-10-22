/**
 * Protocole de messages entre composants (cahier des charges §4.2, point 5).
 * Chaque message a un type déclaré et est validé par un schéma strict :
 * toute propriété inconnue ou mal typée entraîne un rejet.
 * Les messages adressés au content script sont définis dans content-protocol.ts.
 */
import { z } from './zod';

// ---------- Réponses ----------

export const ERROR_CODES = [
  'INVALID_MESSAGE',
  'FORBIDDEN_SENDER',
  'NO_SITE_ACCESS',
  'RESTRICTED_PAGE',
  'TAB_NOT_FOUND',
  'CONTENT_UNREACHABLE',
  'SOURCE_NOT_FOUND',
  'AMBIGUOUS_SOURCE',
  'SENSITIVE_FIELD',
  'PICK_IN_PROGRESS',
  'INTERNAL_ERROR',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export interface AppError {
  code: ErrorCode;
  message: string;
}

export type Result<T> = { ok: true; data: T } | { ok: false; error: AppError };

export const ok = <T>(data: T): Result<T> => ({ ok: true, data });
export const fail = (code: ErrorCode, message: string): Result<never> => ({ ok: false, error: { code, message } });

// ---------- Messages : pages de l'extension → service worker ----------

export const GetStatusRequest = z.strictObject({ type: z.literal('GET_STATUS') });

const tabId = z.number().int().nonnegative();

export const PingTabRequest = z.strictObject({ type: z.literal('PING_TAB'), tabId });

/** Injecte (ou réinjecte) le content script dans l'onglet. */
export const EnsureContentRequest = z.strictObject({ type: z.literal('ENSURE_CONTENT'), tabId });

export const BackgroundRequest = z.discriminatedUnion('type', [GetStatusRequest, PingTabRequest, EnsureContentRequest]);
export type BackgroundRequest = z.infer<typeof BackgroundRequest>;

export interface StatusInfo {
  version: string;
  phase: number;
}

/** Résumé d'une page : uniquement des métadonnées et des comptes, aucune valeur de champ. */
export const PageSummary = z.strictObject({
  title: z.string().max(500),
  url: z.string().max(2048),
  tableCount: z.number().int().nonnegative(),
  formFieldCount: z.number().int().nonnegative(),
  sensitiveFieldCount: z.number().int().nonnegative(),
});
export type PageSummary = z.infer<typeof PageSummary>;

export const ContentPingResponse = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), data: PageSummary }),
  z.strictObject({
    ok: z.literal(false),
    error: z.strictObject({ code: z.enum(ERROR_CODES), message: z.string().max(1000) }),
  }),
]);

/** Table de correspondance requête → type de données de la réponse. */
export interface BackgroundResponseMap {
  GET_STATUS: StatusInfo;
  PING_TAB: PageSummary;
  ENSURE_CONTENT: { injected: true };
}
export type BackgroundResponse<K extends BackgroundRequest['type']> = Result<BackgroundResponseMap[K]>;
