import { describe, expect, it } from 'vitest';
import { detectPage, inferValueType } from '../../src/content/detector';
import type { DetectedSource } from '../../src/shared/content-protocol';
import { loadPage, TEST_PAGES_URL } from './helpers/pages';

const labels = (source: DetectedSource) => source.columns.map((c) => c.label);
const col = (source: DetectedSource, label: string) => {
  const found = source.columns.find((c) => c.label === label);
  if (!found) throw new Error(`colonne « ${label} » absente : ${labels(source).join(', ')}`);
  return found;
};
const codes = (items: { code: string }[]) => items.map((w) => w.code);

describe('détection — tableau avec en-têtes (liste-simple)', () => {
  const report = detectPage(loadPage('liste-simple.html'));
  const table = report.sources.find((s) => s.kind === 'table')!;

  it('détecte le tableau, ses colonnes et ses lignes', () => {
    expect(report.sources.filter((s) => s.kind === 'table')).toHaveLength(1);
    expect(table).toMatchObject({ id: 'table-0', label: 'Liste des agents', headerMode: 'explicit', itemCount: 3 });
    expect(labels(table)).toEqual(['Matricule', 'Nom', 'Grade']);
  });

  it('conserve les zéros initiaux et le texte arabe dans l’aperçu', () => {
    expect(col(table, 'Matricule')).toMatchObject({ samples: ['00123', '00456', '00789'], valueType: 'text' });
    expect(col(table, 'Nom').samples).toContain('محمد العربي');
  });

  it('localise les colonnes par en-tête puis par position', () => {
    expect(col(table, 'Nom').locator.strategies).toEqual([
      { kind: 'context', anchorText: 'Nom', relation: 'columnOfHeader' },
      { kind: 'columnIndex', index: 1 },
    ]);
    expect(table.container.strategies[0]).toEqual({ kind: 'id', value: 'agents' });
  });

  it('détecte les champs du formulaire sans les champs sensibles', () => {
    const fields = report.sources.find((s) => s.kind === 'fields')!;
    expect(labels(fields)).toEqual(['Nom', 'Service', 'Commentaire']);
    expect(report.sensitiveFieldCount).toBe(2);
    expect(codes(report.warnings)).toContain('SENSITIVE_FIELDS_IGNORED');
    expect(JSON.stringify(report)).not.toContain('ne-doit-jamais-etre-lu');
    expect(JSON.stringify(report)).not.toContain('jeton-secret');
  });
});

describe('détection — tableaux sans en-têtes (liste-sans-entetes)', () => {
  const report = detectPage(loadPage('liste-sans-entetes.html'));
  const [effectifs, codesPostaux] = report.sources.filter((s) => s.kind === 'table');

  it('propose la première ligne comme en-tête quand elle ressemble à des libellés', () => {
    expect(effectifs).toMatchObject({ headerMode: 'firstRow', itemCount: 4, label: 'Effectifs par service' });
    expect(labels(effectifs!)).toEqual(['Matricule', 'Nom', 'Service', "Date d'entrée"]);
    expect(codes(effectifs!.warnings)).toContain('HEADER_INFERRED');
  });

  it('signale les valeurs manquantes et déduit le type date', () => {
    expect(col(effectifs!, 'Service').emptyCount).toBe(1);
    expect(codes(col(effectifs!, 'Service').warnings)).toContain('MISSING_VALUES');
    expect(col(effectifs!, "Date d'entrée").valueType).toBe('date');
  });

  it('n’invente pas d’en-tête pour un tableau de données seules', () => {
    expect(codesPostaux).toMatchObject({ headerMode: 'none', itemCount: 3 });
    expect(labels(codesPostaux!)).toEqual(['Colonne 1', 'Colonne 2']);
    expect(codes(codesPostaux!.warnings)).toContain('NO_HEADER');
    expect(col(codesPostaux!, 'Colonne 1').locator.strategies).toEqual([{ kind: 'columnIndex', index: 0 }]);
  });

  it('applique le choix de l’utilisateur sur l’en-tête', () => {
    const overridden = detectPage(loadPage('liste-sans-entetes.html'), {
      headerOverrides: { 'table-0': 'none', 'table-1': 'firstRow' },
    });
    const [first, second] = overridden.sources.filter((s) => s.kind === 'table');
    expect(first).toMatchObject({ headerMode: 'none', itemCount: 5 });
    expect(second).toMatchObject({ headerMode: 'firstRow', itemCount: 2 });
    expect(labels(second!)).toEqual(['31000', 'Oran']);
  });
});

describe('détection — cellules fusionnées', () => {
  const table = detectPage(loadPage('cellules-fusionnees.html')).sources.find((s) => s.kind === 'table')!;

  it('concatène les en-têtes sur plusieurs niveaux et utilise la légende', () => {
    expect(table.label).toBe('Affectations par service');
    expect(labels(table)).toEqual([
      'Identité › Matricule',
      'Identité › Nom',
      'Affectation › Service',
      'Affectation › Grade',
    ]);
    expect(codes(table.warnings)).toContain('MERGED_CELLS');
    expect(table.itemCount).toBe(4);
  });

  it('réplique les valeurs fusionnées', () => {
    expect(col(table, 'Affectation › Service')).toMatchObject({
      samples: ['Logistique', 'Logistique', 'Juridique'],
      emptyCount: 0,
    });
  });
});

