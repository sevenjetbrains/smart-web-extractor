/**
 * Migration des scénarios enregistrés ou importés dans une version antérieure
 * du format (champ `schemaVersion`, cahier §3.5). Chaque migration fait passer
 * de la version n à n + 1 ; le résultat est ensuite validé par le schéma strict.
 *
 * Historique du format :
 * - v1 : format du cahier des charges (§5.1) ;
 * - v2 : `read` obligatoire sur chaque champ (manière de lire la valeur) et
 *   `extractionSource` facultative (tableau, liste ou champs de fiche).
 */
import { SCENARIO_SCHEMA_VERSION, ScenarioSchema } from '../shared/schemas';
import type { Scenario } from '../shared/types';

type RawScenario = Record<string, unknown>;

const MIGRATIONS: Record<number, (raw: RawScenario) => RawScenario> = {
  1: (raw) => ({
    ...raw,
    schemaVersion: 2,
    fields: Array.isArray(raw.fields)
      ? raw.fields.map((field: unknown) =>
          isObject(field) && !('read' in field) ? { ...field, read: 'text' } : field,
        )
      : raw.fields,
  }),
};

function isObject(value: unknown): value is RawScenario {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export type MigrationResult =
  | { ok: true; scenario: Scenario; migratedFrom: number | null }
  | { ok: false; message: string; issues: string[] };

export function migrateScenario(raw: unknown): MigrationResult {
  if (!isObject(raw)) return { ok: false, message: 'Le contenu n’est pas un scénario.', issues: [] };
  const version = raw.schemaVersion;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return { ok: false, message: 'Version du format absente ou invalide (schemaVersion).', issues: [] };
  }
  if (version > SCENARIO_SCHEMA_VERSION) {
    return {
      ok: false,
      message: `Ce scénario utilise un format plus récent (version ${version}) : mettez l’extension à jour.`,
      issues: [],
    };
  }

  let current = raw;
  for (let v = version; v < SCENARIO_SCHEMA_VERSION; v++) {
    current = MIGRATIONS[v]!(current);
  }

  const parsed = ScenarioSchema.safeParse(current);
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 10).map((issue) => {
      const path = issue.path.join('.');
      return path ? `${path} : ${issue.message}` : issue.message;
    });
    return { ok: false, message: 'Le scénario ne respecte pas le format attendu.', issues };
  }
  return { ok: true, scenario: parsed.data, migratedFrom: version < SCENARIO_SCHEMA_VERSION ? version : null };
}
