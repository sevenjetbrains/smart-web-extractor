/**
 * Tests de bout en bout de la phase 2, pilotés par l'interface du panneau latéral
 * (ouvert dans un onglet avec ?tabId=…) sur les pages de test.
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

async function openPanelFor(path: string) {
  const { site, tabId } = await h.openSite(path);
  const { page: panel, errors } = await h.openExtensionPage(`ui/sidepanel/index.html?tabId=${tabId}`);
  return { site, panel, errors };
}

const sourceTab = (panel: Page, name: string) => panel.getByRole('button', { name: new RegExp(name) });
const fieldName = (panel: Page, detected: string) => panel.getByRole('textbox', { name: `Nom du champ (détecté : ${detected})` });
const preview = (panel: Page) => panel.locator('table.preview');

test('analyse, renommage et extraction d’un tableau', async () => {
  const { site, panel, errors } = await openPanelFor('liste-simple.html');
  await panel.getByRole('button', { name: 'Analyser la page' }).click();

  await expect(panel.getByRole('heading', { name: '2 source(s) de données' })).toBeVisible();
  await expect(sourceTab(panel, 'Liste des agents')).toHaveAttribute('aria-pressed', 'true');
  await expect(panel.getByText('1 champ(s) sensible(s) ignoré(s)', { exact: false })).toHaveCount(0);
  await expect(panel.getByText('2 champ(s) sensible(s) ignoré(s)', { exact: false })).toBeVisible();

  await fieldName(panel, 'Nom').fill('Nom complet');
  await expect(panel.getByText('clé : nom_complet')).toBeVisible();
  await panel.getByRole('checkbox', { name: 'Extraire le champ « Grade »' }).uncheck();
  await panel.getByRole('button', { name: 'Extraire cette page' }).click();

  await expect(panel.getByText('3 ligne(s) extraite(s).')).toBeVisible();
  await expect(preview(panel).locator('thead th')).toHaveText(['#', 'Matricule', 'Nom complet']);
  await expect(preview(panel).locator('tbody tr').nth(0).locator('td')).toHaveText(['1', '00123', 'Benali Karim']);
  await expect(preview(panel).locator('tbody tr').nth(2).locator('td')).toHaveText(['3', '00789', 'محمد العربي']);

  expect(errors).toEqual([]);
  await Promise.all([panel.close(), site.close()]);
});

test('champ obligatoire manquant : ligne signalée incomplète', async () => {
  const { site, panel, errors } = await openPanelFor('liste-cartes.html');
  await panel.getByRole('button', { name: 'Analyser la page' }).click();
  await expect(sourceTab(panel, 'Annuaire des agents')).toHaveAttribute('aria-pressed', 'true');

  await panel.getByRole('button', { name: 'Aucun' }).click();
  for (const label of ['Nom', 'Matricule', 'Grade']) {
    await panel.getByRole('checkbox', { name: `Extraire le champ « ${label} »` }).check();
  }
  const gradeField = panel.locator('li.field', { has: fieldName(panel, 'Grade') });
  await gradeField.getByRole('checkbox', { name: 'Obligatoire' }).check();
  await panel.getByRole('button', { name: 'Extraire cette page' }).click();

  await expect(panel.getByText('4 ligne(s) extraite(s) — 1 incomplète(s) (champ obligatoire manquant).')).toBeVisible();
  await expect(preview(panel).locator('tr.incomplete td').nth(1)).toHaveText('محمد العربي');
  expect(errors).toEqual([]);
  await Promise.all([panel.close(), site.close()]);
});

test('contenu dynamique : l’analyse attend le chargement du tableau', async () => {
  const { site, panel, errors } = await openPanelFor('contenu-dynamique.html');
  // Analyse lancée immédiatement, alors que la page affiche encore « Chargement… ».
  await panel.getByRole('button', { name: 'Analyser la page' }).click();
  await expect(sourceTab(panel, 'Agents \\(chargement différé\\)')).toBeVisible({ timeout: 10_000 });
  await expect(sourceTab(panel, 'Agents')).toContainText('3 ligne(s)');
  expect(errors).toEqual([]);
  await Promise.all([panel.close(), site.close()]);
});

test('en-tête déduit : l’utilisateur peut le désactiver', async () => {
  const { site, panel, errors } = await openPanelFor('liste-sans-entetes.html');
  await panel.getByRole('button', { name: 'Analyser la page' }).click();
  await sourceTab(panel, 'Codes postaux').click();
  await expect(sourceTab(panel, 'Codes postaux')).toContainText('3 ligne(s)');

  await panel.getByRole('checkbox', { name: 'La première ligne contient les en-têtes' }).check();
  await expect(sourceTab(panel, 'Codes postaux')).toContainText('2 ligne(s)');
  await expect(fieldName(panel, 'Oran')).toBeVisible();
  expect(errors).toEqual([]);
  await Promise.all([panel.close(), site.close()]);
});

test('sélection dans la page : clic intercepté, champ rattaché ou ajouté', async () => {
  const { site, panel, errors } = await openPanelFor('liste-cartes.html');
  await panel.getByRole('button', { name: 'Analyser la page' }).click();
  await expect(sourceTab(panel, 'Annuaire des agents')).toBeVisible();

  // 1. Un matricule d'une carte : rattaché au champ existant de la liste.
  await panel.getByRole('button', { name: 'Choisir dans la page' }).click();
  await expect(site.locator('[data-swx-overlay]')).toHaveCount(1);
  await site.locator('.matricule').nth(2).click();
  await expect(panel.getByText('« Matricule » sélectionné.')).toBeVisible();
  await expect(site.locator('[data-swx-overlay]')).toHaveCount(0);

  // 2. Un lien : le clic est intercepté, la page ne navigue pas.
  await panel.getByRole('button', { name: 'Choisir dans la page' }).click();
  await expect(site.locator('[data-swx-overlay]')).toHaveCount(1);
  await site.locator('a.details').first().click();
  await expect(panel.getByText(/sélectionné\.$/)).toBeVisible();
  expect(site.url()).toBe(`${h.baseUrl}/liste-cartes.html`);

  // 3. Le titre de la page : nouveau champ isolé.
  await panel.getByRole('button', { name: 'Choisir dans la page' }).click();
  await expect(site.locator('[data-swx-overlay]')).toHaveCount(1);
  await site.locator('h1').click();
  await expect(panel.getByText(/ajouté aux champs choisis dans la page\.$/)).toBeVisible();
  await expect(sourceTab(panel, 'Champs choisis dans la page')).toHaveAttribute('aria-pressed', 'true');
  await panel.getByRole('button', { name: 'Extraire cette page' }).click();
  await expect(preview(panel).locator('tbody td').nth(1)).toHaveText('Annuaire des agents');

  // 4. Échap annule la sélection.
  await panel.getByRole('button', { name: 'Choisir dans la page' }).click();
  await expect(site.locator('[data-swx-overlay]')).toHaveCount(1);
  await site.keyboard.press('Escape');
  await expect(site.locator('[data-swx-overlay]')).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Choisir dans la page' })).toBeEnabled();

  expect(errors).toEqual([]);
  await Promise.all([panel.close(), site.close()]);
});

test('mise en évidence d’une source dans la page', async () => {
  const { site, panel, errors } = await openPanelFor('liste-simple.html');
  await panel.getByRole('button', { name: 'Analyser la page' }).click();
  await panel.getByRole('button', { name: 'Afficher dans la page' }).click();
  await expect(site.locator('[data-swx-overlay]')).toHaveCount(1);
  await expect(site.locator('[data-swx-overlay]')).toHaveCount(0, { timeout: 5000 });
  expect(errors).toEqual([]);
  await Promise.all([panel.close(), site.close()]);
});

test('page piège : ambiguïtés signalées, valeur non choisie au hasard', async () => {
  const { site, panel, errors } = await openPanelFor('selecteurs-ambigus.html');
  await panel.getByRole('button', { name: 'Analyser la page' }).click();
  await sourceTab(panel, 'Champs de la page').click();
  await expect(panel.getByText(/Localisation ambiguë/).first()).toBeVisible();
  await panel.getByRole('button', { name: 'Extraire cette page' }).click();
  await expect(panel.getByText(/valeur\(s\) ambiguë\(s\), laissée\(s\) vide\(s\)/).first()).toBeVisible();
  await expect(preview(panel).locator('tbody td').nth(1)).toHaveText('—');
  expect(errors).toEqual([]);
  await Promise.all([panel.close(), site.close()]);
});

test('aucune requête vers un serveur externe', () => {
  expect(h.unexpectedRequests).toEqual([]);
});
