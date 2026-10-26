/**
 * Localisateurs multi-stratégies (cahier §3.1) : génération à partir d'un élément,
 * puis résolution avec détection des correspondances multiples et des désaccords
 * entre stratégies. Aucun choix arbitraire n'est fait en cas d'ambiguïté.
 */
import {
  cssEscape,
  cssString,
  isStableToken,
  normalizeText,
  ownText,
  safeQueryAll,
  stableClasses,
  tagOf,
  textOf,
} from './dom-utils';
import { findLabelPairs, type LabelPair } from './label-pairs';
import { normalizeLabel, type TableGrid } from './table-grid';
import type { Locator, LocatorStrategy } from '../shared/types';

/** Contexte d'une ligne de tableau, pour les stratégies de colonne. */
export interface RowContext {
  grid: TableGrid;
  rowIndex: number;
  /** Libellés des colonnes (cf. columnLabels). */
  labels: string[];
}

export type ResolutionStatus = 'found' | 'ambiguous' | 'notFound';

export interface Resolution {
  status: ResolutionStatus;
  /** Élément retenu (status 'found'), ou tous les éléments (expectedCount 'many'). */
  elements: Element[];
  /** Nombre d'éléments trouvés par la stratégie principale. */
  candidates: number;
  /** Explication en cas d'ambiguïté. */
  reason?: string;
}

const STABLE_ATTRIBUTES = ['data-testid', 'data-test', 'data-qa', 'data-cy', 'data-field', 'data-name', 'itemprop', 'name', 'aria-label'];

// Les paires libellé/valeur sont coûteuses à calculer : elles sont mises en cache
// le temps d'une requête (le DOM peut changer entre deux requêtes).
let labelPairCache = new WeakMap<Element, LabelPair[]>();
export function clearLocatorCaches(): void {
  labelPairCache = new WeakMap();
}
function labelPairs(root: Element): LabelPair[] {
  let pairs = labelPairCache.get(root);
  if (!pairs) {
    pairs = findLabelPairs(root);
    labelPairCache.set(root, pairs);
  }
  return pairs;
}

const ROLE_SELECTORS: Record<string, string> = {
  link: 'a[href], [role="link"]',
  button: 'button, input[type="button"], input[type="submit"], [role="button"]',
  heading: 'h1, h2, h3, h4, h5, h6, [role="heading"]',
};

function accessibleName(el: Element): string {
  const aria = el.getAttribute('aria-label');
  if (aria) return normalizeText(aria);
  if (tagOf(el) === 'input') return normalizeText((el as HTMLInputElement).value);
  return textOf(el).slice(0, 200);
}

function implicitRole(el: Element): string | null {
  const explicit = el.getAttribute('role');
  if (explicit) return explicit;
  const tag = tagOf(el);
  if (tag === 'a' && el.hasAttribute('href')) return 'link';
  if (tag === 'button' || (tag === 'input' && /^(button|submit)$/i.test(el.getAttribute('type') ?? ''))) return 'button';
  if (/^h[1-6]$/.test(tag)) return 'heading';
  return null;
}

/** Stratégies positionnelles : utilisées en dernier recours, sans participer au contrôle de cohérence. */
function isPositional(strategy: LocatorStrategy): boolean {
  return strategy.kind === 'columnIndex' || (strategy.kind === 'css' && strategy.selector.includes(':nth-of-type('));
}

export function findByStrategy(strategy: LocatorStrategy, root: Element, row?: RowContext): Element[] {
  switch (strategy.kind) {
    case 'id':
      return safeQueryAll(root, `#${cssEscape(strategy.value)}`);
    case 'attribute':
      return safeQueryAll(root, `[${cssEscape(strategy.name)}=${cssString(strategy.value)}]`);
    case 'role': {
      const selector = ROLE_SELECTORS[strategy.role] ?? `[role=${cssString(strategy.role)}]`;
      const name = strategy.name === undefined ? null : normalizeText(strategy.name);
      return safeQueryAll(root, selector).filter((el) => name === null || accessibleName(el) === name);
    }
    case 'label': {
      const wanted = normalizeLabel(strategy.text);
      return labelPairs(root)
        .filter((pair) => normalizeLabel(pair.label) === wanted)
        .map((pair) => pair.target);
    }
    case 'css':
      return safeQueryAll(root, strategy.selector);
    case 'context': {
      if (strategy.relation === 'columnOfHeader') {
        if (!row) return [];
        const wanted = normalizeLabel(strategy.anchorText);
        const cells = row.labels
          .map((label, c) => (normalizeLabel(label) === wanted ? row.grid.cells[row.rowIndex]?.[c] : undefined))
          .filter((cell): cell is HTMLTableCellElement => !!cell);
        return Array.from(new Set(cells));
      }
      const wanted = normalizeLabel(strategy.anchorText);
      const anchors = Array.from(root.querySelectorAll('*')).filter(
        (el) => ownText(el) !== '' && normalizeLabel(ownText(el)) === wanted,
      );
      const found = anchors.map((anchor) => {
        if (strategy.relation === 'parent') return anchor.parentElement;
        if (strategy.relation === 'next') return anchor.nextElementSibling;
        const cell = anchor.closest('td, th');
        return cell?.nextElementSibling ?? null;
      });
      return Array.from(new Set(found.filter((el): el is Element => !!el)));
    }
    case 'columnIndex': {
      const cell = row?.grid.cells[row.rowIndex]?.[strategy.index];
      return cell ? [cell] : [];
    }
  }
}

