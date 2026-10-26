/**
 * Détection des sources de données d'une page (cahier §3.1) :
 * tableaux HTML, listes non tabulaires (éléments répétés), champs libellé/valeur.
 * Chaque champ détecté reçoit un localisateur réutilisable et un aperçu.
 */
import {
  OVERLAY_ATTR,
  elementChildren,
  humanize,
  isFormControl,
  isSkipped,
  labelFromText,
  ownText,
  precedingHeading,
  safeQueryAll,
  splitLabelValue,
  stableClasses,
  tagOf,
  textOf,
  walkElements,
} from './dom-utils';
import { readValue } from './extractor';
import { findLabelPairs } from './label-pairs';
import { buildCssPath, clearLocatorCaches, elementStep, generateLocator, resolveLocator } from './locator';
import { isSensitiveField } from './sensitive';
import {
  buildGrid,
  cellText,
  columnLabels,
  dataRowIndexes,
  defaultHeaderMode,
  isKeyValueTable,
  normalizeLabel,
  type TableGrid,
} from './table-grid';
import type {
  DetectedColumn,
  DetectedSource,
  DetectionReport,
  HeaderMode,
  Warning,
} from '../shared/content-protocol';
import type { FieldValueType, Locator, ReadMode } from '../shared/types';

export interface DetectOptions {
  /** Mode d'en-tête imposé par l'utilisateur, par identifiant de tableau. */
  headerOverrides?: Record<string, HeaderMode>;
}

