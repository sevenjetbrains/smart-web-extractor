import { describe, expect, it } from 'vitest';
import { cssEscape, isStableToken } from '../../src/content/dom-utils';
import { buildCssPath, generateLocator, resolveLocator } from '../../src/content/locator';
import type { Locator } from '../../src/shared/types';
import { fromHtml } from './helpers/pages';

const one = (strategies: Locator['strategies']): Locator => ({ strategies, scope: 'page', expectedCount: 'one' });

describe('isStableToken', () => {
  it.each(['agents', 'fiche-matricule', 'carte-agent', 'col3', 'nom_complet'])('stable : %s', (v) => {
    expect(isStableToken(v)).toBe(true);
  });
  it.each(['ember1234', 'react-select-2-input', ':r1:', 'css-1x2y3z', 'Kx7aB2q', 'a1b2c3d4e5', 'row-20240101', ''])(
    'généré : %s',
    (v) => expect(isStableToken(v)).toBe(false),
  );
});

describe('cssEscape', () => {
  it('échappe les caractères spéciaux et les chiffres initiaux', () => {
    expect(cssEscape('a.b')).toBe('a\\.b');
    expect(cssEscape('1abc')).toBe('\\31 abc');
    expect(cssEscape('élodie')).toBe('élodie');
  });
});

describe('buildCssPath', () => {
  it('produit le sélecteur le plus court qui reste unique', () => {
    const doc = fromHtml('<div class="a"><span class="x">1</span></div><div class="b"><span class="x">2</span></div>');
    const target = doc.querySelector('.b .x')!;
    expect(buildCssPath(target, doc.body)).toEqual({ selector: 'div.b > span.x', positional: false });
  });

  it('se rabat sur les positions quand rien ne distingue les éléments', () => {
    const doc = fromHtml('<p>un</p><p>deux</p>');
    const target = doc.querySelectorAll('p')[1]!;
    const { selector, positional } = buildCssPath(target, doc.body);
    expect(positional).toBe(true);
    expect(Array.from(doc.body.querySelectorAll(selector))).toEqual([target]);
  });
});

describe('resolveLocator', () => {
  const doc = fromHtml(`
    <span id="a" data-field="x">A</span>
    <span class="dup">B</span><span class="dup">C</span>
    <span id="d">D</span>`);

  it('trouve un élément unique', () => {
    expect(resolveLocator(one([{ kind: 'id', value: 'a' }]), doc.body)).toMatchObject({ status: 'found', candidates: 1 });
  });

  it('signale plusieurs correspondances', () => {
    expect(resolveLocator(one([{ kind: 'css', selector: '.dup' }]), doc.body)).toMatchObject({ status: 'ambiguous', candidates: 2 });
  });

  it('signale le désaccord entre deux stratégies', () => {
    const result = resolveLocator(one([{ kind: 'id', value: 'a' }, { kind: 'id', value: 'd' }]), doc.body);
    expect(result.status).toBe('ambiguous');
  });

  it('passe à la stratégie suivante quand la première ne trouve rien', () => {
    const result = resolveLocator(one([{ kind: 'id', value: 'absent' }, { kind: 'attribute', name: 'data-field', value: 'x' }]), doc.body);
    expect(result.status).toBe('found');
    expect(result.elements[0]!.id).toBe('a');
  });

  it('traite un sélecteur invalide comme introuvable, sans exception', () => {
    expect(resolveLocator(one([{ kind: 'css', selector: 'div[' }]), doc.body).status).toBe('notFound');
  });
});

describe('generateLocator', () => {
  it('écarte un identifiant présent deux fois', () => {
    const doc = fromHtml('<span id="nom">A</span><div><span id="nom">B</span></div>');
    const target = doc.querySelector('div > span')!;
    const { locator } = generateLocator(target, doc.body, { scope: 'page' });
    expect(locator.strategies.map((s) => s.kind)).toEqual(['css']);
  });

  it('écarte un identifiant généré et retient un attribut stable', () => {
    const doc = fromHtml('<span id="ember4821" data-testid="grade">Agent</span>');
    const { locator, fragile } = generateLocator(doc.querySelector('span')!, doc.body, { scope: 'page' });
    expect(locator.strategies[0]).toEqual({ kind: 'attribute', name: 'data-testid', value: 'grade' });
    expect(fragile).toBe(false);
  });

  it('utilise le rôle accessible pour un lien', () => {
    const doc = fromHtml('<a href="/a">Voir</a><a href="/b">Suivant</a>');
    const { locator } = generateLocator(doc.querySelectorAll('a')[1]!, doc.body, { scope: 'page' });
    expect(locator.strategies[0]).toEqual({ kind: 'role', role: 'link', name: 'Suivant' });
  });
});
