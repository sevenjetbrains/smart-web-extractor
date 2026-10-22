/**
 * Tests de bout en bout de la phase 1 : l'extension (build dist-e2e) est chargée
 * dans le Chromium de Playwright. Le build de test a un accès permanent à
 * 127.0.0.1 uniquement (cf. src/manifest.ts).
 */
import type { Server } from 'node:http';
import { resolve } from 'node:path';
import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';
import { startTestPagesServer } from '../../scripts/serve-test-pages';

const EXTENSION_PATH = resolve(import.meta.dirname, '../../dist-e2e');

let context: BrowserContext;
let extensionId: string;
let server: Server;
let baseUrl: string;
const unexpectedRequests: string[] = [];

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  ({ server, baseUrl } = await startTestPagesServer());
  context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    args: [`--disable-extensions-except=${EXTENSION_PATH}`, `--load-extension=${EXTENSION_PATH}`],
  });
  // Aucune requête ne doit sortir vers un serveur externe (cahier §6.1).
  context.on('request', (request) => {
    const url = request.url();
    if (!/^(chrome-extension:|chrome:|data:|about:|http:\/\/(127\.0\.0\.1|localhost):)/.test(url)) {
      unexpectedRequests.push(url);
    }
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  extensionId = new URL(worker.url()).host;
});

test.afterAll(async () => {
  await context?.close();
  server?.close();
});

/** Ouvre une page de l'extension en collectant les erreurs JavaScript et console. */
async function openExtensionPage(path: string): Promise<{ page: Page; errors: string[] }> {
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(`chrome-extension://${extensionId}/${path}`);
  return { page, errors };
}

/** Envoie un message au service worker depuis une page de l'extension. */
function sendFrom(page: Page, message: unknown): Promise<any> {
  return page.evaluate((m) => chrome.runtime.sendMessage(m), message);
}

async function allTabIds(page: Page): Promise<number[]> {
  return page.evaluate(async () => (await chrome.tabs.query({})).map((t) => t.id!));
}

/**
 * Ouvre une URL dans un nouvel onglet et renvoie son identifiant, retrouvé par
 * différence : sans permission, l'URL d'un onglet n'est pas visible par l'extension.
 */
async function openTab(panel: Page, url: string): Promise<{ site: Page; tabId: number }> {
  const before = new Set(await allTabIds(panel));
  const site = await context.newPage();
  await site.goto(url);
  const created = (await allTabIds(panel)).filter((id) => !before.has(id));
  expect(created).toHaveLength(1);
  return { site, tabId: created[0]! };
}

async function tabIdOf(page: Page, urlPattern: string): Promise<number> {
  const id = await page.evaluate(async (pattern) => {
    const [tab] = await chrome.tabs.query({ url: pattern });
    return tab?.id;
  }, urlPattern);
  expect(id, `onglet introuvable pour ${urlPattern}`).toBeDefined();
  return id!;
}

test('le service worker démarre depuis le bon fichier', async () => {
  const worker = context.serviceWorkers().find((w) => w.url().startsWith(`chrome-extension://${extensionId}/`));
  expect(worker?.url()).toBe(`chrome-extension://${extensionId}/background/service-worker.js`);
});

test('la popup s’affiche sans erreur', async () => {
  const { page, errors } = await openExtensionPage('ui/popup/index.html');
  await expect(page.getByRole('heading', { name: 'Smart Web Extractor' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ouvrir le panneau latéral' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Tableau de bord' })).toBeVisible();
  expect(errors).toEqual([]);
  await page.close();
});

test('le tableau de bord communique avec le service worker', async () => {
  const { page, errors } = await openExtensionPage('ui/dashboard/index.html');
  await expect(page.getByText('Version 0.1.0 — phase 1 (fondations). Service worker opérationnel.')).toBeVisible();
  expect(errors).toEqual([]);
  await page.close();
});

test('le panneau latéral s’affiche et obtient le statut', async () => {
  const { page, errors } = await openExtensionPage('ui/sidepanel/index.html');
  await expect(page.getByText('Version 0.1.0 — phase 1 (fondations)')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Tester l’accès à la page' })).toBeVisible();
  expect(errors).toEqual([]);
  await page.close();
});

test('chaîne complète : panneau → service worker → content script injecté', async () => {
  const site = await context.newPage();
  await site.goto(`${baseUrl}/liste-simple.html`);
  const { page, errors } = await openExtensionPage('ui/sidepanel/index.html');

  const tabId = await tabIdOf(page, `${baseUrl}/liste-simple.html`);
  const first = await sendFrom(page, { type: 'PING_TAB', tabId });
  expect(first).toEqual({
    ok: true,
    data: {
      title: 'Liste des agents',
      url: `${baseUrl}/liste-simple.html`,
      tableCount: 1,
      formFieldCount: 3,
      sensitiveFieldCount: 2,
    },
  });
  // Aucune valeur de champ sensible ne transite.
  expect(JSON.stringify(first)).not.toContain('ne-doit-jamais-etre-lu');
  expect(JSON.stringify(first)).not.toContain('jeton-secret');

  // Réinjection dans la même page : un seul écouteur, même réponse.
  expect(await sendFrom(page, { type: 'PING_TAB', tabId })).toEqual(first);

  // Le content script s'exécute dans un monde isolé : la page ne voit pas son état.
  expect(await site.evaluate(() => (window as { __swxContentInstalled?: boolean }).__swxContentInstalled)).toBeUndefined();

  expect(errors).toEqual([]);
  await Promise.all([page.close(), site.close()]);
});

test('page interne de Chrome : erreur RESTRICTED_PAGE', async () => {
  const { page } = await openExtensionPage('ui/sidepanel/index.html');
  const { site, tabId } = await openTab(page, 'chrome://version');
  const result = await sendFrom(page, { type: 'PING_TAB', tabId });
  expect(result).toMatchObject({ ok: false, error: { code: 'RESTRICTED_PAGE' } });
  await Promise.all([page.close(), site.close()]);
});

test('site non autorisé : erreur NO_SITE_ACCESS', async () => {
  // localhost n'est pas dans les permissions du build de test (seulement 127.0.0.1).
  const { page } = await openExtensionPage('ui/sidepanel/index.html');
  const { site, tabId } = await openTab(page, `${baseUrl.replace('127.0.0.1', 'localhost')}/liste-simple.html`);
  const result = await sendFrom(page, { type: 'PING_TAB', tabId });
  expect(result).toMatchObject({ ok: false, error: { code: 'NO_SITE_ACCESS' } });
  await Promise.all([page.close(), site.close()]);
});

test('messages invalides refusés par le service worker', async () => {
  const { page } = await openExtensionPage('ui/sidepanel/index.html');
  expect(await sendFrom(page, { type: 'PING_TAB', tabId: 'x' })).toMatchObject({
    ok: false,
    error: { code: 'INVALID_MESSAGE' },
  });
  expect(await sendFrom(page, { type: 'DELETE_EVERYTHING' })).toMatchObject({
    ok: false,
    error: { code: 'INVALID_MESSAGE' },
  });
  expect(await sendFrom(page, { type: 'PING_TAB', tabId: 999_999 })).toMatchObject({
    ok: false,
    error: { code: 'TAB_NOT_FOUND' },
  });
  await page.close();
});

test('aucune requête vers un serveur externe', () => {
  expect(unexpectedRequests).toEqual([]);
});
