import { useCallback, useEffect, useState } from 'react';
import { httpHostname } from '../../shared/schemas';
import type { LogEntry, ResultRecord, Run, Scenario } from '../../shared/types';
import { storageErrorMessage } from '../../storage/errors';
import { listLogs } from '../../storage/logs';
import { deleteRun } from '../../storage/purge';
import { countResults, listResults } from '../../storage/results';
import { listRuns } from '../../storage/runs';
import { getScenarioRevision } from '../../storage/scenarios';
import { ConfirmButton } from '../components/ConfirmButton';
import { RECORD_STATUS_LABELS, RUN_MODE_LABELS, RUN_STATE_LABELS, formatDate } from '../lib/format';
import { useScenarios } from '../lib/useScenarios';

interface RunRow {
  run: Run;
  count: number;
}

const MAX_ROWS = 500;

/**
 * Historique des exécutions et consultation de leurs résultats. Le tableau de
 * résultats complet (filtres, corrections, exports) arrive en phase 6.
 */
export function RunsView({
  scenarioFilter,
  onFilterChange,
}: {
  scenarioFilter: string | null;
  onFilterChange: (id: string | null) => void;
}) {
  const { scenarios } = useScenarios();
  const [rows, setRows] = useState<RunRow[] | null>(null);
  const [openRunId, setOpenRunId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const reload = useCallback(async () => {
    try {
      const runs = await listRuns(scenarioFilter ? { scenarioId: scenarioFilter } : {});
      setRows(await Promise.all(runs.map(async (run) => ({ run, count: await countResults(run.id) }))));
    } catch (e) {
      setMessage({ kind: 'err', text: storageErrorMessage(e) });
    }
  }, [scenarioFilter]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const nameOf = (id: string) => scenarios?.find((s) => s.id === id)?.name ?? 'Scénario supprimé';
  const open = rows?.find((r) => r.run.id === openRunId);
  if (open) return <RunDetail row={open} scenarioName={nameOf(open.run.scenarioId)} onClose={() => setOpenRunId(null)} />;

  return (
    <section aria-labelledby="runs-heading">
      <div className="row between">
        <h2 id="runs-heading">Exécutions</h2>
        <label className="small">
          Scénario{' '}
          <select value={scenarioFilter ?? ''} onChange={(e) => onFilterChange(e.target.value || null)}>
            <option value="">Tous</option>
            {scenarios?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div aria-live="polite">
        {message && (
          <p className={`alert ${message.kind}`} role={message.kind === 'err' ? 'alert' : 'status'}>
            {message.text}
          </p>
        )}
      </div>
      {rows?.length === 0 && (
        <p className="muted">
          Aucune exécution. Extrayez une page avec un scénario depuis le panneau latéral, puis « Enregistrer les résultats ».
        </p>
      )}
      {rows && rows.length > 0 && (
        <div className="table-scroll">
          <table className="data">
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Scénario</th>
                <th scope="col">Mode</th>
                <th scope="col">État</th>
                <th scope="col">Enregistrements</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ run, count }) => (
                <tr key={run.id}>
                  <td>{formatDate(run.startedAt)}</td>
                  <td dir="auto">
                    {nameOf(run.scenarioId)} <span className="muted small">(révision {run.scenarioRevision})</span>
                  </td>
                  <td>{RUN_MODE_LABELS[run.mode]}</td>
                  <td>{RUN_STATE_LABELS[run.state]}</td>
                  <td>{count}</td>
                  <td>
                    <span className="row">
                      <button type="button" className="secondary" onClick={() => setOpenRunId(run.id)}>
                        Voir les résultats
                      </button>
                      <ConfirmButton
                        label="Supprimer"
                        confirmLabel="Supprimer"
                        question="Supprimer cette exécution et ses résultats ?"
                        onConfirm={async () => {
                          try {
                            await deleteRun(run.id);
                            setMessage({ kind: 'ok', text: 'Exécution supprimée.' });
                          } catch (e) {
                            setMessage({ kind: 'err', text: storageErrorMessage(e) });
                          }
                          await reload();
                        }}
                      />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function RunDetail({ row, scenarioName, onClose }: { row: RunRow; scenarioName: string; onClose: () => void }) {
  const { run } = row;
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [records, setRecords] = useState<ResultRecord[] | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        setScenario(await getScenarioRevision(run.scenarioId, run.scenarioRevision));
        setRecords(await listResults(run.id));
        setLogs(await listLogs(run.id));
      } catch (e) {
        setError(storageErrorMessage(e));
      }
    })();
  }, [run]);

  // Colonnes : celles de la révision utilisée, sinon celles présentes dans les résultats.
  const columns =
    scenario?.fields.filter((f) => !f.sensitive).map((f) => ({ key: f.key, label: f.label })) ??
    [...new Set(records?.flatMap((r) => Object.keys(r.values)) ?? [])].map((key) => ({ key, label: key }));

  return (
    <section aria-labelledby="run-title">
      <div className="row between">
        <h2 id="run-title" dir="auto">
          Résultats — {scenarioName}
        </h2>
        <button type="button" className="secondary" onClick={onClose}>
          Retour aux exécutions
        </button>
      </div>
      <p className="muted small">
        {formatDate(run.startedAt)} · révision {run.scenarioRevision} · {RUN_MODE_LABELS[run.mode]} ·{' '}
        {RUN_STATE_LABELS[run.state]} · {row.count} enregistrement(s)
      </p>
      {error && (
        <p className="alert err" role="alert">
          {error}
        </p>
      )}
      {records && (
        <div className="table-scroll">
          <table className="data results">
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">État</th>
                {columns.map((c) => (
                  <th key={c.key} scope="col" dir="auto">
                    {c.label}
                  </th>
                ))}
                <th scope="col">Source</th>
              </tr>
            </thead>
            <tbody>
              {records.slice(0, MAX_ROWS).map((record, i) => (
                <tr key={record.id}>
                  <td className="muted">{i + 1}</td>
                  <td>
                    {record.status.map((s) => (
                      <span key={s} className={`badge ${s}`}>
                        {RECORD_STATUS_LABELS[s]}
                      </span>
                    ))}
                  </td>
                  {columns.map((c) => {
                    const value = record.values[c.key];
                    const shown = value?.corrected ?? value?.original ?? null;
                    return shown === null ? (
                      <td key={c.key} className="muted" title="Valeur manquante">
                        —
                      </td>
                    ) : (
                      <td key={c.key} dir="auto">
                        {shown}
                      </td>
                    );
                  })}
                  <td>
                    {httpHostname(record.sourceUrl) ? (
                      <a href={record.sourceUrl} target="_blank" rel="noopener noreferrer">
                        Ouvrir
                      </a>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {records && records.length > MAX_ROWS && (
        <p className="muted small">Affichage limité aux {MAX_ROWS} premiers enregistrements.</p>
      )}

      <section className="card" aria-labelledby="logs-title">
        <h3 id="logs-title">Journal</h3>
        {logs.length === 0 ? (
          <p className="muted small">Aucune entrée.</p>
        ) : (
          <ul className="plain small">
            {logs.map((log, i) => (
              <li key={i}>
                <span className={`badge ${log.level}`}>{log.level === 'info' ? 'Info' : log.level === 'warning' ? 'Avertissement' : 'Erreur'}</span>{' '}
                <code>{log.code}</code> — {log.message}
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
