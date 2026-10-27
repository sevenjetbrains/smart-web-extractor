/**
 * État du panneau de détection : rapport de la page, configuration des champs
 * (sélection, libellé, obligatoire, sensible, type), sélection dans la page,
 * extraction manuelle, enregistrement en scénario et enregistrement des
 * résultats. L'état de la détection vit le temps de la page analysée ; les
 * scénarios et les résultats sont conservés dans le stockage local.
 */
import { useCallback, useState } from 'react';
import { z } from '../../shared/zod';
import {
  DetectionReportSchema,
  ExtractResultSchema,
  PickResultSchema,
  type ContentRequest,
  type DetectedColumn,
  type DetectedSource,
  type DetectionReport,
  type ExtractResult,
  type HeaderMode,
} from '../../shared/content-protocol';
import type { AppError } from '../../shared/messages';
import type { Locator, Scenario } from '../../shared/types';
import { storageErrorMessage } from '../../storage/errors';
import { saveManualRun } from '../../storage/manual-run';
import { createScenario } from '../../storage/scenarios';
import { callContent } from '../lib/content-client';
import {
  extractRequestFromScenario,
  scenarioInputFromDetection,
  selectedFields,
  type FieldConfig,
} from './scenario-rules';

export type { FieldConfig };

export interface SourceState {
  source: DetectedSource;
  /** Colonnes détectées, plus celles ajoutées par sélection dans la page. */
  columns: DetectedColumn[];
  config: Record<string, FieldConfig>;
}

export interface ExtractionColumn {
  key: string;
  label: string;
  required: boolean;
}

export type Extraction =
  | { status: 'idle' }
  | { status: 'loading' }
  | {
      status: 'done';
      columns: ExtractionColumn[];
      result: ExtractResult;
      /** Scénario utilisé : seules ses extractions peuvent être enregistrées. */
      scenario?: Scenario;
      saved?: { runId: string; count: number };
    }
  | { status: 'error'; error: AppError };

export const MANUAL_SOURCE_ID = 'manual';

const MANUAL_SOURCE: DetectedSource = {
  id: MANUAL_SOURCE_ID,
  kind: 'fields',
  label: 'Champs choisis dans la page',
  container: { strategies: [{ kind: 'css', selector: 'body' }], scope: 'page', expectedCount: 'one' },
  itemCount: 1,
  columns: [],
  warnings: [],
};

const storageFailure = (e: unknown): AppError => ({ code: 'INTERNAL_ERROR', message: storageErrorMessage(e) });

function defaultConfig(column: DetectedColumn, selected: boolean): FieldConfig {
  return { selected, label: column.label, required: false, sensitive: false, valueType: column.valueType };
}

function initialState(source: DetectedSource, previous?: SourceState): SourceState {
  const config: Record<string, FieldConfig> = {};
  for (const column of source.columns) {
    const kept = previous?.config[column.id];
    config[column.id] = kept && previous?.columns.some((c) => c.id === column.id && c.label === column.label)
      ? kept
      : defaultConfig(column, column.read !== 'href');
  }
  const extras = previous?.columns.filter((c) => c.id.startsWith('picked_')) ?? [];
  for (const extra of extras) config[extra.id] = previous!.config[extra.id]!;
  return { source, columns: [...source.columns, ...extras], config };
}

