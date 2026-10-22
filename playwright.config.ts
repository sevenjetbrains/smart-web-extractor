import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  // Un seul navigateur avec l'extension chargée : pas de parallélisme.
  workers: 1,
  fullyParallel: false,
  timeout: 30_000,
  reporter: [['list']],
});
