/**
 * Interprétation d'un élément choisi dans la page : il est rattaché à la colonne
 * d'un tableau, au champ d'une liste ou à un champ de fiche déjà détectés ;
 * sinon un nouveau champ est créé avec son propre localisateur.
 */
import { detectPage, inferValueType, type DetectOptions } from './detector';
import { humanize, isFormControl, labelFromText, ownText, safeQueryAll, stableClasses, tagOf, textOf } from './dom-utils';
import { readValue } from './extractor';
import { findLabelPairs } from './label-pairs';
import { buildCssPath, generateLocator, resolveLocator } from './locator';
import { isSensitiveField } from './sensitive';
import { buildGrid } from './table-grid';
import type { DetectedColumn, DetectedSource, PickResult, Warning } from '../shared/content-protocol';
import { fail, ok, type Result } from '../shared/messages';
import type { Locator } from '../shared/types';

type Picked = Extract<PickResult, { cancelled: false }>;

function resolveOne(locator: Locator, root: Element): Element | null {
  const resolution = resolveLocator(locator, root);
  return resolution.status === 'found' ? resolution.elements[0]! : null;
}

/** Libellé proposé pour un élément isolé. */
function guessLabel(el: Element, body: Element): { label: string; fromPage: boolean } {
  const pair = findLabelPairs(body).find((p) => p.target === el);
  if (pair) return { label: pair.label, fromPage: true };
  const previous = el.previousElementSibling;
  const sibling = previous ? labelFromText(ownText(previous)) : null;
  if (sibling) return { label: sibling, fromPage: true };
  const aria = el.getAttribute('aria-label') || el.getAttribute('title');
  if (aria) return { label: aria.slice(0, 60), fromPage: false };
  const cls = stableClasses(el)[0];
  if (cls) return { label: humanize(cls), fromPage: false };
  const text = textOf(el);
  return { label: text ? text.slice(0, 40) : tagOf(el), fromPage: false };
}

function inTable(source: DetectedSource, table: Element, el: Element): DetectedColumn | null {
  const cell = el.closest('td, th');
  if (!cell || cell.closest('table') !== table) return null;
  const grid = buildGrid(table as HTMLTableElement);
  for (const row of grid.cells) {
    const index = row.indexOf(cell as HTMLTableCellElement);
    if (index >= 0) return source.columns.find((c) => c.id === `col_${index}`) ?? null;
  }
  return null;
}

function inList(source: DetectedSource, container: Element, el: Element): { column: DetectedColumn; isNew: boolean } | null {
  const items = safeQueryAll(container, source.itemSelector ?? ':scope > *');
  const item = items.find((candidate) => candidate.contains(el));
  if (!item || item === el) return null;
  for (const column of source.columns) {
    const target = resolveOne(column.locator, item);
    if (target && (target === el || target.contains(el)) && column.read !== 'href') return { column, isNew: false };
  }
  // Nouveau champ de liste, repéré relativement à l'élément de liste.
  const { selector, positional } = buildCssPath(el, item);
  const locator: Locator = { strategies: [{ kind: 'css', selector }], scope: 'row', expectedCount: 'one' };
  const values = items.map((it) => {
    const target = resolveOne(locator, it);
    return target ? readValue(target, 'text') : null;
  });
  const filled = values.filter((v): v is string => v !== null);
  const warnings: Warning[] = positional
    ? [{ code: 'FRAGILE_LOCATOR', message: 'Champ repéré par sa position dans l’élément : vérifiez l’aperçu.' }]
    : [];
  return {
    isNew: true,
    column: {
      id: `picked_${Date.now().toString(36)}`,
      label: guessLabel(el, item).label,
      locator,
      read: 'text',
      valueType: inferValueType(filled),
      samples: filled.slice(0, 3),
      emptyCount: values.length - filled.length,
      warnings,
    },
  };
}

export function describePickedElement(doc: Document, el: Element, options: DetectOptions): Result<Picked> {
  if (isFormControl(el) && isSensitiveField(el)) {
    return fail('SENSITIVE_FIELD', 'Ce champ est sensible (mot de passe, champ caché…) : il ne peut pas être extrait.');
  }
  const body = doc.body ?? doc.documentElement;
  if (el === body || el === doc.documentElement) {
    return fail('SOURCE_NOT_FOUND', 'Choisissez un élément plus précis de la page.');
  }

  const report = detectPage(doc, options);
  for (const source of report.sources) {
    if (source.kind === 'fields') {
      const column = source.columns.find((c) => {
        const target = resolveOne(c.locator, body);
        return target && (target === el || target.contains(el));
      });
      if (column) return ok({ cancelled: false, sourceId: source.id, column, isNew: false });
      continue;
    }
    const container = resolveOne(source.container, body);
    if (!container || !container.contains(el)) continue;
    if (source.kind === 'table') {
      const column = inTable(source, container, el);
      if (column) return ok({ cancelled: false, sourceId: source.id, column, isNew: false });
    } else {
      const found = inList(source, container, el);
      if (found) return ok({ cancelled: false, sourceId: source.id, ...found });
    }
  }

  // Champ isolé de la page.
  const { label, fromPage } = guessLabel(el, body);
  const { locator, fragile } = generateLocator(el, body, { scope: 'page', label: fromPage ? label : undefined });
  const resolution = resolveLocator(locator, body);
  const warnings: Warning[] = [];
  if (resolution.status === 'ambiguous') {
    warnings.push({ code: 'AMBIGUOUS_LOCATOR', message: `Localisation ambiguë : ${resolution.reason ?? ''}`.trim() });
  } else if (fragile) {
    warnings.push({ code: 'FRAGILE_LOCATOR', message: 'Seule la position dans la page permet de retrouver cet élément : la règle est fragile.' });
  }
  const value = readValue(el, 'text');
  return ok({
    cancelled: false,
    sourceId: null,
    isNew: true,
    column: {
      id: `picked_${Date.now().toString(36)}`,
      label,
      locator,
      read: 'text',
      valueType: inferValueType(value ? [value] : []),
      samples: value ? [value.slice(0, 300)] : [],
      emptyCount: value ? 0 : 1,
      warnings,
    },
  });
}
