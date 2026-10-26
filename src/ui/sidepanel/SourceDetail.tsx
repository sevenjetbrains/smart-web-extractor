import { useEffect, useState } from 'react';
import type { DetectedColumn, Warning } from '../../shared/content-protocol';
import type { FieldValueType, Scenario } from '../../shared/types';
import { slugify } from '../../shared/field-keys';
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
        {config.sensitive
          ? 'Champ sensible : sa valeur ne sera jamais lue ni enregistrée.'
          : column.samples.length > 0
            ? `Aperçu : ${column.samples.join(' · ')}`
            : 'Aucune valeur sur cette page'}
        {!config.sensitive && column.emptyCount > 0 && state.source.kind !== 'fields' ? ` — ${column.emptyCount} vide(s)` : ''}
      </p>
      <div className="field-options small">
        <label>
          <input
            type="checkbox"
            checked={config.required && !config.sensitive}
            disabled={config.sensitive}
            onChange={(e) => update({ required: e.target.checked })}
          />
          Obligatoire
        </label>
        <label title="La valeur d’un champ sensible n’est jamais lue ni enregistrée.">
          <input
            type="checkbox"
            checked={config.sensitive}
            onChange={(e) => update({ sensitive: e.target.checked })}
            aria-label={`Champ « ${config.label} » sensible (jamais lu)`}
          />
          Sensible
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

export function SourceDetail({
  state,
  api,
  onScenarioSaved,
}: {
  state: SourceState;
  api: DetectionApi;
  onScenarioSaved: (scenario: Scenario) => void;
}) {
  const { source } = state;
  const [scenarioName, setScenarioName] = useState(source.label);
  const [saving, setSaving] = useState(false);
  useEffect(() => setScenarioName(source.label), [source.id, source.label]);
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

      <form
        className="save-scenario"
        onSubmit={(e) => {
          e.preventDefault();
          setSaving(true);
          void api.saveAsScenario(source.id, scenarioName).then((scenario) => {
            setSaving(false);
            if (scenario) onScenarioSaved(scenario);
          });
        }}
      >
        <h3>Conserver ces règles</h3>
        <label className="small stack-label">
          Nom du scénario
          <input
            type="text"
            value={scenarioName}
            maxLength={200}
            required
            onChange={(e) => setScenarioName(e.target.value)}
          />
        </label>
        <button type="submit" className="secondary" disabled={saving || selectedCount === 0 || !scenarioName.trim()}>
          Enregistrer comme scénario
        </button>
      </form>
    </section>
  );
}
