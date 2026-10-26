import { useEffect, useState } from 'react';
import type { FieldRule, FieldValueType, Scenario } from '../../shared/types';
import { storageErrorMessage } from '../../storage/errors';
import { exportScenario, listRevisions, updateScenario } from '../../storage/scenarios';
import { downloadText } from '../lib/download';
import { RECORD_TYPE_LABELS, formatDate, scenarioStatusLabel } from '../lib/format';

const TYPE_LABELS: Record<FieldValueType, string> = { text: 'Texte', number: 'Nombre', date: 'Date', url: 'Lien' };

const LIMITS: Array<{ key: keyof Scenario['limits']; label: string; min: number; max: number }> = [
  { key: 'maxRecords', label: 'Enregistrements au maximum', min: 1, max: 100_000 },
  { key: 'maxPages', label: 'Pages au maximum', min: 1, max: 10_000 },
  { key: 'delayBetweenActionsMs', label: 'Délai entre deux actions (ms)', min: 300, max: 600_000 },
  { key: 'maxActionsPerMinute', label: 'Actions par minute au maximum', min: 1, max: 200 },
];

function associationKeys(scenario: Scenario): string[] {
  return scenario.association.primary.kind === 'field' ? scenario.association.primary.fieldKeys : [];
}

/**
 * Modification des règles d'un scénario : nom, état, champs, clé
 * d'association, doublons et limites. L'éditeur complet des étapes arrive en
 * phase 4. Enregistrer un scénario validé crée une nouvelle révision.
 */
