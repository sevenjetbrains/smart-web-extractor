import { describe, expect, it } from 'vitest';
import { StorageError } from '../../src/storage/errors';
import {
  createScenario,
  defaultAssociation,
  deleteScenario,
  duplicateScenario,
  exportScenario,
  getScenario,
  getScenarioRevision,
  listRevisions,
  listScenarios,
  prepareImport,
  saveImportedScenario,
  updateScenario,
  type NewScenarioInput,
} from '../../src/storage/scenarios';
import { DEFAULT_SETTINGS, getSettings, updateSettings } from '../../src/storage/settings';
import { field, v1Scenario, v2Scenario } from './helpers/scenarios';
import { storageArea, useFakeStorage } from './helpers/storage';

useFakeStorage();

const input: NewScenarioInput = {
  name: '  Agents  ',
  startUrl: 'http://127.0.0.1:5174/liste-simple.html?page=1',
  recordType: 'list',
  fields: [field('matricule', { required: true }), field('nom')],
};

async function rejection(promise: Promise<unknown>): Promise<StorageError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(StorageError);
  return error as StorageError;
}

describe('scénarios : création et lecture', () => {
  it('crée un brouillon complet en révision 1', async () => {
    const scenario = await createScenario(input);
    expect(scenario).toMatchObject({
      schemaVersion: 2,
      revision: 1,
      name: 'Agents',
      domain: '127.0.0.1',
      status: 'draft',
      compatibleModes: ['semi_automatic'],
      steps: [],
      association: { primary: { kind: 'field', fieldKeys: ['matricule'] }, fallback: 'detailUrl' },
    });
    expect(scenario.id).toMatch(/^scn_[0-9a-f]{32}$/);
    expect(await getScenario(scenario.id)).toEqual(scenario);
    expect(await listScenarios()).toEqual([scenario]);
  });

  it('choisit le premier champ comme clé quand aucun n’est obligatoire, jamais un champ sensible', () => {
    expect(defaultAssociation([field('secret', { sensitive: true }), field('ref')]).primary).toEqual({ kind: 'field', fieldKeys: ['ref'] });
  });

  it('refuse un scénario sans page http(s) ou invalide', async () => {
    expect((await rejection(createScenario({ ...input, startUrl: 'file:///C:/page.html' }))).code).toBe('INVALID');
    expect((await rejection(createScenario({ ...input, name: '' }))).code).toBe('INVALID');
  });

  it('plafonne la taille d’un scénario à 256 Ko', async () => {
    const huge = Array.from({ length: 200 }, (_, i) => field(`c${i}`, { label: 'x'.repeat(300), listLocator: { strategies: Array.from({ length: 10 }, () => ({ kind: 'css' as const, selector: 'y'.repeat(1000) })), scope: 'row', expectedCount: 'one' } }));
    expect((await rejection(createScenario({ ...input, fields: huge }))).code).toBe('TOO_LARGE');
  });

  it('ignore une entrée corrompue et migre une entrée de version 1 à la lecture', async () => {
    await storageArea.set({ 'swx.scenario.corrompu': { schemaVersion: 2, id: 'corrompu' }, 'swx.scenario.scenario_agents': v1Scenario() });
    const list = await listScenarios();
    expect(list.map((s) => s.id)).toEqual(['scenario_agents']);
    expect(list[0]!.schemaVersion).toBe(2);
    // La version migrée est réécrite au nouveau format.
    expect((await storageArea.get('swx.scenario.scenario_agents'))['swx.scenario.scenario_agents']).toMatchObject({ schemaVersion: 2 });
  });

  it('signale un dépassement de quota sans perdre les scénarios existants', async () => {
    const kept = await createScenario(input);
    storageArea.quota = (await storageArea.getBytesInUse(null)) + 100;
    expect((await rejection(createScenario(input))).code).toBe('QUOTA_EXCEEDED');
    expect(await listScenarios()).toEqual([kept]);
  });
});

