import { useEffect, useState } from 'react';
import type { DetectedColumn, Warning } from '../../shared/content-protocol';
import type { FieldValueType } from '../../shared/types';
import { slugify } from '../lib/field-keys';
import { type DetectionApi, type SourceState } from './useDetection';

const KIND_LABELS = { table: 'Tableau', list: 'Liste', fields: 'Champs' } as const;

const TYPE_LABELS: Record<FieldValueType, string> = { text: 'Texte', number: 'Nombre', date: 'Date', url: 'Lien' };

export function sourceSummary({ source, columns }: SourceState): string {
  const count =
    source.kind === 'table'
      ? `${source.itemCount} ligne(s)`
      : source.kind === 'list'
        ? `${source.itemCount} élément(s)`
        : `${columns.length} champ(s)`;
  return `${KIND_LABELS[source.kind]} · ${count}`;
}

export function Warnings({ items }: { items: Warning[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="warnings">
      {items.map((w, i) => (
        <li key={`${w.code}-${i}`}>{w.message}</li>
      ))}
    </ul>
  );
}

function FieldRow({ state, column, api }: { state: SourceState; column: DetectedColumn; api: DetectionApi }) {
  const config = state.config[column.id]!;
  const sourceId = state.source.id;
  const update = (patch: Parameters<DetectionApi['updateField']>[2]) => api.updateField(sourceId, column.id, patch);
  const pageScoped = column.locator.scope === 'page';

  return (
    <li className={`field${config.selected ? ' selected' : ''}`}>
      <div className="field-head">
        <input
          type="checkbox"
          checked={config.selected}
          onChange={(e) => update({ selected: e.target.checked })}
          aria-label={`Extraire le champ « ${config.label} »`}
        />
        <input
          type="text"
          className="field-label"
          value={config.label}
          maxLength={300}
          onChange={(e) => update({ label: e.target.value })}
          aria-label={`Nom du champ (détecté : ${column.label})`}
        />
      </div>
      <p className="muted small" dir="auto">
        {column.samples.length > 0 ? `Aperçu : ${column.samples.join(' · ')}` : 'Aucune valeur sur cette page'}
        {column.emptyCount > 0 && state.source.kind !== 'fields' ? ` — ${column.emptyCount} vide(s)` : ''}
      </p>
      <div className="field-options small">
        <label>
          <input type="checkbox" checked={config.required} onChange={(e) => update({ required: e.target.checked })} />
          Obligatoire
        </label>
        <label>
          Type{' '}
          <select value={config.valueType} onChange={(e) => update({ valueType: e.target.value as FieldValueType })}>
            {Object.entries(TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <span className="muted">clé : {slugify(config.label)}</span>
        {pageScoped && (
          <button type="button" className="link" onClick={() => void api.highlight(column.locator)}>
            Afficher
          </button>
        )}
      </div>
      <Warnings items={column.warnings} />
    </li>
  );
}

export function SourceDetail({ state, api }: { state: SourceState; api: DetectionApi }) {
  const { source } = state;
  const canToggleHeader = source.kind === 'table' && source.headerMode !== 'explicit';
  // La case reflète le choix tout de suite, pendant que la page est réanalysée.
  const [pendingHeader, setPendingHeader] = useState<boolean | null>(null);
  useEffect(() => setPendingHeader(null), [source.id, source.headerMode]);
  const firstRowIsHeader = pendingHeader ?? source.headerMode === 'firstRow';
  const selectedCount = state.columns.filter((c) => state.config[c.id]?.selected).length;

  return (
    <section className="card" aria-labelledby="source-title">
      <h2 id="source-title" dir="auto">
        {source.label}
      </h2>
      <p className="muted small">{sourceSummary(state)}</p>
      <Warnings items={source.warnings} />

      <div className="row">
        {source.kind !== 'fields' && (
          <button type="button" className="secondary" onClick={() => void api.highlight(source.container)}>
            Afficher dans la page
          </button>
        )}
        {canToggleHeader && (
          <label className="small inline-check">
            <input
              type="checkbox"
              checked={firstRowIsHeader}
              disabled={api.loading}
              onChange={(e) => {
                setPendingHeader(e.target.checked);
                api.setHeaderMode(source.id, e.target.checked ? 'firstRow' : 'none');
              }}
            />
            La première ligne contient les en-têtes
          </label>
        )}
      </div>

      <div className="row between">
        <h3>Champs ({selectedCount} sélectionné(s))</h3>
        <span className="row">
          <button type="button" className="link" onClick={() => api.selectAll(source.id, true)}>
            Tout
          </button>
          <button type="button" className="link" onClick={() => api.selectAll(source.id, false)}>
            Aucun
          </button>
        </span>
      </div>
      <ul className="fields">
        {state.columns.map((column) => (
          <FieldRow key={column.id} state={state} column={column} api={api} />
        ))}
      </ul>

      <button
        type="button"
        onClick={() => void api.extract(source.id)}
        disabled={selectedCount === 0 || api.extraction.status === 'loading'}
      >
        {api.extraction.status === 'loading' ? 'Extraction…' : 'Extraire cette page'}
      </button>
    </section>
  );
}
