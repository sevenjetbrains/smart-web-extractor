/**
 * Grille logique d'un tableau HTML : les cellules fusionnées (rowspan, colspan)
 * sont dépliées, si bien que chaque position de la grille pointe vers la cellule
 * qui l'occupe. Une valeur fusionnée est donc répliquée sur toutes les lignes et
 * colonnes qu'elle couvre (cahier §3.1).
 */
import { normalizeText, tagOf, textOf } from './dom-utils';
import type { HeaderMode } from '../shared/content-protocol';

export interface TableGrid {
  table: HTMLTableElement;
  /** cells[ligne][colonne] ; null si la position est vide (ligne incomplète). */
  cells: (HTMLTableCellElement | null)[][];
  columnCount: number;
  /** Nombre de lignes d'en-tête explicites (<thead> ou lignes composées uniquement de <th>). */
  explicitHeaderRows: number;
  hasMergedCells: boolean;
}

const MAX_SPAN = 100;

function directRows(table: HTMLTableElement): HTMLTableRowElement[] {
  const rows: HTMLTableRowElement[] = [];
  for (const child of Array.from(table.children)) {
    const tag = tagOf(child);
    if (tag === 'tr') rows.push(child as HTMLTableRowElement);
    else if (tag === 'thead' || tag === 'tbody' || tag === 'tfoot') {
      for (const row of Array.from(child.children)) if (tagOf(row) === 'tr') rows.push(row as HTMLTableRowElement);
    }
  }
  return rows;
}

function span(cell: Element, attribute: 'rowspan' | 'colspan'): number {
  const value = Number.parseInt(cell.getAttribute(attribute) ?? '1', 10);
  return Number.isFinite(value) && value > 0 ? Math.min(value, MAX_SPAN) : 1;
}

export function buildGrid(table: HTMLTableElement): TableGrid {
  const rows = directRows(table);
  const cells: (HTMLTableCellElement | null)[][] = rows.map(() => []);
  let hasMergedCells = false;

  rows.forEach((row, r) => {
    let c = 0;
    for (const cell of Array.from(row.children)) {
      const tag = tagOf(cell);
      if (tag !== 'td' && tag !== 'th') continue;
      while (cells[r]![c] !== undefined) c++;
      const rs = Math.min(span(cell, 'rowspan'), rows.length - r);
      const cs = span(cell, 'colspan');
      if (rs > 1 || cs > 1) hasMergedCells = true;
      for (let dr = 0; dr < rs; dr++) {
        for (let dc = 0; dc < cs; dc++) cells[r + dr]![c + dc] = cell as HTMLTableCellElement;
      }
      c += cs;
    }
  });

  const columnCount = Math.max(0, ...cells.map((row) => row.length));
  for (const row of cells) {
    for (let c = 0; c < columnCount; c++) if (row[c] === undefined) row[c] = null;
  }

  let explicitHeaderRows = 0;
  const thead = Array.from(table.children).find((child) => tagOf(child) === 'thead');
  if (thead) {
    explicitHeaderRows = rows.filter((row) => row.parentElement === thead).length;
  } else {
    while (
      explicitHeaderRows < rows.length - 1 &&
      cells[explicitHeaderRows]!.some(Boolean) &&
      cells[explicitHeaderRows]!.every((cell) => !cell || tagOf(cell) === 'th')
    ) {
      explicitHeaderRows++;
    }
  }

  return { table, cells, columnCount, explicitHeaderRows, hasMergedCells };
}

export function cellText(cell: HTMLTableCellElement | null): string {
  return cell ? textOf(cell, { skipNestedTables: true }) : '';
}

const NUMERIC = /^[-+]?[\d\s.,]+%?$/;

/**
 * Mode d'en-tête par défaut : explicite si le tableau a des <th> d'en-tête ;
 * sinon la première ligne est proposée comme en-tête si elle ressemble à des
 * libellés (textes non vides, distincts, non numériques). L'utilisateur confirme.
 */
export function defaultHeaderMode(grid: TableGrid): HeaderMode {
  if (grid.explicitHeaderRows > 0) return 'explicit';
  if (grid.cells.length < 2) return 'none';
  const first = grid.cells[0]!.map(cellText);
  const looksLikeLabels =
    first.every((t) => t !== '' && !NUMERIC.test(t) && t.length <= 60) && new Set(first).size === first.length;
  return looksLikeLabels ? 'firstRow' : 'none';
}

export function headerRowCount(grid: TableGrid, mode: HeaderMode): number {
  if (mode === 'explicit') return grid.explicitHeaderRows;
  if (mode === 'firstRow') return grid.cells.length > 0 ? 1 : 0;
  return 0;
}

/**
 * Libellés des colonnes : les niveaux d'en-tête sont concaténés
 * (« Identité › Nom »), sans répéter un libellé fusionné sur plusieurs niveaux.
 */
export function columnLabels(grid: TableGrid, mode: HeaderMode): string[] {
  const count = headerRowCount(grid, mode);
  const labels: string[] = [];
  for (let c = 0; c < grid.columnCount; c++) {
    const parts: string[] = [];
    let previous: HTMLTableCellElement | null = null;
    for (let r = 0; r < count; r++) {
      const cell = grid.cells[r]![c] ?? null;
      if (!cell || cell === previous) continue;
      previous = cell;
      const text = cellText(cell);
      if (text && parts[parts.length - 1] !== text) parts.push(text);
    }
    labels.push(parts.join(' › '));
  }
  return labels;
}

/** Index des lignes de données : après l'en-tête, en ignorant les lignes entièrement vides. */
export function dataRowIndexes(grid: TableGrid, mode: HeaderMode): number[] {
  const indexes: number[] = [];
  for (let r = headerRowCount(grid, mode); r < grid.cells.length; r++) {
    if (grid.cells[r]!.some((cell) => cellText(cell) !== '')) indexes.push(r);
  }
  return indexes;
}

export function normalizeLabel(value: string): string {
  return normalizeText(value).replace(/\s*:$/, '').toLocaleLowerCase('fr');
}

/** Tableau clé/valeur : chaque ligne a exactement deux cellules, la première étant un <th>. */
export function isKeyValueTable(grid: TableGrid): boolean {
  if (grid.explicitHeaderRows > 0 || grid.columnCount !== 2 || grid.cells.length === 0) return false;
  return grid.cells.every((row) => row[0] && tagOf(row[0]) === 'th' && row[1] && tagOf(row[1]) === 'td');
}
