import { describe, expect, it } from 'vitest';
import { isSensitiveField, type FieldLike } from '../../src/content/sensitive';

function field(tagName: string, attrs: Record<string, string> = {}): FieldLike {
  return { tagName, getAttribute: (name) => attrs[name] ?? null };
}

describe('isSensitiveField (cahier §1.3)', () => {
  it.each([
    ['mot de passe', field('INPUT', { type: 'password' })],
    ['type en majuscules', field('INPUT', { type: 'PASSWORD' })],
    ['champ caché', field('INPUT', { type: 'hidden' })],
    ['autocomplete current-password', field('INPUT', { autocomplete: 'current-password' })],
    ['autocomplete new-password', field('INPUT', { autocomplete: 'section-x new-password' })],
    ['code à usage unique', field('INPUT', { autocomplete: 'one-time-code' })],
    ['numéro de carte', field('INPUT', { autocomplete: 'cc-number' })],
    ['marqué par l’utilisateur', field('TEXTAREA', { 'data-swx-sensitive': '' })],
  ])('détecte : %s', (_label, el) => {
    expect(isSensitiveField(el)).toBe(true);
  });

  it.each([
    ['texte', field('INPUT', { type: 'text' })],
    ['input sans type', field('INPUT')],
    ['select', field('SELECT')],
    ['autocomplete nom', field('INPUT', { autocomplete: 'family-name' })],
  ])('ne signale pas : %s', (_label, el) => {
    expect(isSensitiveField(el)).toBe(false);
  });
});
