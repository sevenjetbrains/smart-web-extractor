/**
 * Schémas de validation des objets du modèle (cahier §5.1).
 * Un scénario peut provenir d'un fichier importé : il est traité comme une
 * donnée non fiable (types stricts, tailles bornées, aucune propriété inconnue).
 */
import { z } from './zod';
import type {
  AssociationKey,
  ExtractionSource,
  FieldRule,
  HeaderMode,
  Locator,
  LocatorStrategy,
  PaginationRule,
  ReadMode,
  RetryPolicy,
  Scenario,
  ScenarioLimits,
  SourceKind,
  Step,
  SuccessCondition,
} from './types';

/** Version courante du format des scénarios (cf. storage/migrations.ts). */
export const SCENARIO_SCHEMA_VERSION = 2;

/** Taille maximale d'un scénario sérialisé en JSON (cahier §5.3). */
export const MAX_SCENARIO_BYTES = 256 * 1024;

const text = (max: number) => z.string().max(max);

export const LocatorStrategySchema: z.ZodType<LocatorStrategy> = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('id'), value: text(200).min(1) }),
  z.strictObject({ kind: z.literal('attribute'), name: text(100).min(1), value: text(300) }),
  z.strictObject({ kind: z.literal('role'), role: text(50).min(1), name: text(300).optional() }),
  z.strictObject({ kind: z.literal('label'), text: text(300).min(1) }),
  z.strictObject({ kind: z.literal('css'), selector: text(1000).min(1) }),
  z.strictObject({
    kind: z.literal('context'),
    anchorText: text(300).min(1),
    relation: z.enum(['sameRow', 'next', 'parent', 'columnOfHeader']),
  }),
  z.strictObject({ kind: z.literal('columnIndex'), index: z.number().int().min(0).max(500) }),
]);

export const LocatorSchema: z.ZodType<Locator> = z.strictObject({
  strategies: z.array(LocatorStrategySchema).min(1).max(10),
  scope: z.enum(['page', 'row']),
  expectedCount: z.enum(['one', 'many']),
});

export const ReadModeSchema: z.ZodType<ReadMode> = z.enum(['text', 'href', 'afterColon']);

export const FieldValueTypeSchema = z.enum(['text', 'number', 'date', 'url']);

export const SourceKindSchema: z.ZodType<SourceKind> = z.enum(['table', 'list', 'fields']);

export const HeaderModeSchema: z.ZodType<HeaderMode> = z.enum(['explicit', 'firstRow', 'none']);

export const ExtractionSourceSchema: z.ZodType<ExtractionSource> = z.strictObject({
  kind: SourceKindSchema,
  container: LocatorSchema,
  itemSelector: text(500).optional(),
  headerMode: HeaderModeSchema.optional(),
});

// ---------- Scénario ----------

/** Clé technique d'un champ, partagée avec le protocole d'extraction. */
export const FieldKeySchema = z.string().regex(/^[a-z][a-z0-9_]{0,59}$/);

const IdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

/** Nom d'hôte en minuscules (« intranet.exemple.local », « 127.0.0.1 »), sans port. */
export const DomainSchema = z
  .string()
  .max(253)
  .regex(/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/);

/** Nom d'hôte d'une adresse http(s), ou null. */
export function httpHostname(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.hostname : null;
  } catch {
    return null;
  }
}

const HttpUrlSchema = z
  .string()
  .max(2048)
  .refine((value) => httpHostname(value) !== null, 'Adresse http(s) attendue.');

const SuccessConditionSchema: z.ZodType<SuccessCondition> = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('elementVisible'), locator: LocatorSchema }),
  z.strictObject({ kind: z.literal('elementGone'), locator: LocatorSchema }),
  z.strictObject({ kind: z.literal('urlMatches'), pattern: text(500).min(1) }),
  z.strictObject({ kind: z.literal('rowCountChanged') }),
  z.strictObject({ kind: z.literal('textChanged'), locator: LocatorSchema }),
]);

const RetryPolicySchema: z.ZodType<RetryPolicy> = z.strictObject({
  maxAttempts: z.number().int().min(1).max(5),
  backoffMs: z.number().int().min(0).max(60_000),
  onFailure: z.enum(['skipRecord', 'pause', 'switchToAssisted', 'abort']),
});

