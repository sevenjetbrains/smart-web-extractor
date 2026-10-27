import type { ExtractResult } from '../../../src/shared/content-protocol';
import type { FieldRule, Locator, Scenario } from '../../../src/shared/types';

export const column = (index: number): Locator => ({
  strategies: [{ kind: 'columnIndex', index }],
  scope: 'row',
  expectedCount: 'one',
});

export function field(key: string, patch: Partial<FieldRule> = {}): FieldRule {
  return {
    key,
    label: key,
    source: 'list',
    valueType: 'text',
    required: false,
    sensitive: false,
    listLocator: column(0),
    read: 'text',
    conflictPolicy: 'preferDetail',
    ...patch,
  };
}

/** Scénario de version 1, au format de l'exemple du cahier des charges (§5.2). */
export function v1Scenario(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: 'scenario_agents',
    revision: 3,
    name: 'Extraction des agents',
    domain: 'intranet.exemple.local',
    startUrl: 'https://intranet.exemple.local/agents',
    recordType: 'list_and_details',
    compatibleModes: ['semi_automatic', 'automatic'],
    status: 'validated',
    fields: [
      { key: 'matricule', label: 'Matricule', source: 'both', valueType: 'text', required: true, sensitive: false, conflictPolicy: 'flag' },
      { key: 'nom', label: 'Nom', source: 'detail', valueType: 'text', required: true, sensitive: false, conflictPolicy: 'preferDetail' },
      { key: 'grade', label: 'Grade', source: 'detail', valueType: 'text', required: false, sensitive: false, conflictPolicy: 'preferDetail' },
    ],
    steps: [
      {
        id: 's1',
        type: 'locateList',
        successCondition: { kind: 'rowCountChanged' },
        timeoutMs: 10000,
        retry: { maxAttempts: 2, backoffMs: 1000, onFailure: 'pause' },
      },
      {
        id: 's2',
        type: 'openDetail',
        openIn: 'backgroundTab',
        successCondition: { kind: 'urlMatches', pattern: '*/agents/*' },
        timeoutMs: 15000,
        retry: { maxAttempts: 3, backoffMs: 2000, onFailure: 'skipRecord' },
      },
    ],
    pagination: { kind: 'nextButton', locator: { strategies: [{ kind: 'label', text: 'Suivant' }], scope: 'page', expectedCount: 'one' } },
    association: { primary: { kind: 'field', fieldKeys: ['matricule'] }, fallback: 'detailUrl' },
    limits: { maxRecords: 500, maxPages: 50, delayBetweenActionsMs: 500, maxActionsPerMinute: 60 },
    duplicates: 'flagOnly',
    createdAt: '2026-10-22T09:00:00Z',
    updatedAt: '2026-10-22T10:30:00Z',
  };
}

export function v2Scenario(patch: Partial<Scenario> = {}): Scenario {
  return {
    schemaVersion: 2,
    id: 'scn_test',
    revision: 1,
    name: 'Agents',
    domain: '127.0.0.1',
    startUrl: 'http://127.0.0.1:5174/liste-simple.html',
    recordType: 'list',
    compatibleModes: ['semi_automatic'],
    status: 'draft',
    fields: [field('matricule', { required: true }), field('nom', { listLocator: column(1) })],
    steps: [],
    extractionSource: {
      kind: 'table',
      container: { strategies: [{ kind: 'id', value: 'agents' }], scope: 'page', expectedCount: 'one' },
    },
    pagination: { kind: 'none' },
    association: { primary: { kind: 'field', fieldKeys: ['matricule'] }, fallback: 'detailUrl' },
    limits: { maxRecords: 500, maxPages: 50, delayBetweenActionsMs: 500, maxActionsPerMinute: 60 },
    duplicates: 'flagOnly',
    createdAt: '2026-10-26T09:00:00.000Z',
    updatedAt: '2026-10-26T09:00:00.000Z',
    ...patch,
  };
}

export function extraction(rows: Record<string, string | null>[]): ExtractResult {
  return { rows, fieldWarnings: {}, warnings: [], truncated: false };
}
