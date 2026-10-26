/**
 * Scénarios (règles), dans chrome.storage.local (cahier §3.5 et §5.3).
 *
 * - `swx.scenario.<id>` : version courante du scénario ;
 * - `swx.revision.<id>.<n>` : révisions remplacées, conservées pour que les
 *   exécutions passées restent liées à la révision qu'elles ont utilisée.
 *
 * Toute modification d'un scénario validé crée une nouvelle révision. Un
 * brouillon est modifié sur place. Chaque écriture est validée par le schéma
 * strict et plafonnée en taille.
 */
import { slugify } from '../shared/field-keys';
import { MAX_SCENARIO_BYTES, SCENARIO_SCHEMA_VERSION, ScenarioSchema, httpHostname } from '../shared/schemas';
import type { AssociationKey, ExtractionSource, FieldRule, Scenario } from '../shared/types';
import { StorageError, toStorageError } from './errors';
import { migrateScenario } from './migrations';

const SCENARIO_PREFIX = 'swx.scenario.';
const REVISION_PREFIX = 'swx.revision.';

const scenarioKey = (id: string) => `${SCENARIO_PREFIX}${id}`;
const revisionKey = (id: string, revision: number) => `${REVISION_PREFIX}${id}.${revision}`;

export const DEFAULT_LIMITS: Scenario['limits'] = {
  maxRecords: 500,
  maxPages: 50,
  delayBetweenActionsMs: 500,
  maxActionsPerMinute: 60,
};

export function newScenarioId(): string {
  return `scn_${crypto.randomUUID().replaceAll('-', '')}`;
}

function byteSize(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

/** Valide un scénario avant écriture ; lève une StorageError explicite sinon. */
function assertStorable(scenario: Scenario): Scenario {
  const parsed = ScenarioSchema.safeParse(scenario);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? ` (${issue.path.join('.')})` : '';
    throw new StorageError('INVALID', `Scénario invalide${where} : ${issue?.message ?? 'format inattendu'}.`);
  }
  if (byteSize(parsed.data) > MAX_SCENARIO_BYTES) {
    throw new StorageError('TOO_LARGE', `Scénario trop volumineux (plus de ${MAX_SCENARIO_BYTES / 1024} Ko).`);
  }
  return parsed.data;
}

async function write(items: Record<string, unknown>): Promise<void> {
  try {
    await chrome.storage.local.set(items);
  } catch (e) {
    throw toStorageError(e);
  }
}

/** Lit et migre une valeur stockée. Une valeur migrée est réécrite au nouveau format. */
async function readStored(key: string, raw: unknown): Promise<Scenario | null> {
  if (raw === undefined) return null;
  const migrated = migrateScenario(raw);
  if (!migrated.ok) return null;
  if (migrated.migratedFrom !== null) await write({ [key]: migrated.scenario });
  return migrated.scenario;
}

/** Horodatage strictement postérieur au précédent (sert de jeton de version). */
function nextTimestamp(previous?: string): string {
  let now = Date.now();
  if (previous) now = Math.max(now, Date.parse(previous) + 1);
  return new Date(now).toISOString();
}

// ---------- Lecture ----------