export function useDetection(tabId: number | null, pageUrl: string | null) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const [report, setReport] = useState<DetectionReport | null>(null);
  const [sources, setSources] = useState<Record<string, SourceState>>({});
  const [order, setOrder] = useState<string[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Record<string, HeaderMode>>({});
  const [picking, setPicking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [extraction, setExtraction] = useState<Extraction>({ status: 'idle' });

  const reset = useCallback(() => {
    setReport(null);
    setSources({});
    setOrder([]);
    setActiveId(null);
    setOverrides({});
    setError(null);
    setNotice(null);
    setExtraction({ status: 'idle' });
  }, []);

  async function analyze(nextOverrides = overrides, resetIds: string[] = []) {
    if (tabId === null) return;
    setLoading(true);
    setError(null);
    setNotice(null);
    const result = await callContent(tabId, { type: 'CONTENT_DETECT', headerOverrides: nextOverrides }, DetectionReportSchema);
    setLoading(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    const next: Record<string, SourceState> = {};
    for (const source of result.data.sources) {
      next[source.id] = initialState(source, resetIds.includes(source.id) ? undefined : sources[source.id]);
    }
    if (sources[MANUAL_SOURCE_ID]) next[MANUAL_SOURCE_ID] = sources[MANUAL_SOURCE_ID];
    const ids = Object.keys(next);
    setReport(result.data);
    setSources(next);
    setOrder(ids);
    setOverrides(nextOverrides);
    setActiveId((current) => (current && next[current] ? current : (ids[0] ?? null)));
    setExtraction({ status: 'idle' });
  }

  function setHeaderMode(sourceId: string, mode: HeaderMode) {
    void analyze({ ...overrides, [sourceId]: mode }, [sourceId]);
  }

  function updateField(sourceId: string, columnId: string, patch: Partial<FieldConfig>) {
    setSources((all) => {
      const state = all[sourceId];
      if (!state) return all;
      return { ...all, [sourceId]: { ...state, config: { ...state.config, [columnId]: { ...state.config[columnId]!, ...patch } } } };
    });
  }

  function selectAll(sourceId: string, selected: boolean) {
    setSources((all) => {
      const state = all[sourceId];
      if (!state) return all;
      const config = Object.fromEntries(Object.entries(state.config).map(([id, c]) => [id, { ...c, selected }]));
      return { ...all, [sourceId]: { ...state, config } };
    });
  }

  async function pick() {
    if (tabId === null) return;
    setPicking(true);
    setNotice(null);
    setError(null);
    const result = await callContent(tabId, { type: 'CONTENT_PICK', headerOverrides: overrides }, PickResultSchema);
    setPicking(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (result.data.cancelled) return;
    const { sourceId, column, isNew } = result.data;
    const targetId = sourceId && sources[sourceId] ? sourceId : MANUAL_SOURCE_ID;
    setSources((all) => {
      const state = all[targetId] ?? { source: MANUAL_SOURCE, columns: [], config: {} };
      const known = state.columns.some((c) => c.id === column.id);
      const columns = known ? state.columns : [...state.columns, column];
      const config = { ...state.config, [column.id]: { ...(state.config[column.id] ?? defaultConfig(column, true)), selected: true } };
      return { ...all, [targetId]: { ...state, columns, config } };
    });
    setOrder((ids) => (ids.includes(targetId) ? ids : [...ids, targetId]));
    setActiveId(targetId);
    setNotice(`« ${column.label} » ${isNew ? 'ajouté' : 'sélectionné'}${targetId === MANUAL_SOURCE_ID ? ' aux champs choisis dans la page' : ''}.`);
  }

  async function cancelPick() {
    if (tabId === null) return;
    await callContent(tabId, { type: 'CONTENT_CANCEL_PICK' }, z.strictObject({ done: z.literal(true) }));
  }

  async function highlight(locator: Locator) {
    if (tabId === null) return;
    const result = await callContent(tabId, { type: 'CONTENT_HIGHLIGHT', locator }, z.strictObject({ found: z.literal(true) }));
    if (!result.ok) setError(result.error);
  }

  async function runExtraction(request: Extract<ContentRequest, { type: 'CONTENT_EXTRACT' }>, columns: ExtractionColumn[], scenario?: Scenario) {
    if (tabId === null) return;
    setExtraction({ status: 'loading' });
    const result = await callContent(tabId, request, ExtractResultSchema);
    if (!result.ok) {
      setExtraction({ status: 'error', error: result.error });
      return;
    }
    setExtraction({ status: 'done', result: result.data, columns, ...(scenario ? { scenario } : {}) });
  }

  /** Extraction de la page avec la configuration du panneau (aperçu, non enregistré). */
  async function extract(sourceId: string) {
    const state = sources[sourceId];
    if (!state) return;
    // Un champ sensible n'est jamais lu.
    const fields = selectedFields(state.columns, state.config).filter((f) => !f.config.sensitive);
    if (fields.length === 0) {
      setExtraction({ status: 'error', error: { code: 'INVALID_MESSAGE', message: 'Sélectionnez au moins un champ non sensible.' } });
      return;
    }
    const { source } = state;
    await runExtraction(
      {
        type: 'CONTENT_EXTRACT',
        source: { kind: source.kind, container: source.container, itemSelector: source.itemSelector, headerMode: source.headerMode },
        fields: fields.map(({ column, key }) => ({ key, locator: column.locator, read: column.read })),
      },
      fields.map(({ config, key }) => ({ key, label: config.label, required: config.required })),
    );
  }

  /** Extraction de la page avec les règles d'un scénario enregistré. */
  async function extractWithScenario(scenario: Scenario) {
    const prepared = extractRequestFromScenario(scenario);
    if (!prepared.ok) {
      setExtraction({ status: 'error', error: { code: 'SOURCE_NOT_FOUND', message: prepared.message } });
      return;
    }
    const columns = scenario.fields
      .filter((f) => !f.sensitive && prepared.request.fields.some((r) => r.key === f.key))
      .map((f) => ({ key: f.key, label: f.label, required: f.required }));
    await runExtraction(prepared.request, columns, scenario);
  }

  /** Enregistre la configuration d'une source comme nouveau scénario (brouillon). */
  async function saveAsScenario(sourceId: string, name: string): Promise<Scenario | null> {
    const state = sources[sourceId];
    if (!state || !pageUrl) return null;
    setError(null);
    setNotice(null);
    if (!selectedFields(state.columns, state.config).some((f) => !f.config.sensitive)) {
      setError({ code: 'INVALID_MESSAGE', message: 'Sélectionnez au moins un champ non sensible.' });
      return null;
    }
    try {
      const scenario = await createScenario(scenarioInputFromDetection(state.source, state.columns, state.config, name, pageUrl));
      setNotice(`Scénario « ${scenario.name} » enregistré (brouillon, révision 1).`);
      return scenario;
    } catch (e) {
      setError(storageFailure(e));
      return null;
    }
  }

  /** Enregistre le résultat d'une extraction faite avec un scénario, comme nouvelle exécution. */
  async function saveResults() {
    if (extraction.status !== 'done' || !extraction.scenario || extraction.saved || !pageUrl) return;
    try {
      const { run, records } = await saveManualRun({
        scenario: extraction.scenario,
        extraction: extraction.result,
        pageUrl,
        ...(tabId !== null ? { tabId } : {}),
      });
      setExtraction({ ...extraction, saved: { runId: run.id, count: records.length } });
    } catch (e) {
      setExtraction({ status: 'error', error: storageFailure(e) });
    }
  }

  return {
    loading,
    error,
    report,
    sources,
    order,
    activeId,
    setActiveId,
    picking,
    notice,
    extraction,
    reset,
    analyze: () => analyze(),
    setHeaderMode,
    updateField,
    selectAll,
    pick,
    cancelPick,
    highlight,
    extract,
    extractWithScenario,
    saveAsScenario,
    saveResults,
  };
}

export type DetectionApi = ReturnType<typeof useDetection>;
