/**
 * État du panneau de détection : rapport de la page, configuration des champs
 * (sélection, libellé, obligatoire, type), sélection dans la page et extraction
 * manuelle. L'état vit le temps de la page analysée ; l'enregistrement en
 * scénario arrive en phase 3.
 */
import { useCallback, useState } from 'react';
import { z } from '../../shared/zod';
import {
  DetectionReportSchema,
  ExtractResultSchema,
  PickResultSchema,
  type DetectedColumn,
  type DetectedSource,
  type DetectionReport,
  type ExtractResult,
  type HeaderMode,
} from '../../shared/content-protocol';
import type { AppError } from '../../shared/messages';
import type { FieldValueType, Locator } from '../../shared/types';
import { callContent } from '../lib/content-client';
import { uniqueKeys } from '../lib/field-keys';

export interface FieldConfig {
  selected: boolean;
  label: string;
  required: boolean;
  valueType: FieldValueType;
}

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
  | { status: 'done'; sourceId: string; columns: ExtractionColumn[]; result: ExtractResult }
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

function defaultConfig(column: DetectedColumn, selected: boolean): FieldConfig {
  return { selected, label: column.label, required: false, valueType: column.valueType };
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

export function useDetection(tabId: number | null) {
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

  async function extract(sourceId: string) {
    const state = sources[sourceId];
    if (tabId === null || !state) return;
    const selected = state.columns.filter((c) => state.config[c.id]?.selected);
    if (selected.length === 0) {
      setExtraction({ status: 'error', error: { code: 'INVALID_MESSAGE', message: 'Sélectionnez au moins un champ.' } });
      return;
    }
    const keys = uniqueKeys(selected.map((c) => state.config[c.id]!.label));
    setExtraction({ status: 'loading' });
    const { source } = state;
    const result = await callContent(
      tabId,
      {
        type: 'CONTENT_EXTRACT',
        source: { kind: source.kind, container: source.container, itemSelector: source.itemSelector, headerMode: source.headerMode },
        fields: selected.map((c, i) => ({ key: keys[i]!, locator: c.locator, read: c.read })),
      },
      ExtractResultSchema,
    );
    if (!result.ok) {
      setExtraction({ status: 'error', error: result.error });
      return;
    }
    setExtraction({
      status: 'done',
      sourceId,
      result: result.data,
      columns: selected.map((c, i) => ({ key: keys[i]!, label: state.config[c.id]!.label, required: state.config[c.id]!.required })),
    });
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
  };
}

export type DetectionApi = ReturnType<typeof useDetection>;