export async function listScenarios(): Promise<Scenario[]> {
  const all = await chrome.storage.local.get(null);
  const scenarios: Scenario[] = [];
  for (const [key, raw] of Object.entries(all)) {
    if (!key.startsWith(SCENARIO_PREFIX)) continue;
    const scenario = await readStored(key, raw);
    if (scenario) scenarios.push(scenario);
  }
  return scenarios.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getScenario(id: string): Promise<Scenario | null> {
  const key = scenarioKey(id);
  return readStored(key, (await chrome.storage.local.get(key))[key]);
}

/** Toutes les révisions connues d'un scénario, de la plus récente à la plus ancienne. */
export async function listRevisions(id: string): Promise<Scenario[]> {
  const all = await chrome.storage.local.get(null);
  const prefix = `${REVISION_PREFIX}${id}.`;
  const revisions: Scenario[] = [];
  for (const [key, raw] of Object.entries(all)) {
    if (!key.startsWith(prefix) && key !== scenarioKey(id)) continue;
    const scenario = await readStored(key, raw);
    if (scenario) revisions.push(scenario);
  }
  return revisions.sort((a, b) => b.revision - a.revision);
}

/** Révision précise d'un scénario (celle utilisée par une exécution). */
export async function getScenarioRevision(id: string, revision: number): Promise<Scenario | null> {
  const current = await getScenario(id);
  if (current?.revision === revision) return current;
  const key = revisionKey(id, revision);
  return readStored(key, (await chrome.storage.local.get(key))[key]);
}

// ---------- Écriture ----------

export interface NewScenarioInput {
  name: string;
  startUrl: string;
  recordType: Scenario['recordType'];
  fields: FieldRule[];
  extractionSource?: ExtractionSource;
  association?: AssociationKey;
}

/** Clé d'association par défaut : les champs obligatoires, sinon le premier champ. */
export function defaultAssociation(fields: FieldRule[]): AssociationKey {
  const usable = fields.filter((f) => !f.sensitive);
  const required = usable.filter((f) => f.required).slice(0, 5);
  const keys = (required.length > 0 ? required : usable.slice(0, 1)).map((f) => f.key);
  return { primary: { kind: 'field', fieldKeys: keys.length > 0 ? keys : [fields[0]!.key] }, fallback: 'detailUrl' };
}

/** Construit un brouillon complet (révision 1) à partir des choix de l'utilisateur. */
export function buildScenario(input: NewScenarioInput, now = new Date()): Scenario {
  const domain = httpHostname(input.startUrl);
  if (!domain) throw new StorageError('INVALID', 'Le scénario doit partir d’une page http(s).');
  const timestamp = now.toISOString();
  return assertStorable({
    schemaVersion: SCENARIO_SCHEMA_VERSION,
    id: newScenarioId(),
    revision: 1,
    name: input.name.trim(),
    domain,
    startUrl: input.startUrl,
    recordType: input.recordType,
    compatibleModes: ['semi_automatic'],
    status: 'draft',
    fields: input.fields,
    steps: [],
    ...(input.extractionSource ? { extractionSource: input.extractionSource } : {}),
    pagination: { kind: 'none' },
    association: input.association ?? defaultAssociation(input.fields),
    limits: DEFAULT_LIMITS,
    duplicates: 'flagOnly',
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

export async function createScenario(input: NewScenarioInput): Promise<Scenario> {
  const scenario = buildScenario(input);
  await write({ [scenarioKey(scenario.id)]: scenario });
  return scenario;
}

/**
 * Enregistre une modification. `expectedUpdatedAt` est la date de la version
 * modifiée : si le scénario a changé entre-temps (autre fenêtre), l'écriture est
 * refusée plutôt que d'écraser silencieusement l'autre modification.
 */
export async function updateScenario(next: Scenario, expectedUpdatedAt: string): Promise<Scenario> {
  const stored = await getScenario(next.id);
  if (!stored) throw new StorageError('NOT_FOUND', 'Ce scénario n’existe plus.');
  if (stored.updatedAt !== expectedUpdatedAt) {
    throw new StorageError('CONFLICT', 'Le scénario a été modifié ailleurs entre-temps : rechargez-le avant de l’enregistrer.');
  }
  const newRevision = stored.status === 'validated';
  const scenario = assertStorable({
    ...next,
    schemaVersion: SCENARIO_SCHEMA_VERSION,
    id: stored.id,
    domain: stored.domain,
    revision: newRevision ? stored.revision + 1 : stored.revision,
    createdAt: stored.createdAt,
    updatedAt: nextTimestamp(stored.updatedAt),
  });
  if (httpHostname(scenario.startUrl) !== stored.domain) {
    throw new StorageError('INVALID', 'Le domaine d’un scénario ne peut pas être modifié.');
  }
  await write({
    [scenarioKey(scenario.id)]: scenario,
    ...(newRevision ? { [revisionKey(stored.id, stored.revision)]: stored } : {}),
  });
  return scenario;
}

export async function duplicateScenario(id: string): Promise<Scenario> {
  const source = await getScenario(id);
  if (!source) throw new StorageError('NOT_FOUND', 'Ce scénario n’existe plus.');
  const timestamp = new Date().toISOString();
  const copy = assertStorable({
    ...source,
    id: newScenarioId(),
    revision: 1,
    name: `${source.name} (copie)`.slice(0, 200),
    status: 'draft',
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await write({ [scenarioKey(copy.id)]: copy });
  return copy;
}

/** Supprime le scénario et toutes ses révisions (les résultats sont supprimés à part). */
export async function deleteScenario(id: string): Promise<void> {
  const all = await chrome.storage.local.get(null);
  const prefix = `${REVISION_PREFIX}${id}.`;
  const keys = Object.keys(all).filter((key) => key === scenarioKey(id) || key.startsWith(prefix));
  await chrome.storage.local.remove(keys);
}

// ---------- Import et export ----------

/** Fichier d'export : uniquement les règles, jamais de résultat ni de secret. */
export function exportScenario(scenario: Scenario): { filename: string; json: string } {
  return {
    filename: `scenario-${slugify(scenario.name).replaceAll('_', '-')}-r${scenario.revision}.json`,
    json: `${JSON.stringify(assertStorable(scenario), null, 2)}\n`,
  };
}

export type ImportResult =
  | { ok: true; scenario: Scenario; migratedFrom: number | null }
  | { ok: false; message: string; issues: string[] };

/**
 * Prépare l'import d'un fichier JSON non fiable : taille bornée, migration,
 * validation stricte. Le scénario obtenu est un nouveau brouillon (nouvel
 * identifiant, révision 1) ; il n'est enregistré qu'après confirmation du
 * domaine par l'utilisateur (cf. saveImportedScenario).
 */
export function prepareImport(text: string): ImportResult {
  if (new TextEncoder().encode(text).length > MAX_SCENARIO_BYTES) {
    return { ok: false, message: `Fichier trop volumineux (plus de ${MAX_SCENARIO_BYTES / 1024} Ko).`, issues: [] };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, message: 'Le fichier n’est pas un JSON valide.', issues: [] };
  }
  const migrated = migrateScenario(raw);
  if (!migrated.ok) return migrated;
  const timestamp = new Date().toISOString();
  return {
    ok: true,
    migratedFrom: migrated.migratedFrom,
    scenario: { ...migrated.scenario, id: newScenarioId(), revision: 1, status: 'draft', createdAt: timestamp, updatedAt: timestamp },
  };
}

export async function saveImportedScenario(scenario: Scenario): Promise<Scenario> {
  const stored = assertStorable(scenario);
  if (await getScenario(stored.id)) throw new StorageError('CONFLICT', 'Un scénario porte déjà cet identifiant.');
  await write({ [scenarioKey(stored.id)]: stored });
  return stored;
}
