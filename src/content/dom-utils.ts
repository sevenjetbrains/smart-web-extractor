/**
 * Utilitaires DOM sans dépendance aux variables globales (window, document, CSS…),
 * afin d'être testables sur un document jsdom.
 */

/** Attribut posé sur les éléments ajoutés par l'extension (surcouche de sélection). */
export const OVERLAY_ATTR = 'data-swx-overlay';

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

const SKIPPED_TAGS = new Set(['script', 'style', 'template', 'noscript', 'svg', 'canvas', 'iframe', 'object', 'head']);

const BLOCK_TAGS = new Set([
  'address', 'article', 'aside', 'blockquote', 'br', 'dd', 'div', 'dl', 'dt', 'fieldset', 'figcaption', 'figure',
  'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'li', 'main', 'nav', 'ol', 'p', 'pre',
  'section', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul', 'caption',
]);

const FORM_CONTROLS = new Set(['input', 'select', 'textarea']);

export const tagOf = (el: Element): string => el.tagName.toLowerCase();

export function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** Élément ignoré par la détection : invisible, technique ou ajouté par l'extension. */
export function isSkipped(el: Element): boolean {
  if (SKIPPED_TAGS.has(tagOf(el))) return true;
  if (el.hasAttribute('hidden') || el.hasAttribute(OVERLAY_ATTR)) return true;
  if (el.getAttribute('aria-hidden') === 'true') return true;
  const style = (el as HTMLElement).style;
  return style?.display === 'none' || style?.visibility === 'hidden';
}

export function isFormControl(el: Element): el is HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement {
  return FORM_CONTROLS.has(tagOf(el));
}

/**
 * Texte lisible d'un élément : espaces normalisés, éléments masqués ignorés,
 * séparation des blocs, valeurs des champs de formulaire exclues.
 */
export function textOf(root: Element, options: { skipNestedTables?: boolean } = {}): string {
  const parts: string[] = [];
  const walk = (node: Node) => {
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === TEXT_NODE) {
        parts.push(child.nodeValue ?? '');
      } else if (child.nodeType === ELEMENT_NODE) {
        const el = child as Element;
        if (isSkipped(el) || isFormControl(el)) continue;
        if (options.skipNestedTables && tagOf(el) === 'table') continue;
        const block = BLOCK_TAGS.has(tagOf(el));
        if (block) parts.push(' ');
        walk(el);
        if (block) parts.push(' ');
      }
    }
  };
  walk(root);
  return normalizeText(parts.join(''));
}

/** Texte porté directement par l'élément (nœuds texte enfants uniquement). */
export function ownText(el: Element): string {
  let value = '';
  for (let child = el.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === TEXT_NODE) value += child.nodeValue ?? '';
  }
  return normalizeText(value);
}

export function elementChildren(el: Element): Element[] {
  return Array.from(el.children).filter((child) => !isSkipped(child));
}

/** Parcours en profondeur des éléments visibles (les sous-arbres ignorés ne sont pas visités). */
export function* walkElements(root: Element): Generator<Element> {
  const stack: Element[] = [root];
  while (stack.length) {
    const el = stack.pop()!;
    if (isSkipped(el)) continue;
    yield el;
    const children = el.children;
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]!);
  }
}

/**
 * Identifiant ou classe stable : écarte les valeurs générées par les frameworks
 * (suites de chiffres, empreintes, préfixes connus).
 */
export function isStableToken(value: string): boolean {
  if (!value || value.length > 64) return false;
  if (/\d{4,}/.test(value)) return false;
  if (/^(ember|react-|ng-|mui-|radix-|headlessui-|:r|css-|sc-|jsx-|emotion-|svelte-|v-)/i.test(value)) return false;
  if (/^[:_-]/.test(value)) return false;
  // Mélange aléatoire de majuscules, minuscules et chiffres (ex. « Kx7aB2q »).
  if (/[A-Z]/.test(value) && /[a-z]/.test(value) && /\d/.test(value)) return false;
  // Empreinte hexadécimale.
  if (/[0-9a-f]{6,}/i.test(value) && /\d/.test(value) && /[a-f]/i.test(value)) return false;
  return true;
}

export function stableClasses(el: Element): string[] {
  return Array.from(el.classList).filter(isStableToken).slice(0, 3);
}

/** Équivalent de CSS.escape (indisponible dans certains environnements de test). */
export function cssEscape(value: string): string {
  let result = '';
  for (let i = 0; i < value.length; i++) {
    const ch = value.charAt(i);
    const code = value.charCodeAt(i);
    if (code === 0) {
      result += '\uFFFD';
    } else if (
      (code >= 0x1 && code <= 0x1f) ||
      code === 0x7f ||
      (i === 0 && code >= 0x30 && code <= 0x39) ||
      (i === 1 && code >= 0x30 && code <= 0x39 && value.charCodeAt(0) === 0x2d)
    ) {
      result += `\\${code.toString(16)} `;
    } else if (i === 0 && value.length === 1 && code === 0x2d) {
      result += `\\${ch}`;
    } else if (code >= 0x80 || code === 0x2d || code === 0x5f || /[0-9A-Za-z]/.test(ch)) {
      result += ch;
    } else {
      result += `\\${ch}`;
    }
  }
  return result;
}

/** Valeur d'attribut entre guillemets pour un sélecteur CSS. */
export function cssString(value: string): string {
  return `"${value.replace(/["\\]/g, '\\$&').replace(/\n/g, '\\a ')}"`;
}

/** querySelectorAll qui renvoie [] pour un sélecteur invalide (ex. issu d'un scénario importé). */
export function safeQueryAll(root: ParentNode, selector: string): Element[] {
  try {
    return Array.from(root.querySelectorAll(selector));
  } catch {
    return [];
  }
}

/** Titre le plus proche qui précède l'élément (h1–h6), en remontant de quelques niveaux. */
export function precedingHeading(el: Element, maxDepth = 3): string | null {
  let current: Element | null = el;
  for (let depth = 0; current && depth <= maxDepth; depth++) {
    for (let sib = current.previousElementSibling; sib; sib = sib.previousElementSibling) {
      if (/^h[1-6]$/.test(tagOf(sib))) return textOf(sib) || null;
      const nested = Array.from(sib.querySelectorAll('h1,h2,h3,h4,h5,h6')).pop();
      if (nested) return textOf(nested) || null;
    }
    current = current.parentElement;
  }
  return null;
}

/** Libellé lisible déduit d'un nom de classe (ex. « date-entree » → « Date entree »). */
export function humanize(token: string): string {
  const words = token.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_]+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : '';
}

/** Libellé suivi de « : » (ex. « Grade : »), sans le deux-points. Null si le texte n'est pas un libellé. */
export function labelFromText(value: string): string | null {
  const match = /^(.{1,60}?)\s*:$/.exec(normalizeText(value));
  return match && /\p{L}/u.test(match[1]!) ? match[1]! : null;
}

/** Texte de la forme « Libellé : valeur ». */
export function splitLabelValue(value: string): { label: string; value: string } | null {
  const match = /^([^:]{1,60}?)\s*:\s*(\S.*)$/.exec(normalizeText(value));
  if (!match) return null;
  const label = match[1]!;
  if (!/\p{L}/u.test(label) || /^(https?|ftp|mailto|tel)$/i.test(label)) return null;
  return { label, value: match[2]! };
}
