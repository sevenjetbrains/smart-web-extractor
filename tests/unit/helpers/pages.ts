import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';

export const TEST_PAGES_URL = 'http://127.0.0.1:5174';

/** Charge une page de test-pages/ dans jsdom (scripts de la page non exécutés). */
export function loadPage(name: string): Document {
  const html = readFileSync(resolve(import.meta.dirname, '../../../test-pages', name), 'utf8');
  return new JSDOM(html, { url: `${TEST_PAGES_URL}/${name}` }).window.document;
}

/** Document construit à partir d'un fragment HTML. */
export function fromHtml(body: string): Document {
  return new JSDOM(`<!doctype html><html><head><title>Test</title></head><body>${body}</body></html>`, {
    url: `${TEST_PAGES_URL}/fragment.html`,
  }).window.document;
}
