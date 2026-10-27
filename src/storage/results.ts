/**
 * Résultats d'extraction (un enregistrement par ligne ou par fiche), dans IndexedDB.
 */
import type { ResultRecord } from '../shared/types';
import { STORES, request, transaction } from './db';

/** Ajoute ou met à jour des enregistrements en une seule transaction. */
export async function putResults(records: ResultRecord[]): Promise<void> {
  if (records.length === 0) return;
  await transaction([STORES.results], 'readwrite', (tx) => {
    const store = tx.objectStore(STORES.results);
    for (const record of records) store.put(record);
  });
}

/** Enregistrements d'une exécution, dans l'ordre de collecte. */
export async function listResults(runId: string): Promise<ResultRecord[]> {
  const records = await transaction([STORES.results], 'readonly', (tx) =>
    request(tx.objectStore(STORES.results).index('runId').getAll(runId)),
  );
  return (records as ResultRecord[]).sort((a, b) => a.collectedAt.localeCompare(b.collectedAt) || a.id.localeCompare(b.id, 'en', { numeric: true }));
}

export async function countResults(runId: string): Promise<number> {
  return transaction([STORES.results], 'readonly', (tx) => request(tx.objectStore(STORES.results).index('runId').count(runId)));
}

/** Enregistrements d'une exécution ayant une clé donnée (reprise sans doublon, cahier §7.2). */
export async function findByRecordKey(runId: string, recordKey: string): Promise<ResultRecord[]> {
  const records = await transaction([STORES.results], 'readonly', (tx) =>
    request(tx.objectStore(STORES.results).index('runId_recordKey').getAll([runId, recordKey])),
  );
  return records as ResultRecord[];
}
