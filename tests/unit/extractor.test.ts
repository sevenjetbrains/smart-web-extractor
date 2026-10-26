import { describe, expect, it } from 'vitest';
import { detectPage } from '../../src/content/detector';
import { extract } from '../../src/content/extractor';
import type { DetectedSource, ExtractResult } from '../../src/shared/content-protocol';
import { loadPage } from './helpers/pages';

/** Extrait toutes les colonnes texte d'une source détectée, clés = libellés simplifiés. */
function extractAll(doc: Document, source: DetectedSource, only?: string[]): ExtractResult {
  const columns = source.columns.filter((c) => c.read !== 'href' && (!only || only.includes(c.label)));
  const result = extract(doc, {
    type: 'CONTENT_EXTRACT',
    source: { kind: source.kind, container: source.container, itemSelector: source.itemSelector, headerMode: source.headerMode },
    fields: columns.map((c, i) => ({ key: `f${i}`, locator: c.locator, read: c.read })),
  });
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

const values = (result: ExtractResult) => result.rows.map((row) => Object.values(row));

describe('extraction d’un tableau', () => {
  it('extrait toutes les lignes avec accents, arabe et zéros initiaux', () => {
    const doc = loadPage('liste-simple.html');
    const table = detectPage(doc).sources[0]!;
    expect(values(extractAll(doc, table))).toEqual([
      ['00123', 'Benali Karim', 'Ingénieur'],
      ['00456', 'Dupont Élodie', 'Technicienne'],
      ['00789', 'محمد العربي', 'Agent'],
    ]);
  });

  it('relit les valeurs de la page courante, pas celles de l’apprentissage', () => {
    const doc = loadPage('liste-simple.html');
    const table = detectPage(doc).sources[0]!;
    // La page change après la détection : autres agents, une ligne de plus.
    const tbody = doc.querySelector('#agents tbody')!;
    tbody.replaceChildren();
    for (const cells of [['09001', 'Nouvel Agent', 'Stagiaire'], ['09002', 'Autre Agent', 'Agent'], ['09003', 'Troisième', 'Chef'], ['09004', 'Quatrième', 'Agent']]) {
      const tr = doc.createElement('tr');
      for (const text of cells) tr.appendChild(Object.assign(doc.createElement('td'), { textContent: text }));
      tbody.appendChild(tr);
    }
    const result = extractAll(doc, table);
    expect(result.rows).toHaveLength(4);
    expect(values(result)[0]).toEqual(['09001', 'Nouvel Agent', 'Stagiaire']);
  });

  it('retrouve une colonne par son en-tête quand les colonnes sont réordonnées', () => {
    const doc = loadPage('liste-simple.html');
    const table = detectPage(doc).sources[0]!;
    // Déplace la colonne « Grade » en première position.
    for (const row of Array.from(doc.querySelectorAll('#agents tr'))) row.prepend(row.lastElementChild!);
    const result = extractAll(doc, table, ['Grade']);
    expect(result.rows.map((r) => r.f0)).toEqual(['Ingénieur', 'Technicienne', 'Agent']);
  });

  it('réplique les cellules fusionnées', () => {
    const doc = loadPage('cellules-fusionnees.html');
    const table = detectPage(doc).sources[0]!;
    expect(values(extractAll(doc, table))).toEqual([
      ['02001', 'Amrani Yacine', 'Logistique', 'Chef'],
      ['02002', 'Roux Camille', 'Logistique', 'Agent'],
      ['02003', 'سارة بن علي', 'Juridique', 'Juriste'],
      ['Poste vacant', 'Poste vacant', 'Juridique', 'Assistant'],
    ]);
  });

  it('signale les valeurs manquantes', () => {
    const doc = loadPage('liste-sans-entetes.html');
    const table = detectPage(doc).sources[0]!;
    const result = extractAll(doc, table, ['Service']);
    expect(result.rows.map((r) => r.f0)).toEqual(['Comptabilité', null, 'Ressources humaines', 'Informatique']);
    expect(result.fieldWarnings.f0).toEqual([{ code: 'MISSING_VALUES', message: '1 valeur(s) manquante(s).' }]);
  });

  it('extrait le second tableau identique, pas le premier', () => {
    const doc = loadPage('selecteurs-ambigus.html');
    const second = detectPage(doc).sources.filter((s) => s.kind === 'table')[1]!;
    expect(extractAll(doc, second, ['Code']).rows.map((r) => r.f0)).toEqual(['B1', 'B2']);
  });

  it('limite le nombre de lignes et le signale', () => {
    const doc = loadPage('liste-simple.html');
    const table = detectPage(doc).sources[0]!;
    const result = extract(doc, {
      type: 'CONTENT_EXTRACT',
      source: { kind: 'table', container: table.container },
      fields: [{ key: 'm', locator: table.columns[0]!.locator, read: 'text' }],
      maxRows: 2,
    });
    expect(result.ok && result.data.rows.length).toBe(2);
    expect(result.ok && result.data.truncated).toBe(true);
  });

  it('échoue proprement si la source a disparu', () => {
    const doc = loadPage('liste-simple.html');
    const table = detectPage(doc).sources[0]!;
    doc.getElementById('agents')!.remove();
    const result = extract(doc, {
      type: 'CONTENT_EXTRACT',
      source: { kind: 'table', container: table.container },
      fields: [{ key: 'm', locator: table.columns[0]!.locator, read: 'text' }],
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'SOURCE_NOT_FOUND' } });
  });
});