const MIN_LIST_ITEMS = 3;
const IGNORED_LIST_AREAS = 'nav, header, footer, [role="navigation"], [role="menu"], [role="menubar"], [role="tablist"], select, datalist';
const TABLE_PARTS = new Set(['table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'colgroup', 'col', 'select', 'datalist', 'optgroup']);

const sample = (value: string) => (value.length > 300 ? `${value.slice(0, 297)}…` : value);

export function isHiddenDeep(el: Element): boolean {
  for (let current: Element | null = el; current; current = current.parentElement) {
    if (isSkipped(current)) return true;
  }
  return false;
}

/** Type de valeur déduit des exemples. Les identifiants à zéros initiaux restent du texte. */
export function inferValueType(values: string[]): FieldValueType {
  const filled = values.filter((v) => v !== '');
  if (filled.length === 0) return 'text';
  if (filled.every((v) => /^(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{4}-\d{2}-\d{2})$/.test(v))) return 'date';
  if (filled.every((v) => /^[-+]?\d{1,3}([\s .]?\d{3})*([.,]\d+)?$|^[-+]?\d+([.,]\d+)?$/.test(v) && !/^[-+]?0\d/.test(v))) {
    return 'number';
  }
  if (filled.every((v) => /^https?:\/\//i.test(v))) return 'url';
  return 'text';
}

function column(
  id: string,
  label: string,
  locator: Locator,
  read: ReadMode,
  values: (string | null)[],
  warnings: Warning[],
): DetectedColumn {
  const filled = values.filter((v): v is string => v !== null && v !== '');
  const emptyCount = values.length - filled.length;
  const all: Warning[] = [...warnings];
  if (emptyCount > 0 && values.length > 1) {
    all.push({ code: 'MISSING_VALUES', message: `${emptyCount} valeur(s) manquante(s) sur ${values.length}.` });
  }
  return {
    id,
    label: label.slice(0, 300),
    locator,
    read,
    valueType: read === 'href' ? 'url' : inferValueType(filled),
    samples: filled.slice(0, 3).map(sample),
    emptyCount,
    warnings: all.slice(0, 10),
  };
}

function containerWarnings(fragile: boolean): Warning[] {
  return fragile
    ? [{ code: 'FRAGILE_LOCATOR', message: 'Seule la position dans la page permet de retrouver cet élément : la règle est fragile.' }]
    : [];
}

// ---------- Tableaux ----------

function tableColumns(grid: TableGrid, mode: HeaderMode): DetectedColumn[] {
  const labels = columnLabels(grid, mode);
  const rows = dataRowIndexes(grid, mode);
  const columns: DetectedColumn[] = [];
  for (let c = 0; c < grid.columnCount; c++) {
    const header = labels[c] ?? '';
    const label = header || `Colonne ${c + 1}`;
    const duplicate = header !== '' && labels.filter((l) => normalizeLabel(l) === normalizeLabel(header)).length > 1;
    const locator: Locator = {
      strategies: [
        ...(mode !== 'none' && header && !duplicate
          ? [{ kind: 'context' as const, anchorText: header, relation: 'columnOfHeader' as const }]
          : []),
        { kind: 'columnIndex', index: c },
      ],
      scope: 'row',
      expectedCount: 'one',
    };
    const warnings: Warning[] = duplicate
      ? [{ code: 'DUPLICATE_HEADER', message: `Plusieurs colonnes s’intitulent « ${header} » : la position de la colonne sera utilisée.` }]
      : [];
    const cells = rows.map((r) => grid.cells[r]![c] ?? null);
    columns.push(column(`col_${c}`, label, locator, 'text', cells.map(cellText), warnings));

    const withLinks = cells.filter((cell) => cell?.querySelector('a[href]'));
    if (withLinks.length > 0 && withLinks.length >= rows.length / 2) {
      const hrefs = cells.map((cell) => (cell ? readValue(cell, 'href') : null));
      columns.push(column(`col_${c}_href`, `${label} (lien)`, locator, 'href', hrefs, []));
    }
  }
  return columns;
}

function tableLabel(table: Element, index: number): string {
  const caption = Array.from(table.children).find((child) => tagOf(child) === 'caption');
  return (
    (caption && textOf(caption)) ||
    table.getAttribute('aria-label') ||
    precedingHeading(table) ||
    `Tableau ${index + 1}`
  );
}

// ---------- Listes ----------

interface ListCandidate {
  container: Element;
  itemSelector: string;
  items: Element[];
}

function textLeaves(item: Element): Element[] {
  const leaves: Element[] = [];
  for (const el of walkElements(item)) {
    if (isFormControl(el) || el.closest('select, datalist')) continue;
    if (ownText(el) !== '') leaves.push(el);
  }
  return leaves;
}

function findListCandidates(body: Element, excluded: Element[]): ListCandidate[] {
  const candidates: ListCandidate[] = [];
  for (const el of walkElements(body)) {
    if (TABLE_PARTS.has(tagOf(el)) || el.closest(IGNORED_LIST_AREAS) || excluded.some((ex) => ex.contains(el))) continue;
    const children = elementChildren(el);
    if (children.length < MIN_LIST_ITEMS) continue;

    const groups = new Map<string, Element[]>();
    for (const child of children) {
      if (TABLE_PARTS.has(tagOf(child))) continue;
      const step = elementStep(child);
      groups.set(step, [...(groups.get(step) ?? []), child]);
    }
    for (const [step, items] of groups) {
      if (items.length < MIN_LIST_ITEMS) continue;
      const leafCounts = items.map((item) => textLeaves(item).length);
      const average = leafCounts.reduce((a, b) => a + b, 0) / items.length;
      const role = items[0]!.getAttribute('role');
      const listLike = tagOf(items[0]!) === 'li' || role === 'listitem' || role === 'row';
      if (average >= 2 || (listLike && average >= 1)) {
        const itemSelector = `:scope > ${step}`;
        candidates.push({ container: el, itemSelector, items: safeQueryAll(el, itemSelector) });
      }
    }
  }
  return candidates;
}

interface ListField {
  selector: string;
  read: ReadMode;
  label: string;
  count: number;
}

/** Libellé d'un champ de liste : libellé voisin, « Libellé : valeur », classe, ou position. */
function listFieldLabel(leaf: Element, index: number): { label: string; read: ReadMode } {
  const previous = leaf.previousElementSibling;
  const fromSibling = previous ? labelFromText(ownText(previous)) : null;
  if (fromSibling) return { label: fromSibling, read: 'text' };
  const split = elementChildren(leaf).length === 0 ? splitLabelValue(ownText(leaf)) : null;
  if (split) return { label: split.label, read: 'afterColon' };
  const cls = stableClasses(leaf)[0];
  if (cls) return { label: humanize(cls), read: 'text' };
  if (tagOf(leaf) === 'a') return { label: 'Lien', read: 'text' };
  if (/^h[1-6]$/.test(tagOf(leaf))) return { label: 'Titre', read: 'text' };
  return { label: `Champ ${index + 1}`, read: 'text' };
}

function listColumns(candidate: ListCandidate): DetectedColumn[] {
  const fields = new Map<string, ListField>();
  const register = (selector: string, read: ReadMode, label: string) => {
    const key = `${read}|${selector}`;
    const existing = fields.get(key);
    if (existing) existing.count++;
    else fields.set(key, { selector, read, label, count: 1 });
  };

  for (const item of candidate.items) {
    textLeaves(item).forEach((leaf, index) => {
      if (elementChildren(leaf).length === 0 && labelFromText(ownText(leaf))) return; // libellé, pas une valeur
      const { selector } = buildCssPath(leaf, item);
      const { label, read } = listFieldLabel(leaf, index);
      register(selector, read, label);
    });
    for (const link of safeQueryAll(item, 'a[href]')) {
      const { selector } = buildCssPath(link, item);
      register(selector, 'href', `${listFieldLabel(link, 0).label} (lien)`);
    }
  }

  const threshold = Math.max(1, Math.ceil(candidate.items.length * 0.3));
  const columns: DetectedColumn[] = [];
  let index = 0;
  for (const field of fields.values()) {
    if (field.count < threshold) continue;
    const locator: Locator = { strategies: [{ kind: 'css', selector: field.selector }], scope: 'row', expectedCount: 'one' };
    const values = candidate.items.map((item) => {
      const resolution = resolveLocator(locator, item);
      return resolution.status === 'found' ? readValue(resolution.elements[0]!, field.read) : null;
    });
    const warnings: Warning[] = field.selector.includes(':nth-of-type(')
      ? [{ code: 'FRAGILE_LOCATOR', message: 'Champ repéré par sa position dans l’élément : vérifiez l’aperçu.' }]
      : [];
    columns.push(column(`item_${index++}`, field.label, locator, field.read, values, warnings));
  }
  return columns;
}

// ---------- Rapport ----------

export function detectPage(doc: Document, options: DetectOptions = {}): Omit<DetectionReport, 'durationMs'> {
  clearLocatorCaches();
  const body = doc.body ?? doc.documentElement;
  const sources: DetectedSource[] = [];
  const dataTables: Element[] = [];

  // Tableaux de données.
  let tableIndex = 0;
  for (const table of safeQueryAll(body, 'table')) {
    if (isHiddenDeep(table) || table.closest(`[${OVERLAY_ATTR}]`)) continue;
    const grid = buildGrid(table as HTMLTableElement);
    if (grid.columnCount === 0 || isKeyValueTable(grid)) continue;
    const id = `table-${tableIndex++}`;
    const automatic = defaultHeaderMode(grid);
    const requested = options.headerOverrides?.[id];
    const mode = requested && (requested !== 'explicit' || grid.explicitHeaderRows > 0) ? requested : automatic;
    const rows = dataRowIndexes(grid, mode);
    if (rows.length === 0) continue;
    dataTables.push(table);

    const { locator, fragile } = generateLocator(table, body, { scope: 'page' });
    const warnings = containerWarnings(fragile);
    if (mode === 'firstRow') {
      warnings.push({ code: 'HEADER_INFERRED', message: 'Pas d’en-tête explicite : la première ligne est utilisée comme en-tête. Vérifiez.' });
    } else if (mode === 'none') {
      warnings.push({ code: 'NO_HEADER', message: 'Aucun en-tête : les colonnes sont repérées par leur position.' });
    }
    if (grid.hasMergedCells) {
      warnings.push({ code: 'MERGED_CELLS', message: 'Cellules fusionnées : leurs valeurs sont répliquées sur chaque ligne et colonne couverte.' });
    }
    if (table.querySelector('table')) {
      warnings.push({ code: 'NESTED_TABLES', message: 'Ce tableau contient d’autres tableaux : leur contenu est ignoré.' });
    }

    sources.push({
      id,
      kind: 'table',
      label: tableLabel(table, sources.length),
      container: locator,
      headerMode: mode,
      itemCount: rows.length,
      columns: tableColumns(grid, mode).slice(0, 200),
      warnings,
    });
  }

  // Listes non tabulaires.
  const listContainers: Element[] = [];
  findListCandidates(body, dataTables).forEach((candidate, index) => {
    const columns = listColumns(candidate);
    if (columns.length === 0) return;
    listContainers.push(candidate.container);
    const { locator, fragile } = generateLocator(candidate.container, body, { scope: 'page' });
    sources.push({
      id: `list-${index}`,
      kind: 'list',
      label: candidate.container.getAttribute('aria-label') || precedingHeading(candidate.container) || `Liste ${index + 1}`,
      container: locator,
      itemSelector: candidate.itemSelector,
      itemCount: candidate.items.length,
      columns: columns.slice(0, 200),
      warnings: containerWarnings(fragile),
    });
  });

  // Champs libellé/valeur hors tableaux de données et listes.
  const pairs = findLabelPairs(body, [...dataTables, ...listContainers]).filter((pair) => !pair.sensitive);
  if (pairs.length > 0) {
    const columns = pairs.slice(0, 200).map((pair, index) => {
      const { locator, fragile } = generateLocator(pair.target, body, { scope: 'page', label: pair.label });
      const resolution = resolveLocator(locator, body);
      const warnings: Warning[] = [];
      if (resolution.status === 'ambiguous') {
        warnings.push({ code: 'AMBIGUOUS_LOCATOR', message: `Localisation ambiguë : ${resolution.reason ?? ''}`.trim() });
      } else if (fragile) {
        warnings.push(...containerWarnings(true));
      }
      return column(`field_${index}`, pair.label, locator, pair.read, [readValue(pair.target, pair.read)], warnings);
    });
    sources.push({
      id: 'fields-0',
      kind: 'fields',
      label: 'Champs de la page',
      container: { strategies: [{ kind: 'css', selector: 'body' }], scope: 'page', expectedCount: 'one' },
      itemCount: 1,
      columns,
      warnings: [],
    });
  }

  // Avertissements de page.
  const warnings: Warning[] = [];
  const sensitiveFieldCount = safeQueryAll(body, 'input, select, textarea').filter(isSensitiveField).length;
  if (sensitiveFieldCount > 0) {
    warnings.push({
      code: 'SENSITIVE_FIELDS_IGNORED',
      message: `${sensitiveFieldCount} champ(s) sensible(s) ignoré(s) (mots de passe, champs cachés…).`,
    });
  }
  const frames = safeQueryAll(body, 'iframe, frame').length;
  if (frames > 0) {
    warnings.push({ code: 'FRAMES_NOT_SCANNED', message: `${frames} cadre(s) intégré(s) (iframe) non analysé(s).` });
  }
  let shadowHosts = 0;
  for (const el of walkElements(body)) if ((el as HTMLElement).shadowRoot) shadowHosts++;
  if (shadowHosts > 0) {
    warnings.push({ code: 'SHADOW_DOM_NOT_SCANNED', message: `${shadowHosts} composant(s) à Shadow DOM non analysé(s).` });
  }

  return {
    url: doc.location?.href ?? '',
    title: doc.title.slice(0, 500),
    sources: sources.slice(0, 100),
    sensitiveFieldCount,
    warnings,
  };
}
