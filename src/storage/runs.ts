/**
 * Exécutions (campagnes d'extraction), dans IndexedDB. Chaque exécution est
 * liée à la révision du scénario utilisée ; ses résultats ne sont jamais
 * mélangés avec ceux d'une autre exécution (cahier §3.5).
 */
import type { Run, RunState } from '../shared/types';
import { StorageError } from './errors';
import { STORES, request, transaction } from './db';

export function newRunId(): string {
  return `run_${crypto.randomUUID().replaceAll('-', '')}`;
}

export const ACTIVE_STATES: readonly RunState[] = ['running', 'paused', 'assisted'];

export async function putRun(run: Run): Promise<Run> {
  await transaction([STORES.runs], 'readwrite', (tx) => request(tx.objectStore(STORES.runs).put(run)));
  return run;
}

export async function getRun(id: string): Promise<Run | null> {
  const run = await transaction([STORES.runs], 'readonly', (tx) => request(tx.objectStore(STORES.runs).get(id)));
  return (run as Run | undefined) ?? null;
}

/** Exécutions, de la plus récente à la plus ancienne, éventuellement filtrées par scénario. */
export async function listRuns(filter: { scenarioId?: string } = {}): Promise<Run[]> {
  const runs = await transaction([STORES.runs], 'readonly', (tx) => {
    const store = tx.objectStore(STORES.runs);
    return request(filter.scenarioId ? store.index('scenarioId').getAll(filter.scenarioId) : store.getAll());
  });
  return (runs as Run[]).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export async function updateRun(id: string, patch: Partial<Omit<Run, 'id'>>): Promise<Run> {
  return transaction([STORES.runs], 'readwrite', async (tx) => {
    const store = tx.objectStore(STORES.runs);
    const run = (await request(store.get(id))) as Run | undefined;
    if (!run) throw new StorageError('NOT_FOUND', 'Cette exécution n’existe plus.');
    const next = { ...run, ...patch, id };
    await request(store.put(next));
    return next;
  });
}

/**
 * Au démarrage du service worker ou du navigateur, une exécution encore
 * « en cours » a été interrompue : elle passe en pause et sa reprise sera
 * proposée (cahier §7).
 */
export async function pauseInterruptedRuns(): Promise<number> {
  return transaction([STORES.runs], 'readwrite', async (tx) => {
    const store = tx.objectStore(STORES.runs);
    const running = (await request(store.index('state').getAll('running'))) as Run[];
    for (const run of running) store.put({ ...run, state: 'paused' satisfies RunState });
    return running.length;
  });
}
