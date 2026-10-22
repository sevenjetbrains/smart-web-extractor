/**
 * Règles de sécurité vérifiées sur le code source (cahier §6.1).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(import.meta.dirname, '../../src');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

const files = sourceFiles(SRC).map((path) => ({
  path: relative(SRC, path).replaceAll('\\', '/'),
  code: readFileSync(path, 'utf8'),
}));

describe('règles du code source', () => {
  it('n’utilise ni eval ni new Function', () => {
    const offenders = files.filter(({ code }) => /\beval\s*\(|new\s+Function\s*\(/.test(code)).map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it('n’injecte pas de HTML brut', () => {
    const offenders = files
      .filter(({ code }) => /innerHTML|outerHTML|insertAdjacentHTML|dangerouslySetInnerHTML/.test(code))
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it('importe Zod uniquement via src/shared/zod.ts (mode jitless)', () => {
    const offenders = files
      .filter(({ path, code }) => path !== 'shared/zod.ts' && /from\s+['"]zod(\/[^'"]*)?['"]/.test(code))
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it('n’envoie aucune requête réseau', () => {
    const offenders = files
      .filter(({ code }) => /\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|EventSource/.test(code))
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });
});
