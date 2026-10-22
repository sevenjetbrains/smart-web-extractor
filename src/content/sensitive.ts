/**
 * Détection des champs sensibles (cahier des charges §1.3, « Valeur sensible ») :
 * leurs valeurs ne doivent jamais être lues ni enregistrées.
 */

const SENSITIVE_AUTOCOMPLETE = /\b(current-password|new-password|one-time-code|cc-[a-z-]+)\b/i;
const SENSITIVE_INPUT_TYPES = new Set(['password', 'hidden']);

export interface FieldLike {
  tagName: string;
  getAttribute(name: string): string | null;
}

export function isSensitiveField(el: FieldLike): boolean {
  if (el.getAttribute('data-swx-sensitive') !== null) return true;
  if (el.tagName.toLowerCase() === 'input') {
    const type = (el.getAttribute('type') ?? 'text').toLowerCase();
    if (SENSITIVE_INPUT_TYPES.has(type)) return true;
  }
  return SENSITIVE_AUTOCOMPLETE.test(el.getAttribute('autocomplete') ?? '');
}
