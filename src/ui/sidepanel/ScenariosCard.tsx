import type { Scenario } from '../../shared/types';
import { scenarioStatusLabel } from '../lib/format';
import type { DetectionApi } from './useDetection';

/**
 * Scénarios enregistrés pour le domaine de la page : ils s'appliquent à la
 * page courante, avec ses propres valeurs (les règles sont mémorisées, pas les
 * valeurs de la page d'apprentissage).
 */
export function ScenariosCard({
  scenarios,
  selectedId,
  onSelect,
  api,
  disabled,
}: {
  scenarios: Scenario[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  api: DetectionApi;
  disabled: boolean;
}) {
  if (scenarios.length === 0) return null;
  const selected = scenarios.find((s) => s.id === selectedId) ?? scenarios[0]!;

  return (
    <section className="card" aria-labelledby="scenarios-title">
      <h2 id="scenarios-title">Scénarios de ce domaine</h2>
      <div className="stack">
        <label className="small">
          Scénario{' '}
          <select value={selected.id} onChange={(e) => onSelect(e.target.value)}>
            {scenarios.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} — révision {s.revision} ({scenarioStatusLabel(s.status)})
              </option>
            ))}
          </select>
        </label>
        <p className="muted small">
          {selected.fields.filter((f) => !f.sensitive).length} champ(s) : {selected.fields.filter((f) => !f.sensitive).map((f) => f.label).join(', ')}
        </p>
        <div className="row">
          <button
            type="button"
            onClick={() => void api.extractWithScenario(selected)}
            disabled={disabled || api.extraction.status === 'loading'}
          >
            Extraire avec ce scénario
          </button>
        </div>
      </div>
    </section>
  );
}