const StepSchema: z.ZodType<Step> = z.strictObject({
  id: IdSchema,
  type: z.enum(['locateList', 'openDetail', 'extractFields', 'returnToList', 'nextPage', 'waitFor', 'scrollLoad']),
  locator: LocatorSchema.optional(),
  openIn: z.enum(['sameTab', 'backgroundTab']).optional(),
  returnMethod: z.enum(['historyBack', 'locator', 'closeTab']).optional(),
  successCondition: SuccessConditionSchema,
  timeoutMs: z.number().int().min(1000).max(60_000),
  retry: RetryPolicySchema,
});

export const FieldRuleSchema: z.ZodType<FieldRule> = z.strictObject({
  key: FieldKeySchema,
  label: text(300).trim().min(1),
  source: z.enum(['list', 'detail', 'both']),
  valueType: FieldValueTypeSchema,
  required: z.boolean(),
  sensitive: z.boolean(),
  listLocator: LocatorSchema.optional(),
  detailLocator: LocatorSchema.optional(),
  read: ReadModeSchema,
  conflictPolicy: z.enum(['preferDetail', 'preferList', 'flag']),
});

const PaginationRuleSchema: z.ZodType<PaginationRule> = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('none') }),
  z.strictObject({ kind: z.literal('nextButton'), locator: LocatorSchema }),
  z.strictObject({ kind: z.literal('pageLinks'), locator: LocatorSchema }),
  z.strictObject({ kind: z.literal('infiniteScroll'), maxScrolls: z.number().int().min(1).max(1000) }),
]);

const AssociationKeySchema: z.ZodType<AssociationKey> = z.strictObject({
  primary: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('technical'), locator: LocatorSchema }),
    z.strictObject({ kind: z.literal('field'), fieldKeys: z.array(FieldKeySchema).min(1).max(5) }),
  ]),
  fallback: z.enum(['detailUrl', 'none']),
});

const ScenarioLimitsSchema: z.ZodType<ScenarioLimits> = z.strictObject({
  maxRecords: z.number().int().min(1).max(100_000),
  maxPages: z.number().int().min(1).max(10_000),
  delayBetweenActionsMs: z.number().int().min(300).max(600_000),
  maxActionsPerMinute: z.number().int().min(1).max(200),
});

const IsoDateSchema = z.iso.datetime({ offset: true });

export const ScenarioSchema: z.ZodType<Scenario> = z
  .strictObject({
    schemaVersion: z.literal(SCENARIO_SCHEMA_VERSION),
    id: IdSchema,
    revision: z.number().int().min(1).max(1_000_000),
    name: text(200).trim().min(1),
    domain: DomainSchema,
    startUrl: HttpUrlSchema,
    recordType: z.enum(['list', 'detail', 'list_and_details']),
    compatibleModes: z.array(z.enum(['semi_automatic', 'automatic'])).min(1).max(2),
    status: z.enum(['draft', 'validated']),
    fields: z.array(FieldRuleSchema).min(1).max(200),
    steps: z.array(StepSchema).max(100),
    extractionSource: ExtractionSourceSchema.optional(),
    pagination: PaginationRuleSchema,
    association: AssociationKeySchema,
    limits: ScenarioLimitsSchema,
    duplicates: z.enum(['flagOnly', 'flagAndExcludeFromExport']),
    createdAt: IsoDateSchema,
    updatedAt: IsoDateSchema,
  })
  .superRefine((s, ctx) => {
    if (httpHostname(s.startUrl) !== s.domain) {
      ctx.addIssue({ code: 'custom', path: ['startUrl'], message: 'L’adresse de départ doit appartenir au domaine du scénario.' });
    }
    if (new Set(s.compatibleModes).size !== s.compatibleModes.length) {
      ctx.addIssue({ code: 'custom', path: ['compatibleModes'], message: 'Mode en double.' });
    }
    const keys = s.fields.map((f) => f.key);
    if (new Set(keys).size !== keys.length) {
      ctx.addIssue({ code: 'custom', path: ['fields'], message: 'Deux champs ont la même clé.' });
    }
    if (s.association.primary.kind === 'field') {
      for (const key of s.association.primary.fieldKeys) {
        if (!keys.includes(key)) {
          ctx.addIssue({ code: 'custom', path: ['association'], message: `Clé d’association inconnue : ${key}.` });
        }
      }
    }
    const stepIds = s.steps.map((step) => step.id);
    if (new Set(stepIds).size !== stepIds.length) {
      ctx.addIssue({ code: 'custom', path: ['steps'], message: 'Deux étapes ont le même identifiant.' });
    }
  });
