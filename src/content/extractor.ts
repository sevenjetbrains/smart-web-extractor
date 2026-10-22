/**
 * Extraction manuelle d'une page à partir des règles choisies (cahier §3.3) :
 * les valeurs sont relues sur la page courante à chaque appel, jamais mémorisées.
 */
import { isFormControl, safeQueryAll, tagOf, textOf } from './dom-utils';
import { clearLocatorCaches, resolveLocator, type RowContext } from './locator';
import { isSensitiveField } from './sensitive';
import { buildGrid, columnLabels, dataRowIndexes, defaultHeaderMode } from './table-grid';
import {
  MAX_EXTRACT_ROWS,
  MAX_VALUE_LENGTH,
  type ContentRequest,
  type ExtractResult,
  type Warning,
} from '../shared/content-protocol';
import { fail, ok, type Result } from '../shared/messages';
import type { ReadMode } from '../shared/types';

/** Valeur d'un élément selon le mode de lecture. Null si vide, absente ou sensible. */
export function readValue(el: Element, read: ReadMode): string | null {
  let value: string;
  if (isFormControl(el)) {
    if (isSensitiveField(el) || read === 'href') return null;
    if (tagOf(el) === 'select') {
      const select = el as HTMLSelectElement;
      value = select.selectedIndex >= 0 ? textOf(select.options[select.selectedIndex]!) : '';
    } else {
      value = (el as HTMLInputElement | HTMLTextAreaElement).value;
    }
  } else if (read === 'href') {
    const link = (tagOf(el) === 'a' ? el : (el.querySelector('a[href]') ?? el.closest('a[href]'))) as HTMLAnchorElement | null;
    value = link?.href ?? '';
  } else {
    value = textOf(el, { skipNestedTables: true });
    if (read === 'afterColon') {
      const colon = value.indexOf(':');
      if (colon >= 0) value = value.slice(colon + 1);
    }
  }
  value = value.replace(/\s+/g, ' ').trim();
  return value === '' ? null : value.slice(0, MAX_VALUE_LENGTH);
}

type ExtractRequest = Extract<ContentRequest, { type: 'CONTENT_EXTRACT' }>;

/** Résolution du conteneur d'une source (tableau ou liste) sur la page. */
export function resolveContainer(body: Element, request: Pick<ExtractRequest, 'source'>): Result<Element> {
  const resolution = resolveLocator(request.source.container, body);
  if (resolution.status === 'notFound') {
    return fail('SOURCE_NOT_FOUND', 'La source de données est introuvable sur cette page.');
  }
  if (resolution.status === 'ambiguous') {
    return fail('AMBIGUOUS_SOURCE', `Source ambiguë : ${resolution.reason ?? 'plusieurs éléments correspondent.'}`);
  }
  return ok(resolution.elements[0]!);
}

export function extract(doc: Document, request: ExtractRequest): Result<ExtractResult> {
  clearLocatorCaches();
  const body = doc.body ?? doc.documentElement;
  const maxRows = Math.min(request.maxRows ?? MAX_EXTRACT_ROWS, MAX_EXTRACT_ROWS);
  const rows: Record<string, string | null>[] = [];
  const missing: Record<string, number> = {};
  const ambiguous: Record<string, number> = {};
  for (const field of request.fields) {
    missing[field.key] = 0;
    ambiguous[field.key] = 0;
  }

  const extractRecord = (root: Element, row?: RowContext) => {
    const record: Record<string, string | null> = {};
    for (const field of request.fields) {
      const resolution = resolveLocator(field.locator, root, row);
      let value: string | null = null;
      if (resolution.status === 'ambiguous') ambiguous[field.key]!++;
      else if (resolution.status === 'found') value = readValue(resolution.elements[0]!, field.read);
      if (value === null && resolution.status !== 'ambiguous') missing[field.key]!++;
      record[field.key] = value;
    }
    rows.push(record);
  };

  let total = 0;
  const { source } = request;
  if (source.kind === 'fields') {
    total = 1;
    extractRecord(body);
  } else {
    const container = resolveContainer(body, request);
    if (!container.ok) return container;
    if (source.kind === 'table') {
      if (tagOf(container.data) !== 'table') return fail('SOURCE_NOT_FOUND', 'L’élément localisé n’est pas un tableau.');
      const grid = buildGrid(container.data as HTMLTableElement);
      const mode = source.headerMode ?? defaultHeaderMode(grid);
      const labels = columnLabels(grid, mode);
      const indexes = dataRowIndexes(grid, mode);
      total = indexes.length;
      for (const rowIndex of indexes.slice(0, maxRows)) extractRecord(container.data, { grid, rowIndex, labels });
    } else {
      const items = safeQueryAll(container.data, source.itemSelector ?? ':scope > *');
      total = items.length;
      for (const item of items.slice(0, maxRows)) extractRecord(item);
    }
  }

  const fieldWarnings: Record<string, Warning[]> = {};
  for (const field of request.fields) {
    const list: Warning[] = [];
    const n = rows.length;
    if (n > 0 && missing[field.key] === n) {
      list.push({ code: 'FIELD_NOT_FOUND', message: 'Champ introuvable ou vide sur toute la page.' });
    } else if (missing[field.key]! > 0) {
      list.push({ code: 'MISSING_VALUES', message: `${missing[field.key]} valeur(s) manquante(s).` });
    }
    if (ambiguous[field.key]! > 0) {
      list.push({
        code: 'AMBIGUOUS_LOCATOR',
        message: `${ambiguous[field.key]} valeur(s) ambiguë(s), laissée(s) vide(s) : plusieurs éléments correspondent.`,
      });
    }
    fieldWarnings[field.key] = list;
  }

  const truncated = total > rows.length;
  const warnings: Warning[] = truncated
    ? [{ code: 'TRUNCATED', message: `Extraction limitée aux ${rows.length} premières lignes sur ${total}.` }]
    : [];
  return ok({ rows, fieldWarnings, warnings, truncated });
}