describe('détection — liste en cartes', () => {
  const report = detectPage(loadPage('liste-cartes.html'));
  const lists = report.sources.filter((s) => s.kind === 'list');

  it('détecte la liste de cartes et ignore le menu de navigation', () => {
    expect(lists).toHaveLength(1);
    expect(lists[0]).toMatchObject({ label: 'Annuaire des agents', itemCount: 4, itemSelector: ':scope > article.carte-agent' });
  });

  it('nomme les champs à partir des libellés voisins et des classes', () => {
    const list = lists[0]!;
    expect(col(list, 'Nom').samples).toEqual(['Benali Karim', 'Dupont Élodie', 'محمد العربي']);
    expect(col(list, 'Matricule').samples).toEqual(['00123', '00456', '00789']);
    expect(col(list, 'Grade')).toMatchObject({ emptyCount: 1 });
    expect(codes(col(list, 'Grade').warnings)).toContain('MISSING_VALUES');
  });

  it('propose l’adresse des liens vers les fiches', () => {
    const link = lists[0]!.columns.find((c) => c.read === 'href')!;
    expect(link.valueType).toBe('url');
    expect(link.samples[0]).toBe(`${TEST_PAGES_URL}/fiche-agent.html?id=00123`);
  });
});

describe('détection — fiche détaillée', () => {
  const report = detectPage(loadPage('fiche-agent.html'));
  const fields = report.sources.find((s) => s.kind === 'fields')!;
  const value = (label: string) => col(fields, label).samples[0];

  it('ne traite pas le tableau clé/valeur comme un tableau de données', () => {
    expect(report.sources.filter((s) => s.kind === 'table')).toHaveLength(0);
  });

  it('détecte toutes les paires libellé/valeur, dans l’ordre de la page', () => {
    expect(labels(fields)).toEqual([
      'Matricule', 'Nom', 'Grade', 'Date d’entrée', 'Situation', 'Adresse', 'Ville', 'Téléphone', 'Service',
    ]);
    expect(value('Matricule')).toBe('00123');
    expect(value('Date d’entrée')).toBe('12/03/2015');
    expect(value('Situation')).toBe('En activité');
    expect(value('Ville')).toBe('Oran');
    expect(value('Téléphone')).toBe('0550 12 34 56');
    expect(value('Service')).toBe('Informatique');
  });

  it('privilégie identifiants et attributs stables', () => {
    expect(col(fields, 'Matricule').locator.strategies[0]).toEqual({ kind: 'id', value: 'fiche-matricule' });
    expect(col(fields, 'Grade').locator.strategies[0]).toEqual({ kind: 'attribute', name: 'data-field', value: 'grade' });
    expect(col(fields, 'Téléphone').locator.strategies[0]).toEqual({ kind: 'id', value: 'tel' });
  });

  it('exclut le mot de passe', () => {
    expect(labels(fields)).not.toContain('Mot de passe');
    expect(report.sensitiveFieldCount).toBe(1);
  });
});

describe('détection — sélecteurs ambigus', () => {
  const report = detectPage(loadPage('selecteurs-ambigus.html'));
  const tables = report.sources.filter((s) => s.kind === 'table');

  it('distingue les deux tableaux identiques, en signalant la fragilité', () => {
    expect(tables).toHaveLength(2);
    expect(tables[0]!.container).not.toEqual(tables[1]!.container);
    for (const table of tables) expect(codes(table.warnings)).toContain('FRAGILE_LOCATOR');
  });

  it('signale les en-têtes en double et se rabat sur la position', () => {
    const dates = tables[0]!.columns.filter((c) => c.label === 'Date');
    expect(dates).toHaveLength(2);
    for (const date of dates) {
      expect(codes(date.warnings)).toContain('DUPLICATE_HEADER');
      expect(date.locator.strategies.map((s) => s.kind)).toEqual(['columnIndex']);
    }
  });

  it('signale un libellé présent deux fois au lieu de choisir', () => {
    const fields = report.sources.find((s) => s.kind === 'fields')!;
    const noms = fields.columns.filter((c) => c.label === 'Nom');
    expect(noms).toHaveLength(2);
    for (const nom of noms) expect(codes(nom.warnings)).toContain('AMBIGUOUS_LOCATOR');
    // L'identifiant en double n'est pas retenu comme règle.
    for (const nom of noms) expect(nom.locator.strategies.some((s) => s.kind === 'id')).toBe(false);
  });
});

describe('inferValueType', () => {
  it.each([
    [['12', '1 234,5', '-3'], 'number'],
    [['00123', '45'], 'text'],
    [['03/01/2012', '2020-06-01'], 'date'],
    [['https://a.b/c'], 'url'],
    [['', ''], 'text'],
    [['Oran', '12'], 'text'],
  ] as const)('%j → %s', (values, expected) => {
    expect(inferValueType([...values])).toBe(expected);
  });
});
