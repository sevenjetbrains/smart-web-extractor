/**
 * Détection des paires libellé → valeur d'une page (fiches détaillées, formulaires).
 * La même fonction sert à la détection et à la stratégie de localisation « label »,
 * ce qui garantit que les deux s'accordent.
 */
import {
  elementChildren,
  isFormControl,
  isSkipped,
  labelFromText,
  normalizeText,
  ownText,
  splitLabelValue,
  tagOf,
  textOf,
  walkElements,
} from './dom-utils';
import { isSensitiveField } from './sensitive';
import { buildGrid, cellText, isKeyValueTable } from './table-grid';
import type { ReadMode } from '../shared/types';

export interface LabelPair {
  label: string;
  /** Élément qui porte la valeur. */
  target: Element;
  read: ReadMode;
  /** Champ de formulaire sensible : la valeur ne doit jamais être lue. */
  sensitive: boolean;
}

const IGNORED_INPUT_TYPES = new Set(['button', 'submit', 'reset', 'image', 'checkbox', 'radio', 'file', 'hidden']);
const NOT_INLINE_LABEL = new Set(['label', 'dt', 'dd', 'th', 'td', 'option', 'button', 'a', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'caption', 'legend', 'summary']);

function cleanLabel(value: string): string {
  return normalizeText(value).replace(/\s*:$/, '');
}

function usableControl(el: Element | null): el is HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement {
  if (!el || !isFormControl(el) || isSkipped(el)) return false;
  return !(tagOf(el) === 'input' && IGNORED_INPUT_TYPES.has((el.getAttribute('type') ?? 'text').toLowerCase()));
}

/** Champ de formulaire associé à un <label> (attribut for, ou champ contenu dans le label). */
function controlOfLabel(label: Element): Element | null {
  const htmlFor = label.getAttribute('for');
  if (htmlFor) return label.ownerDocument.getElementById(htmlFor);
  return label.querySelector('input, select, textarea');
}

export function findLabelPairs(root: Element, exclude: readonly Element[] = []): LabelPair[] {
  const pairs: LabelPair[] = [];
  const seen = new Set<Element>();
  const excluded = (el: Element) => exclude.some((ex) => ex.contains(el));
  const add = (label: string, target: Element, read: ReadMode) => {
    const clean = cleanLabel(label);
    if (!clean || seen.has(target) || excluded(target) || !root.contains(target)) return;
    seen.add(target);
    pairs.push({ label: clean, target, read, sensitive: isFormControl(target) && isSensitiveField(target) });
  };

  // Formulaires : <label> associés, puis champs portant un aria-label.
  for (const label of Array.from(root.querySelectorAll('label'))) {
    if (isSkipped(label)) continue;
    const control = controlOfLabel(label);
    if (usableControl(control) || (control && isFormControl(control) && isSensitiveField(control))) {
      add(textOf(label), control!, 'text');
    }
  }
  for (const control of Array.from(root.querySelectorAll('input[aria-label], select[aria-label], textarea[aria-label]'))) {
    if (usableControl(control)) add(control.getAttribute('aria-label') ?? '', control, 'text');
  }

  // Listes de définitions.
  for (const dt of Array.from(root.querySelectorAll('dt'))) {
    if (isSkipped(dt)) continue;
    let dd = dt.nextElementSibling;
    while (dd && tagOf(dd) !== 'dd' && tagOf(dd) !== 'dt') dd = dd.nextElementSibling;
    if (dd && tagOf(dd) === 'dd') add(textOf(dt), dd, 'text');
  }

  // Tableaux clé/valeur (<th>libellé</th><td>valeur</td>).
  for (const table of Array.from(root.querySelectorAll('table'))) {
    if (isSkipped(table)) continue;
    const grid = buildGrid(table as HTMLTableElement);
    if (!isKeyValueTable(grid)) continue;
    for (const row of grid.cells) add(cellText(row[0]!), row[1]!, 'text');
  }

  // Libellés en ligne : « <span>Grade :</span> <span>valeur</span> » ou « Grade : valeur ».
  for (const el of walkElements(root)) {
    if (NOT_INLINE_LABEL.has(tagOf(el)) || el.closest('label, dt, dd, th, td, a, button, select')) continue;
    const children = elementChildren(el);
    if (children.length > 0) continue;
    const text = ownText(el);
    const label = labelFromText(text);
    if (label) {
      const next = el.nextElementSibling;
      if (next && !isSkipped(next) && textOf(next) && !labelFromText(textOf(next))) {
        add(label, next, 'text');
      } else if (el.parentElement && splitLabelValue(textOf(el.parentElement))) {
        add(label, el.parentElement, 'afterColon');
      }
      continue;
    }
    const split = splitLabelValue(text);
    if (split) add(split.label, el, 'afterColon');
  }

  return pairs.sort((a, b) => (a.target.compareDocumentPosition(b.target) & 4 ? -1 : 1));
}
