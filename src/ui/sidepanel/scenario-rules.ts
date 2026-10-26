/**
 * Passage entre la configuration du panneau de détection et les règles d'un
 * scénario : seules les règles (localisateurs, libellés, options) sont
 * conservées, jamais les valeurs observées sur la page (cahier §1).
 */
import { MAX_EXTRACT_ROWS, type ContentRequest, type DetectedColumn, type DetectedSource } from '../../shared/content-protocol';
import { uniqueKeys } from '../../shared/field-keys';
import type { FieldRule, FieldValueType, Scenario } from '../../shared/types';
import type { NewScenarioInput } from '../../storage/scenarios';

export interface FieldConfig {
  selected: boolean;
  label: string;
  required: boolean;
  /** Si vrai : la valeur n'est jamais lue ni enregistrée. */
  sensitive: boolean;
  valueType: FieldValueType;
}

/** Champs sélectionnés d'une source, avec leur clé technique. */
export function selectedFields(columns: DetectedColumn[], config: Record<string, FieldConfig>) {
  const selected = columns.filter((c) => config[c.id]?.selected);
  const keys = uniqueKeys(selected.map((c) => config[c.id]!.label));
  return selected.map((column, i) => ({ column, config: config[column.id]!, key: keys[i]! }));
}

export function scenarioInputFromDetection(
  source: DetectedSource,
  columns: DetectedColumn[],
  config: Record<string, FieldConfig>,
  name: string,
  startUrl: string,
): NewScenarioInput {
  const isDetail = source.kind === 'fields';
  const fields: FieldRule[] = selectedFields(columns, config).map(({ column, config: c, key }) => ({
    key,
    label: c.label.trim() || column.label,
    source: isDetail ? 'detail' : 'list',
    valueType: c.valueType,
    required: c.required && !c.sensitive,
    sensitive: c.sensitive,
    ...(isDetail ? { detailLocator: column.locator } : { listLocator: column.locator }),
    read: column.read,
    conflictPolicy: 'preferDetail',
  }));
  return {
    name,
    startUrl,
    recordType: isDetail ? 'detail' : 'list',
    fields,
    extractionSource: {
      kind: source.kind,
      container: source.container,
      ...(source.itemSelector ? { itemSelector: source.itemSelector } : {}),
      ...(source.headerMode ? { headerMode: source.headerMode } : {}),
    },
  };
}

/** Requête d'extraction d'une page à partir des règles d'un scénario, ou un message d'erreur. */
export function extractRequestFromScenario(
  scenario: Scenario,
): { ok: true; request: Extract<ContentRequest, { type: 'CONTENT_EXTRACT' }> } | { ok: false; message: string } {
  const source = scenario.extractionSource;
  if (!source) return { ok: false, message: 'Ce scénario n’indique pas où se trouvent les données sur la page.' };
  const fields = scenario.fields
    .filter((f) => !f.sensitive)
    .map((f) => ({ key: f.key, locator: source.kind === 'fields' ? f.detailLocator : f.listLocator, read: f.read }))
    .filter((f): f is { key: string; locator: NonNullable<typeof f.locator>; read: typeof f.read } => f.locator !== undefined);
  if (fields.length === 0) return { ok: false, message: 'Ce scénario ne contient aucun champ extractible sur cette page.' };
  return {
    ok: true,
    request: { type: 'CONTENT_EXTRACT', source, fields, maxRows: Math.min(scenario.limits.maxRecords, MAX_EXTRACT_ROWS) },
  };
}
