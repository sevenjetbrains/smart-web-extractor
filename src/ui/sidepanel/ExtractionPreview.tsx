import { Warnings } from './SourceDetail';
import type { Extraction } from './useDetection';

const MAX_PREVIEW_ROWS = 50;

/**
 * Aperçu du résultat d'une extraction. Une extraction faite avec un scénario
 * enregistré peut être conservée comme nouvelle exécution.
 */
export function ExtractionPreview({ extraction, onSave }: { extraction: Extraction; onSave: () => void }) {
  if (extraction.status === 'idle' || extraction.status === 'loading') return null;
  if (extraction.status === 'error') {
    return (
      <p className="alert err" role="alert">
        {extraction.error.message}
      </p>
    );
  }

  const { columns, result, scenario, saved } = extraction;
  const incomplete = result.rows.filter((row) => columns.some((c) => c.required && row[c.key] === null)).length;
  const fieldWarnings = columns.flatMap((c) =>
    (result.fieldWarnings[c.key] ?? []).map((w) => ({ ...w, message: `${c.label} : ${w.message}` })),
  );

  return (
    <section className="card" aria-labelledby="extraction-title">
      <h2 id="extraction-title">Résultat de l’extraction</h2>
      {scenario && (
        <p className="muted small" dir="auto">
          Scénario « {scenario.name} », révision {scenario.revision}
        </p>
      )}
      <p className="alert ok" role="status">
        {result.rows.length} ligne(s) extraite(s)
        {incomplete > 0 ? ` — ${incomplete} incomplète(s) (champ obligatoire manquant)` : ''}.
      </p>
      <Warnings items={[...result.warnings, ...fieldWarnings]} />

      <div aria-live="polite">
        {scenario ? (
          saved ? (
            <p className="alert ok small">
              {saved.count} enregistrement(s) conservé(s) dans une nouvelle exécution. Consultez-les dans le tableau de bord.
            </p>
          ) : (
            <button type="button" onClick={onSave} disabled={result.rows.length === 0}>
              Enregistrer les résultats
            </button>
          )
        ) : (
          <p className="muted small">
            Aperçu non enregistré. Pour conserver les résultats, enregistrez ces règles comme scénario puis extrayez
            avec ce scénario.
          </p>
        )}
      </div>

      <div className="table-scroll">
        <table className="preview">
          <thead>
            <tr>
              <th scope="col">#</th>
              {columns.map((c) => (
                <th key={c.key} scope="col" dir="auto">
                  {c.label}
                  {c.required ? ' *' : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.rows.slice(0, MAX_PREVIEW_ROWS).map((row, i) => {
              const missingRequired = columns.some((c) => c.required && row[c.key] === null);
              return (
                <tr key={i} className={missingRequired ? 'incomplete' : undefined}>
                  <td className="muted">{i + 1}</td>
                  {columns.map((c) =>
                    row[c.key] === null ? (
                      <td key={c.key} className="muted" title="Valeur manquante">
                        —
                      </td>
                    ) : (
                      <td key={c.key} dir="auto">
                        {row[c.key]}
                      </td>
                    ),
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {result.rows.length > MAX_PREVIEW_ROWS && (
        <p className="muted small">Aperçu limité aux {MAX_PREVIEW_ROWS} premières lignes.</p>
      )}
    </section>
  );
}