describe('extraction d’une liste et d’une fiche', () => {
  it('extrait chaque carte, y compris la carte sans grade', () => {
    const doc = loadPage('liste-cartes.html');
    const list = detectPage(doc).sources.find((s) => s.kind === 'list')!;
    const result = extractAll(doc, list, ['Nom', 'Matricule', 'Grade']);
    expect(values(result)).toEqual([
      ['Benali Karim', '00123', 'Ingénieur'],
      ['Dupont Élodie', '00456', 'Technicienne'],
      ['محمد العربي', '00789', null],
      ['Petit Lucas', '01010', 'Agent'],
    ]);
  });

  it('extrait les champs d’une fiche', () => {
    const doc = loadPage('fiche-agent.html');
    const fields = detectPage(doc).sources.find((s) => s.kind === 'fields')!;
    const result = extractAll(doc, fields, ['Matricule', 'Date d’entrée', 'Service']);
    expect(result.rows).toEqual([{ f0: '00123', f1: '12/03/2015', f2: 'Informatique' }]);
  });

  it('laisse vide une valeur ambiguë au lieu de choisir', () => {
    const doc = loadPage('selecteurs-ambigus.html');
    const fields = detectPage(doc).sources.find((s) => s.kind === 'fields')!;
    const result = extractAll(doc, fields, ['Nom']);
    expect(Object.values(result.rows[0]!)).toEqual([null, null]);
    expect(result.fieldWarnings.f0![0]!.code).toBe('AMBIGUOUS_LOCATOR');
  });

  it('ne lit jamais un champ sensible, même si un localisateur le désigne', () => {
    const doc = loadPage('fiche-agent.html');
    const result = extract(doc, {
      type: 'CONTENT_EXTRACT',
      source: { kind: 'fields', container: { strategies: [{ kind: 'css', selector: 'body' }], scope: 'page', expectedCount: 'one' } },
      fields: [{ key: 'pwd', locator: { strategies: [{ kind: 'id', value: 'pwd' }], scope: 'page', expectedCount: 'one' }, read: 'text' }],
    });
    expect(result.ok && result.data.rows).toEqual([{ pwd: null }]);
    expect(JSON.stringify(result)).not.toContain('ne-doit-jamais-etre-lu');
  });
});
