import { describe, expect, it } from 'vitest';
import { ScenarioSchema } from '../../src/shared/schemas';
import { migrateScenario } from '../../src/storage/migrations';
import { v1Scenario, v2Scenario } from './helpers/scenarios';

describe('migration des scénarios (schemaVersion)', () => {
  it('migre un scénario de version 1 (format du cahier) vers la version courante', () => {
    const result = migrateScenario(v1Scenario());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.migratedFrom).toBe(1);
    expect(result.scenario.schemaVersion).toBe(2);
    expect(result.scenario.fields.map((f) => f.read)).toEqual(['text', 'text', 'text']);
    // Le reste du scénario est conservé tel quel.
    expect(result.scenario.revision).toBe(3);
    expect(result.scenario.steps).toHaveLength(2);
  });

  it('laisse intact un scénario déjà au format courant', () => {
    const result = migrateScenario(v2Scenario());
    expect(result).toMatchObject({ ok: true, migratedFrom: null, scenario: v2Scenario() });
  });

  it.each([
    ['version future', { ...v2Scenario(), schemaVersion: 99 }, 'format plus récent'],
    ['version absente', { ...v2Scenario(), schemaVersion: undefined }, 'schemaVersion'],
    ['version non entière', { ...v2Scenario(), schemaVersion: 1.5 }, 'schemaVersion'],
    ['tableau', [], 'pas un scénario'],
    ['null', null, 'pas un scénario'],
  ])('refuse : %s', (_label, raw, message) => {
    const result = migrateScenario(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain(message);
  });
});

describe('schéma strict des scénarios', () => {
  const valid = v2Scenario();
  const rejects = (value: unknown) => expect(ScenarioSchema.safeParse(value).success).toBe(false);

  it('accepte un scénario valide', () => {
    expect(ScenarioSchema.safeParse(valid).success).toBe(true);
  });

  it('refuse toute propriété inconnue, y compris __proto__', () => {
    rejects({ ...valid, results: [{ nom: 'x' }] });
    rejects({ ...valid, fields: [{ ...valid.fields[0], value: '00123' }] });
    rejects(JSON.parse(`{"__proto__": {"admin": true}, ${JSON.stringify(valid).slice(1)}`));
  });

  it('refuse une adresse de départ hors du domaine', () => {
    rejects({ ...valid, startUrl: 'https://autre.exemple/agents' });
    rejects({ ...valid, startUrl: 'javascript:alert(1)' });
    rejects({ ...valid, domain: 'Intranet.Exemple' });
  });

  it('refuse les incohérences internes', () => {
    rejects({ ...valid, fields: [valid.fields[0], valid.fields[0]] });
    rejects({ ...valid, association: { primary: { kind: 'field', fieldKeys: ['inconnu'] }, fallback: 'none' } });
    rejects({ ...valid, compatibleModes: ['automatic', 'automatic'] });
    rejects({ ...valid, fields: [] });
  });

  it('borne les tailles et les valeurs', () => {
    rejects({ ...valid, name: 'x'.repeat(201) });
    rejects({ ...valid, name: '   ' });
    rejects({ ...valid, limits: { ...valid.limits, delayBetweenActionsMs: 100 } });
    rejects({ ...valid, fields: Array.from({ length: 201 }, (_, i) => ({ ...valid.fields[0], key: `c${i}` })) });
    rejects({
      ...valid,
      steps: [
        {
          id: 's1',
          type: 'waitFor',
          successCondition: { kind: 'rowCountChanged' },
          timeoutMs: 500,
          retry: { maxAttempts: 9, backoffMs: 0, onFailure: 'pause' },
        },
      ],
    });
  });

  it('refuse une condition de réussite ou une stratégie qui ne sont pas déclaratives', () => {
    const step = {
      id: 's1',
      type: 'waitFor',
      timeoutMs: 1000,
      retry: { maxAttempts: 1, backoffMs: 0, onFailure: 'pause' },
    };
    rejects({ ...valid, steps: [{ ...step, successCondition: { kind: 'script', code: 'return true' } }] });
    rejects({
      ...valid,
      fields: [{ ...valid.fields[0], listLocator: { strategies: [{ kind: 'xpath', value: '//td' }], scope: 'row', expectedCount: 'one' } }],
    });
  });
});