describe('scénarios : modifications et révisions', () => {
  it('modifie un brouillon sur place, sans nouvelle révision', async () => {
    const draft = await createScenario(input);
    const saved = await updateScenario({ ...draft, name: 'Agents (v2)' }, draft.updatedAt);
    expect(saved).toMatchObject({ name: 'Agents (v2)', revision: 1, createdAt: draft.createdAt });
    expect(saved.updatedAt > draft.updatedAt).toBe(true);
    expect(await listRevisions(draft.id)).toHaveLength(1);
  });

  it('crée une nouvelle révision à chaque modification d’un scénario validé et conserve les précédentes', async () => {
    const draft = await createScenario(input);
    const validated = await updateScenario({ ...draft, status: 'validated' }, draft.updatedAt);
    expect(validated.revision).toBe(1);

    const r2 = await updateScenario({ ...validated, fields: [validated.fields[0]!, { ...validated.fields[1]!, label: 'Nom complet' }] }, validated.updatedAt);
    expect(r2.revision).toBe(2);
    const r3 = await updateScenario({ ...r2, name: 'Agents r3' }, r2.updatedAt);
    expect(r3.revision).toBe(3);

    expect((await listRevisions(draft.id)).map((s) => s.revision)).toEqual([3, 2, 1]);
    // Une exécution liée à la révision 1 retrouve exactement ses règles.
    expect(await getScenarioRevision(draft.id, 1)).toEqual(validated);
    expect((await getScenarioRevision(draft.id, 2))!.fields[1]!.label).toBe('Nom complet');
    expect(await getScenarioRevision(draft.id, 3)).toEqual(r3);
    expect(await getScenarioRevision(draft.id, 4)).toBeNull();
  });

  it('refuse d’écraser une modification faite ailleurs', async () => {
    const draft = await createScenario(input);
    await updateScenario({ ...draft, name: 'Fenêtre A' }, draft.updatedAt);
    expect((await rejection(updateScenario({ ...draft, name: 'Fenêtre B' }, draft.updatedAt))).code).toBe('CONFLICT');
    expect((await getScenario(draft.id))!.name).toBe('Fenêtre A');
  });

  it('interdit de changer le domaine ou l’identifiant', async () => {
    const draft = await createScenario(input);
    const moved = await rejection(updateScenario({ ...draft, startUrl: 'https://autre.exemple/' }, draft.updatedAt));
    expect(moved.code).toBe('INVALID');
    const renamed = await updateScenario({ ...draft, createdAt: '2000-01-01T00:00:00.000Z', revision: 99 }, draft.updatedAt);
    expect(renamed).toMatchObject({ createdAt: draft.createdAt, revision: 1 });
  });

  it('duplique un scénario en nouveau brouillon', async () => {
    const draft = await createScenario(input);
    const validated = await updateScenario({ ...draft, status: 'validated' }, draft.updatedAt);
    const r2 = await updateScenario({ ...validated, name: 'Agents' }, validated.updatedAt);
    const copy = await duplicateScenario(r2.id);
    expect(copy).toMatchObject({ name: 'Agents (copie)', revision: 1, status: 'draft', fields: r2.fields });
    expect(copy.id).not.toBe(r2.id);
    expect(await listScenarios()).toHaveLength(2);
  });

  it('supprime un scénario avec toutes ses révisions', async () => {
    const other = await createScenario(input);
    const draft = await createScenario(input);
    const validated = await updateScenario({ ...draft, status: 'validated' }, draft.updatedAt);
    await updateScenario({ ...validated, name: 'r2' }, validated.updatedAt);
    await deleteScenario(draft.id);
    expect(await listScenarios()).toEqual([other]);
    expect([...storageArea.data.keys()].filter((k) => k.includes(draft.id))).toEqual([]);
  });
});

describe('scénarios : export et import', () => {
  it('exporte uniquement les règles et réimporte un nouveau brouillon', async () => {
    const draft = await createScenario(input);
    const validated = await updateScenario({ ...draft, status: 'validated' }, draft.updatedAt);
    const { filename, json } = exportScenario(validated);
    expect(filename).toBe('scenario-agents-r1.json');
    expect(Object.keys(JSON.parse(json)).sort()).toEqual(Object.keys(validated).sort());

    const imported = prepareImport(json);
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    expect(imported.scenario).toMatchObject({ status: 'draft', revision: 1, fields: validated.fields, domain: '127.0.0.1' });
    expect(imported.scenario.id).not.toBe(validated.id);
    await saveImportedScenario(imported.scenario);
    expect(await listScenarios()).toHaveLength(2);
  });

  it('importe et migre un fichier de version 1', () => {
    const imported = prepareImport(JSON.stringify(v1Scenario()));
    expect(imported).toMatchObject({ ok: true, migratedFrom: 1, scenario: { schemaVersion: 2, status: 'draft', revision: 1 } });
  });

  it.each([
    ['JSON invalide', '{ "schemaVersion": 2,', 'pas un JSON valide'],
    ['fichier trop volumineux', 'x'.repeat(256 * 1024 + 1), 'trop volumineux'],
    ['propriété inconnue', JSON.stringify({ ...v2Scenario(), results: [] }), 'format attendu'],
    ['résultats glissés dans un champ', JSON.stringify({ ...v2Scenario(), fields: [{ ...v2Scenario().fields[0], values: ['00123'] }] }), 'format attendu'],
  ])('rejette un import invalide : %s', (_label, text, message) => {
    const result = prepareImport(text);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain(message);
  });

  it('détaille les erreurs de format', () => {
    const result = prepareImport(JSON.stringify({ ...v2Scenario(), startUrl: 'https://ailleurs.exemple/' }));
    expect(result).toMatchObject({ ok: false, issues: ['startUrl : L’adresse de départ doit appartenir au domaine du scénario.'] });
  });
});

describe('préférences', () => {
  it('fournit les valeurs par défaut puis les modifications', async () => {
    expect(await getSettings()).toEqual(DEFAULT_SETTINGS);
    await updateSettings({ retentionDays: 90 });
    expect(await getSettings()).toEqual({ ...DEFAULT_SETTINGS, retentionDays: 90 });
  });

  it('remplace une valeur corrompue par sa valeur par défaut', async () => {
    await storageArea.set({ 'swx.settings': { retentionDays: -4, warningAcknowledgedAt: '2026-10-26T09:00:00.000Z', inconnu: 1 } });
    expect(await getSettings()).toEqual({ retentionDays: 30, warningAcknowledgedAt: '2026-10-26T09:00:00.000Z' });
  });

  it('refuse une durée de conservation invalide', async () => {
    await expect(updateSettings({ retentionDays: 0 })).rejects.toThrow();
  });
});
