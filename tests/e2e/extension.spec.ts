/**
 * Tests de bout en bout des fondations : chargement de l'extension, pages sans
 * erreur, chaîne panneau → service worker → content script, gestion des accès.
 */
import { expect, test, type Page } from '@playwright/test';
import { launchExtension, type ExtensionHarness } from './fixtures';

let h: ExtensionHarness;

test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
  h = await launchExtension();
});
test.afterAll(async () => {
  await h?.close();
});

/** Envoie un message au service worker depuis une page de l'extension. */
function sendFrom(page: Page, message: unknown): Promise<any> {
  return page.evaluate((m) => chrome.runtime.sendMessage(m), message);
}

test('le service worker démarre depuis le bon fichier', async () => {
  const worker = h.context.serviceWorkers().find((w) => w.url().startsWith(`chrome-extension://${h.extensionId}/`));
  expect(worker?.url()).toBe(`chrome-extension://${h.extensionId}/background/service-worker.js`);
});

test('la popup s’affiche sans erreur', async () => {
  const { page, errors } = await h.openExtensionPage('ui/popup/index.html');
  await expect(page.getByRole('heading', { name: 'Smart Web Extractor' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ouvrir le panneau latéral' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Tableau de bord' })).toBeVisible();
  expect(errors).toEqual([]);
  await page.close();
});

test('le tableau de bord communique avec le service worker', async () => {
  const { page, errors } = await h.openExtensionPage('ui/dashboard/index.html');
  await expect(page.getByText('Version 0.2.0 — phase 2 (détection). Service worker opérationnel.')).toBeVisible();
  expect(errors).toEqual([]);
  await page.close();
});

test('le panneau latéral s’affiche et obtient le statut', async () => {
  const { page, errors } = await h.openExtensionPage('ui/sidepanel/index.html');
  await expect(page.getByText('Version 0.2.0 — phase 2 (détection)')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Analyser la page' })).toBeVisible();
  expect(errors).toEqual([]);
  await page.close();
});

test('chaîne complète : service worker → content script injecté', async () => {
  const { page, errors } = await h.openExtensionPage('ui/sidepanel/index.html');
  const { site, tabId } = await h.openSite('liste-simple.html');

  const first = await sendFrom(page, { type: 'PING_TAB', tabId });
  expect(first).toEqual({
    ok: true,
    data: {
      title: 'Liste des agents',
      url: `${h.baseUrl}/liste-simple.html`,
      tableCount: 1,
      formFieldCount: 3,
      sensitiveFieldCount: 2,
    },
  });
  // Aucune valeur de champ sensible ne transite.
  expect(JSON.stringify(first)).not.toContain('ne-doit-jamais-etre-lu');
  expect(JSON.stringify(first)).not.toContain('jeton-secret');

  // Réinjection dans la même page : l'écouteur est remplacé, même réponse.
  expect(await sendFrom(page, { type: 'PING_TAB', tabId })).toEqual(first);

  // Le content script s'exécute dans un monde isolé : la page ne voit pas son état.
  expect(await site.evaluate(() => (window as { __swxContent?: unknown }).__swxContent)).toBeUndefined();

  expect(errors).toEqual([]);
  await Promise.all([page.close(), site.close()]);
});

test('page interne de Chrome : erreur RESTRICTED_PAGE', async () => {
  const { page } = await h.openExtensionPage('ui/sidepanel/index.html');
  const { site, tabId } = await h.openSite('chrome://version');
  expect(await sendFrom(page, { type: 'PING_TAB', tabId })).toMatchObject({ ok: false, error: { code: 'RESTRICTED_PAGE' } });
  await Promise.all([page.close(), site.close()]);
});

test('site non autorisé : erreur NO_SITE_ACCESS', async () => {
  // localhost n'est pas dans les permissions du build de test (seulement 127.0.0.1).
  const { page } = await h.openExtensionPage('ui/sidepanel/index.html');
  const { site, tabId } = await h.openSite(`${h.baseUrl.replace('127.0.0.1', 'localhost')}/liste-simple.html`);
  expect(await sendFrom(page, { type: 'PING_TAB', tabId })).toMatchObject({ ok: false, error: { code: 'NO_SITE_ACCESS' } });
  await Promise.all([page.close(), site.close()]);
});

test('messages invalides refusés par le service worker et par le content script', async () => {
  const { page } = await h.openExtensionPage('ui/sidepanel/index.html');
  expect(await sendFrom(page, { type: 'PING_TAB', tabId: 'x' })).toMatchObject({ ok: false, error: { code: 'INVALID_MESSAGE' } });
  expect(await sendFrom(page, { type: 'DELETE_EVERYTHING' })).toMatchObject({ ok: false, error: { code: 'INVALID_MESSAGE' } });
  expect(await sendFrom(page, { type: 'PING_TAB', tabId: 999_999 })).toMatchObject({ ok: false, error: { code: 'TAB_NOT_FOUND' } });

  const { site, tabId } = await h.openSite('liste-simple.html');
  await sendFrom(page, { type: 'ENSURE_CONTENT', tabId });
  const response = await page.evaluate(
    (id) => chrome.tabs.sendMessage(id, { type: 'CONTENT_EXTRACT', source: { kind: 'table' }, fields: [] }),
    tabId,
  );
  expect(response).toMatchObject({ ok: false, error: { code: 'INVALID_MESSAGE' } });
  await Promise.all([page.close(), site.close()]);
});

test('aucune requête vers un serveur externe', () => {
  expect(h.unexpectedRequests).toEqual([]);
});
