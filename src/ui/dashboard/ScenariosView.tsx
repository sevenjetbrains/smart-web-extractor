import { useState } from 'react';
import type { Scenario } from '../../shared/types';
import { storageErrorMessage } from '../../storage/errors';
import { deleteScenarioData } from '../../storage/purge';
import {
  deleteScenario,
  duplicateScenario,
  exportScenario,
  prepareImport,
  saveImportedScenario,
} from '../../storage/scenarios';
import { ConfirmButton } from '../components/ConfirmButton';
import { downloadText } from '../lib/download';
import { RECORD_TYPE_LABELS, formatDate, scenarioStatusLabel } from '../lib/format';
import { originPattern } from '../lib/messaging';
import { useScenarios } from '../lib/useScenarios';
import { ScenarioEditor } from './ScenarioEditor';

type Message = { kind: 'ok' | 'err'; text: string; details?: string[] };

interface PendingImport {
  scenario: Scenario;
  migratedFrom: number | null;
  fileName: string;
}

export function ScenariosView({ onShowRuns }: { onShowRuns: (scenarioId: string) => void }) {
  const { scenarios, error } = useScenarios();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [message, setMessage] = useState<Message | null>(null);
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null);

  async function act(action: () => Promise<string>) {
    setMessage(null);
    try {
      setMessage({ kind: 'ok', text: await action() });
    } catch (e) {
      setMessage({ kind: 'err', text: storageErrorMessage(e) });
    }
  }

  async function onImportFile(file: File | undefined) {
    setMessage(null);
    setPendingImport(null);
    if (!file) return;
    const prepared = prepareImport(await file.text());
    if (!prepared.ok) {
      setMessage({ kind: 'err', text: `Import refusé : ${prepared.message}`, details: prepared.issues });
      return;
    }
    setPendingImport({ scenario: prepared.scenario, migratedFrom: prepared.migratedFrom, fileName: file.name });
  }

  async function confirmImport(pending: PendingImport) {
    // La demande de permission doit partir directement du clic de l'utilisateur.
    const pattern = originPattern(pending.scenario.startUrl);
    const granted = pattern ? chrome.permissions.request({ origins: [pattern] }).catch(() => false) : Promise.resolve(false);
    await act(async () => {
      const saved = await saveImportedScenario(pending.scenario);
      setPendingImport(null);
      return `Scénario « ${saved.name} » importé en brouillon.${
        (await granted) ? '' : ` L’accès au domaine ${saved.domain} n’est pas accordé : il vous sera demandé avant l’extraction.`
      }`;
    });
  }

  const editing = scenarios?.find((s) => s.id === editingId);
  if (editing) {
    return <ScenarioEditor key={editing.id} scenario={editing} onClose={() => setEditingId(null)} />;
  }

  return (
    <section aria-labelledby="scenarios-heading">
      <div className="row between">
        <h2 id="scenarios-heading">Scénarios</h2>
        <label className="button-like secondary">
          Importer un scénario…
          <input
            type="file"
            accept=".json,application/json"
            className="visually-hidden"
            onChange={(e) => {
              void onImportFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </label>
      </div>

      <div aria-live="polite">
        {message && (
          <div className={`alert ${message.kind}`} role={message.kind === 'err' ? 'alert' : 'status'}>
            <p>{message.text}</p>
            {message.details && message.details.length > 0 && (
              <ul className="small">
                {message.details.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            )}
          </div>
        )}
        {error && (
          <p className="alert err" role="alert">
            {error}
          </p>
        )}
      </div>

      {pendingImport && (
        <section className="card notice" aria-labelledby="import-title">
          <h3 id="import-title">Confirmer l’import de « {pendingImport.scenario.name} »</h3>
          <p>
            Ce scénario s’applique au domaine <strong>{pendingImport.scenario.domain}</strong> (adresse de départ :{' '}
            <span dir="ltr">{pendingImport.scenario.startUrl}</span>). N’importez que des fichiers de confiance : vérifiez
            que ce domaine est bien celui attendu.
          </p>
          <p className="muted small">
            Fichier {pendingImport.fileName} — {pendingImport.scenario.fields.length} champ(s),{' '}
            {pendingImport.scenario.steps.length} étape(s).
            {pendingImport.migratedFrom !== null &&
              ` Format de la version ${pendingImport.migratedFrom}, converti automatiquement.`}{' '}
            Il sera enregistré comme brouillon.
          </p>
          <div className="row">
            <button type="button" onClick={() => void confirmImport(pendingImport)}>
              Confirmer le domaine et importer
            </button>
            <button type="button" className="secondary" onClick={() => setPendingImport(null)}>
              Annuler
            </button>
          </div>
        </section>
      )}

      {scenarios?.length === 0 && (
        <p className="muted">
          Aucun scénario. Créez-en un depuis le panneau latéral (« Enregistrer comme scénario ») ou importez un fichier.
        </p>
      )}

      <ul className="scenario-list">
        {scenarios?.map((s) => (
          <li key={s.id} className="card">
            <div className="row between">
              <h3 dir="auto">{s.name}</h3>
              <span className={`badge ${s.status}`}>{scenarioStatusLabel(s.status)}</span>
            </div>
            <p className="muted small">
              {s.domain} · {RECORD_TYPE_LABELS[s.recordType]} · {s.fields.length} champ(s) · révision {s.revision} ·
              modifié le {formatDate(s.updatedAt)}
            </p>
            <div className="row">
              <button type="button" onClick={() => setEditingId(s.id)}>
                Modifier
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => void act(async () => `Copie « ${(await duplicateScenario(s.id)).name} » créée.`)}
              >
                Dupliquer
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  const { filename, json } = exportScenario(s);
                  downloadText(filename, json);
                }}
              >
                Exporter
              </button>
              <button type="button" className="secondary" onClick={() => onShowRuns(s.id)}>
                Exécutions
              </button>
              <ConfirmButton
                label="Supprimer"
                confirmLabel="Supprimer définitivement"
                question={<>Supprimer « {s.name} », ses révisions et tous ses résultats ?</>}
                onConfirm={() =>
                  act(async () => {
                    const runs = await deleteScenarioData(s.id);
                    await deleteScenario(s.id);
                    return `Scénario « ${s.name} » supprimé, ainsi que ${runs} exécution(s).`;
                  })
                }
              />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