export function resolveLocator(locator: Locator, root: Element, row?: RowContext): Resolution {
  const results = locator.strategies.map((strategy) => findByStrategy(strategy, root, row));
  const primary = results.findIndex((matches) => matches.length > 0);
  if (primary === -1) return { status: 'notFound', elements: [], candidates: 0 };

  const matches = results[primary]!;
  if (locator.expectedCount === 'many') return { status: 'found', elements: matches, candidates: matches.length };

  if (matches.length > 1) {
    return {
      status: 'ambiguous',
      elements: [],
      candidates: matches.length,
      reason: `${matches.length} éléments correspondent à la règle de localisation.`,
    };
  }
  const element = matches[0]!;
  for (let j = primary + 1; j < results.length; j++) {
    const other = results[j]!;
    if (!isPositional(locator.strategies[j]!) && other.length === 1 && other[0] !== element) {
      return {
        status: 'ambiguous',
        elements: [],
        candidates: 2,
        reason: 'Les règles de localisation ne désignent pas le même élément.',
      };
    }
  }
  return { status: 'found', elements: [element], candidates: 1 };
}

// ---------- Génération ----------

export function elementStep(el: Element): string {
  return [cssEscape(tagOf(el)), ...stableClasses(el).map((c) => `.${cssEscape(c)}`)].join('');
}

function nthOfType(el: Element): number {
  let index = 1;
  for (let sib = el.previousElementSibling; sib; sib = sib.previousElementSibling) {
    if (sib.tagName === el.tagName) index++;
  }
  return index;
}

function isUnique(root: Element, selector: string, el: Element): boolean {
  const found = safeQueryAll(root, selector);
  return found.length === 1 && found[0] === el;
}

/**
 * Sélecteur CSS le plus court possible, relatif à `root` :
 * d'abord balises et classes stables, puis positions (:nth-of-type) si nécessaire.
 */
export function buildCssPath(el: Element, root: Element): { selector: string; positional: boolean } {
  const steps: string[] = [];
  for (let current: Element | null = el; current && current !== root; current = current.parentElement) {
    const id = current.id;
    if (current !== el && id && isStableToken(id)) {
      const anchored = [`#${cssEscape(id)}`, ...steps].join(' > ');
      if (isUnique(root, anchored, el)) return { selector: anchored, positional: false };
    }
    steps.unshift(elementStep(current));
    const selector = steps.join(' > ');
    if (isUnique(root, selector, el)) return { selector, positional: false };
  }

  // Chemin complet ancré sur la racine, avec positions.
  const anchored: string[] = [];
  for (let current: Element | null = el; current && current !== root; current = current.parentElement) {
    anchored.unshift(`${elementStep(current)}:nth-of-type(${nthOfType(current)})`);
  }
  return { selector: [':scope', ...anchored].join(' > '), positional: true };
}

export interface GeneratedLocator {
  locator: Locator;
  /** Vrai si seule une position dans la page permet de retrouver l'élément. */
  fragile: boolean;
}

/**
 * Localisateur d'un élément, stratégies classées par fiabilité :
 * identifiant stable, attribut stable, rôle accessible, libellé, chemin CSS.
 * Un identifiant ou un attribut n'est retenu que s'il désigne l'élément de façon unique.
 */
export function generateLocator(
  el: Element,
  root: Element,
  options: { scope: 'page' | 'row'; label?: string },
): GeneratedLocator {
  const strategies: LocatorStrategy[] = [];
  const unique = (strategy: LocatorStrategy) => {
    const found = findByStrategy(strategy, root);
    return found.length === 1 && found[0] === el;
  };

  if (el.id && isStableToken(el.id)) {
    const strategy: LocatorStrategy = { kind: 'id', value: el.id };
    if (unique(strategy)) strategies.push(strategy);
  }
  for (const name of STABLE_ATTRIBUTES) {
    const value = el.getAttribute(name);
    if (!value || value.length > 100 || (name !== 'aria-label' && !isStableToken(value.replace(/[\s.]/g, '')))) continue;
    const strategy: LocatorStrategy = { kind: 'attribute', name, value };
    if (unique(strategy)) {
      strategies.push(strategy);
      break;
    }
  }
  const role = implicitRole(el);
  if (role === 'link' || role === 'button') {
    const name = accessibleName(el);
    const strategy: LocatorStrategy = { kind: 'role', role, name };
    if (name && name.length <= 100 && unique(strategy)) strategies.push(strategy);
  }
  if (options.label) strategies.push({ kind: 'label', text: options.label });

  const css = buildCssPath(el, root);
  strategies.push({ kind: 'css', selector: css.selector });

  return {
    locator: { strategies, scope: options.scope, expectedCount: 'one' },
    fragile: css.positional && strategies.length === 1,
  };
}