export function ScenarioEditor({ scenario, onClose }: { scenario: Scenario; onClose: () => void }) {
  const [base, setBase] = useState(scenario);
  const [draft, setDraft] = useState(scenario);
  const [keys, setKeys] = useState(associationKeys(scenario));
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [revisions, setRevisions] = useState<Scenario[]>([]);

  useEffect(() => {
    void listRevisions(base.id).then(setRevisions);
  }, [base]);

  const technicalKey = base.association.primary.kind === 'technical';
  const changed = JSON.stringify(draft) !== JSON.stringify(base) || keys.join() !== associationKeys(base).join();

  function updateField(key: string, patch: Partial<FieldRule>) {
    setDraft((d) => ({ ...d, fields: d.fields.map((f) => (f.key === key ? { ...f, ...patch } : f)) }));
    if (patch.sensitive) setKeys((k) => k.filter((x) => x !== key));
  }

  async function save() {
    setMessage(null);
    if (!technicalKey && keys.length === 0) {
      setMessage({ kind: 'err', text: 'Choisissez au moins un champ comme clé d’association.' });
      return;
    }
    const next: Scenario = technicalKey
      ? draft
      : { ...draft, association: { ...draft.association, primary: { kind: 'field', fieldKeys: keys } } };
    try {
      const saved = await updateScenario(next, base.updatedAt);
      setBase(saved);
      setDraft(saved);
      setKeys(associationKeys(saved));
      setMessage({
        kind: 'ok',
        text: saved.revision > base.revision ? `Révision ${saved.revision} enregistrée.` : 'Modifications enregistrées.',
      });
    } catch (e) {
      setMessage({ kind: 'err', text: storageErrorMessage(e) });
    }
  }

  return (
    <section aria-labelledby="editor-title">
      <div className="row between">
        <h2 id="editor-title" dir="auto">
          Modifier « {base.name} »
        </h2>
        <button type="button" className="secondary" onClick={onClose}>
          Retour à la liste
        </button>
      </div>
      <p className="muted small">
        {base.domain} · {RECORD_TYPE_LABELS[base.recordType]} · révision {base.revision} ({scenarioStatusLabel(base.status)}) ·
        adresse de départ <span dir="ltr">{base.startUrl}</span>
      </p>
      {base.status === 'validated' && (
        <p className="alert warn small">
          Ce scénario est validé : l’enregistrement créera la révision {base.revision + 1}. Les exécutions passées restent
          liées à leur révision.
        </p>
      )}

      <form
        className="card form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label>
          Nom
          <input
            type="text"
            value={draft.name}
            maxLength={200}
            required
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </label>
        <label>
          État
          <select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as Scenario['status'] })}>
            <option value="draft">Brouillon</option>
            <option value="validated">Validé</option>
          </select>
        </label>

        <fieldset className="full">
          <legend>Champs</legend>
          <div className="table-scroll">
            <table className="data">
              <thead>
                <tr>
                  <th scope="col">Libellé</th>
                  <th scope="col">Clé technique</th>
                  <th scope="col">Type</th>
                  <th scope="col">Obligatoire</th>
                  <th scope="col">Sensible</th>
                  {!technicalKey && <th scope="col">Clé d’association</th>}
                </tr>
              </thead>
              <tbody>
                {draft.fields.map((f) => (
                  <tr key={f.key}>
                    <td>
                      <input
                        type="text"
                        value={f.label}
                        maxLength={300}
                        required
                        aria-label={`Libellé du champ ${f.key}`}
                        onChange={(e) => updateField(f.key, { label: e.target.value })}
                      />
                    </td>
                    <td>
                      <code>{f.key}</code>
                    </td>
                    <td>
                      <select
                        value={f.valueType}
                        aria-label={`Type du champ ${f.key}`}
                        onChange={(e) => updateField(f.key, { valueType: e.target.value as FieldValueType })}
                      >
                        {Object.entries(TYPE_LABELS).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        checked={f.required}
                        disabled={f.sensitive}
                        aria-label={`Champ ${f.key} obligatoire`}
                        onChange={(e) => updateField(f.key, { required: e.target.checked })}
                      />
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        checked={f.sensitive}
                        aria-label={`Champ ${f.key} sensible (jamais lu)`}
                        onChange={(e) => updateField(f.key, { sensitive: e.target.checked, ...(e.target.checked ? { required: false } : {}) })}
                      />
                    </td>
                    {!technicalKey && (
                      <td>
                        <input
                          type="checkbox"
                          checked={keys.includes(f.key)}
                          disabled={f.sensitive || (!keys.includes(f.key) && keys.length >= 5)}
                          aria-label={`Champ ${f.key} dans la clé d’association`}
                          onChange={(e) =>
                            setKeys((k) => (e.target.checked ? [...k, f.key] : k.filter((x) => x !== f.key)))
                          }
                        />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small">
            La clé d’association identifie chaque enregistrement (matricule, référence…) et sert à repérer les doublons.
          </p>
        </fieldset>

        <label className="full inline-check">
          <input
            type="checkbox"
            checked={draft.association.fallback === 'detailUrl'}
            onChange={(e) =>
              setDraft({ ...draft, association: { ...draft.association, fallback: e.target.checked ? 'detailUrl' : 'none' } })
            }
          />
          À défaut de clé, identifier l’enregistrement par l’adresse de sa fiche (association signalée comme incertaine)
        </label>

        <label>
          Doublons
          <select
            value={draft.duplicates}
            onChange={(e) => setDraft({ ...draft, duplicates: e.target.value as Scenario['duplicates'] })}
          >
            <option value="flagOnly">Signalés, inclus dans l’export</option>
            <option value="flagAndExcludeFromExport">Signalés, exclus de l’export par défaut</option>
          </select>
        </label>

        {LIMITS.map(({ key, label, min, max }) => (
          <label key={key}>
            {label}
            <input
              type="number"
              min={min}
              max={max}
              step={1}
              required
              value={draft.limits[key]}
              onChange={(e) => setDraft({ ...draft, limits: { ...draft.limits, [key]: Number(e.target.value) } })}
            />
          </label>
        ))}

        <div className="full row">
          <button type="submit" disabled={!changed}>
            Enregistrer
          </button>
          <button
            type="button"
            className="secondary"
            disabled={!changed}
            onClick={() => {
              setDraft(base);
              setKeys(associationKeys(base));
            }}
          >
            Annuler les modifications
          </button>
        </div>
        <div className="full" aria-live="polite">
          {message && (
            <p className={`alert ${message.kind}`} role={message.kind === 'err' ? 'alert' : 'status'}>
              {message.text}
            </p>
          )}
        </div>
      </form>

      <section className="card" aria-labelledby="revisions-title">
        <h3 id="revisions-title">Révisions</h3>
        <ul className="plain">
          {revisions.map((r) => (
            <li key={r.revision} className="row between">
              <span>
                Révision {r.revision} — {scenarioStatusLabel(r.status)} — {formatDate(r.updatedAt)}
                {r.revision === base.revision ? ' (actuelle)' : ''}
              </span>
              <button
                type="button"
                className="link"
                onClick={() => {
                  const { filename, json } = exportScenario(r);
                  downloadText(filename, json);
                }}
              >
                Exporter la révision {r.revision}
              </button>
            </li>
          ))}
        </ul>
      </section>
    </section>
  );
}
