/**
 * Tests de bout en bout de la phase 3 : scénario enregistré depuis le panneau,
 * réutilisé sur une autre page, résultats conservés, révisions, export et
 * import, rechargement après redémarrage du navigateur, suppression des données.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { launchExtension, type ExtensionHarness } from './fixtures';

let h: ExtensionHarness;
const profile = mkdtempSync(join(tmpdir(), 'swx-e2e-'));
let exportedFile = '';

test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
  h = await launchExtension({ userDataDir: profile });
});
test.afterAll(async () => {
  await h?.close();
  rmSync(profile, { recursive: true, force: true });
});

async function openPanelFor(path: string) {
  const { site, tabId } = await h.openSite(path);
  const { page: panel, errors } = await h.openExtensionPage(`ui/sidepanel/index.html?tabId=${tabId}`);
  return { site, panel, errors };
}

async function openDashboard() {
  return h.openExtensionPage('ui/dashboard/index.html');
}

const fieldItem = (panel: Page, detected: string) =>
  panel.locator('li.field', { has: panel.getByRole('textbox', { name: `Nom du champ (détecté : ${detected})` }) });

test('enregistrer un scénario depuis le panneau, extraire avec lui et conserver les résultats', async () => {
  const { site, panel, errors } = await openPanelFor('liste-simple.html');

  // Avertissement du premier lancement.
  await expect(panel.getByRole('heading', { name: 'Avant de commencer' })).toBeVisible();
  await panel.getByRole('button', { name: 'J’ai compris' }).click();
  await expect(panel.getByRole('heading', { name: 'Avant de commencer' })).toHaveCount(0);

  await panel.getByRole('button', { name: 'Analyser la page' }).click();
  await fieldItem(panel, 'Matricule').getByLabel('Obligatoire').check();
  await panel.getByRole('checkbox', { name: 'Champ « Grade » sensible (jamais lu)' }).check();
  await expect(fieldItem(panel, 'Grade').getByText('Champ sensible : sa valeur ne sera jamais lue ni enregistrée.')).toBeVisible();

  await panel.getByLabel('Nom du scénario').fill('Agents');
  await panel.getByRole('button', { name: 'Enregistrer comme scénario' }).click();
  await expect(panel.getByText('Scénario « Agents » enregistré (brouillon, révision 1).')).toBeVisible();

  await expect(panel.getByRole('heading', { name: 'Scénarios de ce domaine' })).toBeVisible();
  await panel.getByRole('button', { name: 'Extraire avec ce scénario' }).click();
  await expect(panel.getByText('3 ligne(s) extraite(s).')).toBeVisible();
  // Le champ sensible n'est ni lu ni affiché.
  await expect(panel.locator('table.preview thead th')).toHaveText(['#', 'Matricule *', 'Nom']);
  await expect(panel.locator('table.preview')).not.toContainText('Ingénieur');

  await panel.getByRole('button', { name: 'Enregistrer les résultats' }).click();
  await expect(panel.getByText('3 enregistrement(s) conservé(s) dans une nouvelle exécution.', { exact: false })).toBeVisible();

  expect(errors).toEqual([]);
  await Promise.all([panel.close(), site.close()]);
});

test('réutiliser le scénario sur une autre page du domaine, avec ses propres valeurs', async () => {
  const { site, panel, errors } = await openPanelFor('liste-agents-rh.html');
  // Aucune analyse nécessaire : les règles du scénario suffisent.
  await panel.getByRole('button', { name: 'Extraire avec ce scénario' }).click();
  await expect(panel.getByText('4 ligne(s) extraite(s) — 1 incomplète(s) (champ obligatoire manquant).')).toBeVisible();
  await expect(panel.locator('table.preview tbody tr').nth(0).locator('td')).toHaveText(['1', '01001', 'Haddad Samir']);
  await panel.getByRole('button', { name: 'Enregistrer les résultats' }).click();
  await expect(panel.getByText('4 enregistrement(s) conservé(s)', { exact: false })).toBeVisible();

  expect(errors).toEqual([]);
  await Promise.all([panel.close(), site.close()]);
});

test('tableau de bord : exécutions et résultats conservés', async () => {
  const { page, errors } = await openDashboard();
  await page.getByRole('tab', { name: 'Exécutions et résultats' }).click();
  const rows = page.locator('table.data tbody tr');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('Agents (révision 1)');
  await expect(rows.nth(0).locator('td').nth(4)).toHaveText('4');
  await expect(rows.nth(1).locator('td').nth(4)).toHaveText('3');

  await rows.nth(0).getByRole('button', { name: 'Voir les résultats' }).click();
  const results = page.locator('table.results tbody tr');
  await expect(results).toHaveCount(4);
  await expect(results.nth(2)).toContainText('Incomplet');
  await expect(results.nth(3)).toContainText('Doublon');
  await expect(results.nth(0).getByRole('link', { name: 'Ouvrir' })).toHaveAttribute('href', `${h.baseUrl}/liste-agents-rh.html`);
  await expect(page.getByText('MANUAL_EXTRACTION')).toBeVisible();
  await page.getByRole('button', { name: 'Retour aux exécutions' }).click();

  await rows.nth(1).getByRole('button', { name: 'Voir les résultats' }).click();
  await expect(page.locator('table.results tbody tr').nth(2)).toContainText('محمد العربي');
  await expect(page.locator('table.results tbody tr').nth(0)).toContainText('00123');

  expect(errors).toEqual([]);
  await page.close();
});

test('modifier un scénario validé crée une nouvelle révision', async () => {
  const { page, errors } = await openDashboard();
  await page.getByRole('button', { name: 'Modifier' }).click();
  await page.getByLabel('État').selectOption('validated');
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(page.getByText('Modifications enregistrées.')).toBeVisible();
  await expect(page.getByText('l’enregistrement créera la révision 2', { exact: false })).toBeVisible();

  await page.getByRole('textbox', { name: 'Libellé du champ nom' }).fill('Nom complet');
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(page.getByText('Révision 2 enregistrée.')).toBeVisible();
  const revisions = page.locator('#revisions-title + ul li');
  await expect(revisions).toHaveCount(2);
  await expect(revisions.nth(0)).toContainText('Révision 2 — validé');
  await expect(revisions.nth(1)).toContainText('Révision 1 — validé');

  // Les exécutions passées restent liées à la révision 1 et à ses libellés.
  await page.getByRole('button', { name: 'Retour à la liste' }).click();
  await page.getByRole('tab', { name: 'Exécutions et résultats' }).click();
  await page.locator('table.data tbody tr').nth(0).getByRole('button', { name: 'Voir les résultats' }).click();
  await expect(page.locator('table.results thead th')).toHaveText(['#', 'État', 'Matricule', 'Nom', 'Source']);

  expect(errors).toEqual([]);
  await page.close();
});

test('exporter puis importer un scénario ; rejeter un import invalide', async () => {
  const { page, errors } = await openDashboard();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Exporter' }).click()]);
  expect(download.suggestedFilename()).toBe('scenario-agents-r2.json');
  exportedFile = join(profile, '..', `swx-export-${Date.now()}.json`);
  await download.saveAs(exportedFile);
  const exported = JSON.parse(readFileSync(exportedFile, 'utf8'));
  expect(exported).toMatchObject({ schemaVersion: 2, revision: 2, status: 'validated', domain: '127.0.0.1' });
  // Uniquement des règles : aucune valeur extraite.
  for (const value of ['00123', '01001', 'Benali', 'Haddad']) expect(JSON.stringify(exported)).not.toContain(value);

  await page.locator('input[type=file]').setInputFiles(exportedFile);
  await expect(page.getByRole('heading', { name: 'Confirmer l’import de « Agents »' })).toBeVisible();
  await expect(page.getByText('Ce scénario s’applique au domaine 127.0.0.1', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Confirmer le domaine et importer' }).click();
  await expect(page.getByText('Scénario « Agents » importé en brouillon.')).toBeVisible();
  await expect(page.locator('.scenario-list > li')).toHaveCount(2);

  await page.locator('input[type=file]').setInputFiles({
    name: 'piege.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ ...exported, results: [{ nom: 'x' }] })),
  });
  await expect(page.getByText('Import refusé : Le scénario ne respecte pas le format attendu.')).toBeVisible();
  await expect(page.locator('.scenario-list > li')).toHaveCount(2);

  expect(errors).toEqual([]);
  await page.close();
  rmSync(exportedFile, { force: true });
});

test('scénarios et résultats conservés après redémarrage du navigateur', async () => {
  expect(h.unexpectedRequests).toEqual([]);
  await h.close();
  h = await launchExtension({ userDataDir: profile });

  const { page, errors } = await openDashboard();
  await expect(page.locator('.scenario-list > li')).toHaveCount(2);
  await expect(page.locator('.scenario-list')).toContainText('révision 2');
  // L'avertissement déjà accepté ne réapparaît pas.
  await expect(page.getByRole('heading', { name: 'Avant de commencer' })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Exécutions et résultats' }).click();
  await expect(page.locator('table.data tbody tr')).toHaveCount(2);

  expect(errors).toEqual([]);
  await page.close();
});

test('supprimer toutes les données de l’extension', async () => {
  const { page, errors } = await openDashboard();
  await page.getByRole('tab', { name: 'Paramètres et données' }).click();
  await expect(page.getByText('Scénarios et préférences')).toBeVisible();
  await page.getByRole('button', { name: 'Supprimer toutes les données' }).click();
  await page.getByRole('button', { name: 'Tout supprimer définitivement' }).click();
  await expect(page.getByText('Toutes les données de l’extension ont été supprimées.')).toBeVisible();

  await page.getByRole('tab', { name: 'Scénarios' }).click();
  await expect(page.getByText('Aucun scénario.', { exact: false })).toBeVisible();
  await page.getByRole('tab', { name: 'Exécutions et résultats' }).click();
  await expect(page.getByText('Aucune exécution.', { exact: false })).toBeVisible();

  expect(errors).toEqual([]);
  await page.close();
});

test('aucune requête vers un serveur externe', () => {
  expect(h.unexpectedRequests).toEqual([]);
});
