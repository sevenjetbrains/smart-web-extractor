import { describe, expect, it } from 'vitest';
import { describePickedElement } from '../../src/content/pick-resolve';
import { waitForStable } from '../../src/content/wait';
import { fromHtml, loadPage } from './helpers/pages';

describe('waitForStable', () => {
  it('répond tout de suite pour une page calme', async () => {
    const result = await waitForStable(fromHtml('<p>ok</p>'), { quietMs: 200, timeoutMs: 2000 });
    expect(result.stable).toBe(true);
    expect(result.waitedMs).toBeLessThan(150);
  });

  it('attend la disparition de l’indicateur de chargement', async () => {
    const doc = fromHtml('<div id="zone"><p class="loading" aria-busy="true">Chargement…</p></div>');
    setTimeout(() => {
      const zone = doc.getElementById('zone')!;
      zone.replaceChildren(Object.assign(doc.createElement('table'), { id: 'arrive' }));
    }, 300);
    const result = await waitForStable(doc, { quietMs: 100, timeoutMs: 3000 });
    expect(result.stable).toBe(true);
    expect(result.waitedMs).toBeGreaterThanOrEqual(300);
    expect(doc.getElementById('arrive')).not.toBeNull();
  });

  it('abandonne après le délai maximal si la page reste en chargement', async () => {
    const doc = fromHtml('<p aria-busy="true">…</p>');
    const result = await waitForStable(doc, { quietMs: 50, timeoutMs: 300 });
    expect(result.stable).toBe(false);
  });
});

describe('describePickedElement', () => {
  it('rattache une cellule à la colonne du tableau', () => {
    const doc = loadPage('liste-simple.html');
    const cell = doc.querySelectorAll('#agents tbody td')[4]!; // 2e ligne, « Nom »
    const result = describePickedElement(doc, cell, {});
    expect(result).toMatchObject({ ok: true, data: { sourceId: 'table-0', isNew: false, column: { label: 'Nom' } } });
  });

  it('rattache un élément de carte au champ de la liste', () => {
    const doc = loadPage('liste-cartes.html');
    const span = doc.querySelectorAll('.matricule')[2]!;
    const result = describePickedElement(doc, span, {});
    expect(result).toMatchObject({ ok: true, data: { sourceId: 'list-0', isNew: false, column: { label: 'Matricule' } } });
  });

  it('rattache une valeur de fiche au champ détecté', () => {
    const doc = loadPage('fiche-agent.html');
    const result = describePickedElement(doc, doc.getElementById('fiche-matricule')!, {});
    expect(result).toMatchObject({ ok: true, data: { sourceId: 'fields-0', isNew: false, column: { label: 'Matricule' } } });
  });

  it('crée un nouveau champ pour un élément isolé', () => {
    const doc = loadPage('fiche-agent.html');
    const result = describePickedElement(doc, doc.querySelector('h1')!, {});
    expect(result).toMatchObject({ ok: true, data: { sourceId: null, isNew: true, column: { samples: ['Fiche de l’agent'] } } });
  });

  it('refuse un champ sensible', () => {
    const doc = loadPage('fiche-agent.html');
    expect(describePickedElement(doc, doc.getElementById('pwd')!, {})).toMatchObject({
      ok: false,
      error: { code: 'SENSITIVE_FIELD' },
    });
  });
});
