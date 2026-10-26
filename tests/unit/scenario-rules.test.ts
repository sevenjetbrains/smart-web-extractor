import { describe, expect, it } from 'vitest';
import { detectPage } from '../../src/content/detector';
import { extract } from '../../src/content/extractor';
import { ScenarioSchema } from '../../src/shared/schemas';
import { buildManualRun } from '../../src/storage/manual-run';
import { buildScenario } from '../../src/storage/scenarios';
import {
  extractRequestFromScenario,
  scenarioInputFromDetection,
  type FieldConfig,
} from '../../src/ui/sidepanel/scenario-rules';
import { extraction, field, v2Scenario } from './helpers/scenarios';
import { TEST_PAGES_URL, loadPage } from './helpers/pages';

/** Scénario appris sur liste-simple.html, comme le fait le panneau latéral. */
function learnFromListeSimple(patch: (config: Record<string, FieldConfig>, labels: Record<string, string>) => void = () => {}) {
  const report = detectPage(loadPage('liste-simple.html'));
  const source = report.sources.find((s) => s.kind === 'table')!;
  const config: Record<string, FieldConfig> = {};
  const labels: Record<string, string> = {};
  for (const c of source.columns) {
    config[c.id] = { selected: true, label: c.label, required: false, sensitive: false, valueType: c.valueType };
    labels[c.label] = c.id;
  }
  patch(config, labels);
  const input = scenarioInputFromDetection(source, source.columns, config, 'Agents', `${TEST_PAGES_URL}/liste-simple.html`);
  return buildScenario(input);
}

describe('scénario créé depuis le panneau de détection', () => {
  it('conserve les règles, jamais les valeurs de la page', () => {
    const scenario = learnFromListeSimple((config, labels) => {
      config[labels.Nom!]!.label = 'Nom complet';
      config[labels.Matricule!]!.required = true;
    });
    expect(ScenarioSchema.safeParse(scenario).success).toBe(true);
    expect(scenario).toMatchObject({
      domain: '127.0.0.1',
      recordType: 'list',
      extractionSource: { kind: 'table', headerMode: 'explicit' },
      association: { primary: { kind: 'field', fieldKeys: ['matricule'] } },
    });
    expect(scenario.fields.map((f) => [f.key, f.label, f.source, f.required])).toEqual([
      ['matricule', 'Matricule', 'list', true],
      ['nom_complet', 'Nom complet', 'list', false],
      ['grade', 'Grade', 'list', false],
    ]);
    const json = JSON.stringify(scenario);
    for (const value of ['00123', 'Benali', 'Ingénieur', 'محمد']) expect(json).not.toContain(value);
  });

  it('marque un champ sensible sans jamais l’extraire', () => {
    const scenario = learnFromListeSimple((config, labels) => {
      config[labels.Grade!]!.sensitive = true;
      config[labels.Grade!]!.required = true;
    });
    const grade = scenario.fields.find((f) => f.key === 'grade')!;
    expect(grade).toMatchObject({ sensitive: true, required: false });
    const prepared = extractRequestFromScenario(scenario);
    expect(prepared.ok && prepared.request.fields.map((f) => f.key)).toEqual(['matricule', 'nom']);
  });

  it('extrait une autre page du domaine avec ses propres valeurs (colonnes repérées par en-tête)', () => {
    const scenario = learnFromListeSimple((config, labels) => {
      config[labels.Matricule!]!.required = true;
    });
    const prepared = extractRequestFromScenario(scenario);
    if (!prepared.ok) throw new Error(prepared.message);

    const result = extract(loadPage('liste-agents-rh.html'), prepared.request);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.rows).toEqual([
      { matricule: '01001', nom: 'Haddad Samir', grade: 'Attaché' },
      { matricule: '01002', nom: 'Martin Chloé', grade: 'Rédactrice' },
      { matricule: null, nom: 'Nouvel agent', grade: 'Stagiaire' },
      { matricule: '01001', nom: 'Haddad Samir', grade: 'Attaché' },
    ]);

    const { records } = buildManualRun({ scenario, extraction: result.data, pageUrl: `${TEST_PAGES_URL}/liste-agents-rh.html` });
    expect(records.map((r) => r.status)).toEqual([
      ['complete'],
      ['complete'],
      ['incomplete', 'uncertainMatch'],
      ['complete', 'duplicate'],
    ]);
  });

  it('refuse d’extraire un scénario sans source ou sans champ extractible', () => {
    expect(extractRequestFromScenario(v2Scenario({ extractionSource: undefined }))).toMatchObject({ ok: false });
    expect(extractRequestFromScenario(v2Scenario({ fields: [field('a', { sensitive: true })] }))).toMatchObject({ ok: false });
    expect(extractRequestFromScenario(v2Scenario({ fields: [field('a', { listLocator: undefined })] }))).toMatchObject({ ok: false });
  });
});

describe('adresse source d’un enregistrement', () => {
  it('ignore un lien non http(s) venant de la page', () => {
    const scenario = v2Scenario({ fields: [field('matricule'), field('fiche', { read: 'href' })] });
    const { records } = buildManualRun({
      scenario,
      extraction: extraction([{ matricule: '1', fiche: 'javascript:alert(document.cookie)' }]),
      pageUrl: `${TEST_PAGES_URL}/liste.html`,
    });
    expect(records[0]!.sourceUrl).toBe(`${TEST_PAGES_URL}/liste.html`);
  });
});
