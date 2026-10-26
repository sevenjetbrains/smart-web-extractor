/**
 * Suppression des données et durée de conservation (cahier §6.2), espace
 * utilisé (cahier §5.3).
 */
import type { Run } from '../shared/types';
import { STORES, deleteByIndex, request, transaction } from './db';
import { ACTIVE_STATES } from './runs';

const LAST_PURGE_KEY = 'swx.lastPurge';
const DAY_MS = 24 * 60 * 60 * 1000;

/** Délai de prévenance avant la purge automatique d'une exécution. */
export const PURGE_NOTICE_DAYS = 7;

/** Supprime des exécutions avec leurs résultats et journaux, en une seule transaction. */
async function deleteRuns(runIds: string[]): Promise<number> {
  if (runIds.length === 0) return 0;
  await transaction([STORES.runs, STORES.results, STORES.logs], 'readwrite', async (tx) => {
    for (const id of runIds) {
      tx.objectStore(STORES.runs).delete(id);
      await deleteByIndex(tx.objectStore(STORES.results), 'runId', id);
      await deleteByIndex(tx.objectStore(STORES.logs), 'runId', id);
    }
  });
  return runIds.length;
}

export function deleteRun(runId: string): Promise<number> {
  return deleteRuns([runId]);
}

/** Supprime toutes les exécutions (et leurs résultats) d'un scénario. */
export async function deleteScenarioData(scenarioId: string): Promise<number> {
  const ids = await transaction([STORES.runs], 'readonly', (tx) =>
    request(tx.objectStore(STORES.runs).index('scenarioId').getAllKeys(scenarioId)),
  );
  return deleteRuns(ids as string[]);
}

/** Date à partir de laquelle une exécution terminée est purgée. */
export function expiresAt(run: Run, retentionDays: number): number {
  return Date.parse(run.endedAt ?? run.startedAt) + retentionDays * DAY_MS;
}

async function finishedRuns(): Promise<Run[]> {
  const runs = (await transaction([STORES.runs], 'readonly', (tx) => request(tx.objectStore(STORES.runs).getAll()))) as Run[];
  // Une exécution en cours ou en pause n'est jamais purgée : l'utilisateur peut la reprendre.
  return runs.filter((run) => !ACTIVE_STATES.includes(run.state));
}

/** Exécutions qui seront purgées dans les prochains jours (affichées comme avertissement). */
export async function runsExpiringSoon(retentionDays: number, now = Date.now()): Promise<Run[]> {
  return (await finishedRuns()).filter((run) => {
    const at = expiresAt(run, retentionDays);
    return at > now && at <= now + PURGE_NOTICE_DAYS * DAY_MS;
  });
}

export interface PurgeReport {
  at: string;
  count: number;
}

/** Purge les exécutions terminées dont la durée de conservation est dépassée. */
export async function purgeExpiredRuns(retentionDays: number, now = Date.now()): Promise<number> {
  const expired = (await finishedRuns()).filter((run) => expiresAt(run, retentionDays) <= now);
  const count = await deleteRuns(expired.map((run) => run.id));
  if (count > 0) {
    const report: PurgeReport = { at: new Date(now).toISOString(), count };
    await chrome.storage.local.set({ [LAST_PURGE_KEY]: report });
  }
  return count;
}

/** Dernière purge automatique, pour en informer l'utilisateur. */
export async function getLastPurge(): Promise<PurgeReport | null> {
  const value = (await chrome.storage.local.get(LAST_PURGE_KEY))[LAST_PURGE_KEY] as Partial<PurgeReport> | undefined;
  return typeof value?.at === 'string' && typeof value.count === 'number' ? { at: value.at, count: value.count } : null;
}

export async function clearLastPurge(): Promise<void> {
  await chrome.storage.local.remove(LAST_PURGE_KEY);
}

/** Supprime toutes les données de l'extension : scénarios, préférences, exécutions, résultats, journaux. */
export async function clearAllData(): Promise<void> {
  await transaction([STORES.runs, STORES.results, STORES.logs], 'readwrite', (tx) => {
    for (const name of [STORES.runs, STORES.results, STORES.logs]) tx.objectStore(name).clear();
  });
  await chrome.storage.local.clear();
}

export interface StorageUsage {
  /** Scénarios et préférences (chrome.storage.local, limité à 10 Mo). */
  settingsBytes: number;
  settingsQuota: number;
  /** Ensemble du stockage de l'extension (IndexedDB compris), selon le navigateur. */
  totalBytes: number | null;
  totalQuota: number | null;
}

export async function storageUsage(): Promise<StorageUsage> {
  const settingsBytes = await chrome.storage.local.getBytesInUse(null);
  let totalBytes: number | null = null;
  let totalQuota: number | null = null;
  try {
    const estimate = await navigator.storage.estimate();
    totalBytes = estimate.usage ?? null;
    totalQuota = estimate.quota ?? null;
  } catch {
    // Estimation indisponible.
  }
  return { settingsBytes, settingsQuota: chrome.storage.local.QUOTA_BYTES, totalBytes, totalQuota };
}
