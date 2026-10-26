/**
 * Lancement du Chromium de Playwright avec l'extension (build dist-e2e) et le
 * serveur des pages de test. Le build de test a un accès permanent à 127.0.0.1.
 */
import type { Server } from 'node:http';
import { resolve } from 'node:path';
import { chromium, expect, type BrowserContext, type Page } from '@playwright/test';
import { startTestPagesServer } from '../../scripts/serve-test-pages';

const EXTENSION_PATH = resolve(import.meta.dirname, '../../dist-e2e');

export interface ExtensionHarness {
  context: BrowserContext;
  extensionId: string;
  baseUrl: string;
  /** Requêtes émises vers autre chose que l'extension ou le serveur local. */
  unexpectedRequests: string[];
  /** Ouvre une page de l'extension en collectant ses erreurs JavaScript et console. */
  openExtensionPage(path: string): Promise<{ page: Page; errors: string[] }>;
  /** Ouvre une page de test et renvoie l'identifiant de son onglet. */
  openSite(path: string): Promise<{ site: Page; tabId: number }>;
  close(): Promise<void>;
}

export async function launchExtension(): Promise<ExtensionHarness> {
  const { server, baseUrl }: { server: Server; baseUrl: string } = await startTestPagesServer();
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    args: [`--disable-extensions-except=${EXTENSION_PATH}`, `--load-extension=${EXTENSION_PATH}`],
  });
  const unexpectedRequests: string[] = [];
  context.on('request', (request) => {
    const url = request.url();
    if (!/^(chrome-extension:|chrome:|data:|about:|http:\/\/(127\.0\.0\.1|localhost):)/.test(url)) {
      unexpectedRequests.push(url);
    }
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const extensionId = new URL(worker.url()).host;

  async function openExtensionPage(path: string) {
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await page.goto(`chrome-extension://${extensionId}/${path}`);
    return { page, errors };
  }

  async function allTabIds(): Promise<number[]> {
    return worker.evaluate(async () => (await chrome.tabs.query({})).map((t) => t.id!));
  }

  /** Identifiant retrouvé par différence : sans permission, l'URL d'un onglet n'est pas visible. */
  async function openSite(path: string) {
    const before = new Set(await allTabIds());
    const site = await context.newPage();
    await site.goto(path.includes('://') ? path : `${baseUrl}/${path}`);
    const created = (await allTabIds()).filter((id) => !before.has(id));
    expect(created).toHaveLength(1);
    return { site, tabId: created[0]! };
  }

  return {
    context,
    extensionId,
    baseUrl,
    unexpectedRequests,
    openExtensionPage,
    openSite,
    async close() {
      await context.close();
      server.close();
    },
  };
}
