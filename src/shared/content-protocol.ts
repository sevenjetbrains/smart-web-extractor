/**
 * Protocole entre les pages de l'extension (panneau latéral, service worker)
 * et le content script. Les requêtes sont validées par le content script, et
 * les réponses par l'extension : la page visitée est un contexte non fiable.
 */
import { z } from './zod';
import { ERROR_CODES } from './messages';
import {
  ExtractionSourceSchema,
  FieldKeySchema,
  FieldValueTypeSchema,
  HeaderModeSchema,
  LocatorSchema,
  ReadModeSchema,
  SourceKindSchema,
} from './schemas';
import type { ExtractionSource, HeaderMode, SourceKind } from './types';

export { HeaderModeSchema, SourceKindSchema };
export type { HeaderMode, SourceKind };

// ---------- Avertissements ----------

export const WARNING_CODES = [
  'HEADER_INFERRED',
  'NO_HEADER',
  'MERGED_CELLS',
  'NESTED_TABLES',
  'FRAGILE_LOCATOR',
  'AMBIGUOUS_LOCATOR',
  'DUPLICATE_HEADER',
  'MISSING_VALUES',
  'SENSITIVE_FIELDS_IGNORED',
  'PAGE_NOT_STABLE',
  'FRAMES_NOT_SCANNED',
  'SHADOW_DOM_NOT_SCANNED',
  'FIELD_NOT_FOUND',
  'TRUNCATED',
] as const;
export type WarningCode = (typeof WARNING_CODES)[number];

export const WarningSchema = z.strictObject({
  code: z.enum(WARNING_CODES),
  message: z.string().max(500),
});
export type Warning = z.infer<typeof WarningSchema>;

// ---------- Rapport de détection ----------

export const DetectedColumnSchema = z.strictObject({
  /** Identifiant technique dans la source (ex. "col_2"), stable pour une même page. */
  id: z.string().max(100),
  label: z.string().max(300),
  locator: LocatorSchema,
  read: ReadModeSchema,
  valueType: FieldValueTypeSchema,
  samples: z.array(z.string().max(300)).max(3),
  /** Nombre de lignes ou d'éléments sans valeur. */
  emptyCount: z.number().int().nonnegative(),
  warnings: z.array(WarningSchema).max(10),
});
export type DetectedColumn = z.infer<typeof DetectedColumnSchema>;

export const DetectedSourceSchema = z.strictObject({
  /** Identifiant dans le rapport (ex. "table-0") ; valable pour la page analysée uniquement. */
  id: z.string().max(50),
  kind: SourceKindSchema,
  label: z.string().max(300),
  container: LocatorSchema,
  /** Sélecteur relatif des éléments d'une liste (ex. ":scope > article.carte"). */
  itemSelector: z.string().max(500).optional(),
  headerMode: HeaderModeSchema.optional(),
  /** Lignes de données, éléments de liste, ou 1 pour des champs de page. */
  itemCount: z.number().int().nonnegative(),
  columns: z.array(DetectedColumnSchema).max(200),
  warnings: z.array(WarningSchema).max(20),
});
export type DetectedSource = z.infer<typeof DetectedSourceSchema>;

export const DetectionReportSchema = z.strictObject({
  url: z.string().max(2048),
  title: z.string().max(500),
  sources: z.array(DetectedSourceSchema).max(100),
  sensitiveFieldCount: z.number().int().nonnegative(),
  warnings: z.array(WarningSchema).max(20),
  durationMs: z.number().nonnegative(),
});
export type DetectionReport = z.infer<typeof DetectionReportSchema>;

// ---------- Extraction ----------

export const ExtractSourceSchema = ExtractionSourceSchema;
export type ExtractSource = ExtractionSource;

export const ExtractFieldSchema = z.strictObject({
  key: FieldKeySchema,
  locator: LocatorSchema,
  read: ReadModeSchema,
});
export type ExtractField = z.infer<typeof ExtractFieldSchema>;

export const MAX_EXTRACT_ROWS = 10_000;
export const MAX_VALUE_LENGTH = 10_000;

export const ExtractResultSchema = z.strictObject({
  rows: z.array(z.record(z.string(), z.string().max(MAX_VALUE_LENGTH).nullable())).max(MAX_EXTRACT_ROWS),
  /** Avertissements par clé de champ. */
  fieldWarnings: z.record(z.string(), z.array(WarningSchema).max(5)),
  warnings: z.array(WarningSchema).max(20),
  truncated: z.boolean(),
});
export type ExtractResult = z.infer<typeof ExtractResultSchema>;

// ---------- Sélection dans la page ----------

export const PickResultSchema = z.discriminatedUnion('cancelled', [
  z.strictObject({ cancelled: z.literal(true) }),
  z.strictObject({
    cancelled: z.literal(false),
    /** Source détectée qui contient l'élément, ou null pour un champ isolé de la page. */
    sourceId: z.string().max(50).nullable(),
    column: DetectedColumnSchema,
    /** Vrai si la colonne n'existait pas dans le rapport de détection. */
    isNew: z.boolean(),
  }),
]);
export type PickResult = z.infer<typeof PickResultSchema>;

// ---------- Requêtes ----------

export const ContentRequestSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('CONTENT_PING') }),
  z.strictObject({
    type: z.literal('CONTENT_DETECT'),
    headerOverrides: z.record(z.string().max(50), HeaderModeSchema).optional(),
    waitTimeoutMs: z.number().int().min(0).max(15_000).optional(),
  }),
  z.strictObject({
    type: z.literal('CONTENT_EXTRACT'),
    source: ExtractSourceSchema,
    fields: z.array(ExtractFieldSchema).min(1).max(200),
    maxRows: z.number().int().min(1).max(MAX_EXTRACT_ROWS).optional(),
  }),
  z.strictObject({
    type: z.literal('CONTENT_PICK'),
    headerOverrides: z.record(z.string().max(50), HeaderModeSchema).optional(),
  }),
  z.strictObject({ type: z.literal('CONTENT_CANCEL_PICK') }),
  z.strictObject({ type: z.literal('CONTENT_HIGHLIGHT'), locator: LocatorSchema }),
]);
export type ContentRequest = z.infer<typeof ContentRequestSchema>;

/** Enveloppe de réponse générique : la donnée est validée par le schéma propre à chaque requête. */
export function contentResponseSchema<T extends z.ZodType>(data: T) {
  return z.discriminatedUnion('ok', [
    z.strictObject({ ok: z.literal(true), data }),
    z.strictObject({
      ok: z.literal(false),
      error: z.strictObject({ code: z.enum(ERROR_CODES), message: z.string().max(1000) }),
    }),
  ]);
}
