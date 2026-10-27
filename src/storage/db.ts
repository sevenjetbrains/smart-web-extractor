/**
 * Base IndexedDB de l'extension : exécutions, résultats et journaux (cahier §4).
 * Elle n'est ouverte que depuis les pages de l'extension et le service worker,
 * jamais depuis un content script, qui accéderait à la base du site visité
 * (cahier §4.2, point 3).
 */
import { toStorageError } from './errors';

export const DB_NAME = 'smart-web-extractor';
export const DB_VERSION = 1;

export const STORES = { runs: 'runs', results: 'results', logs: 'logs' } as const;
export type StoreName = (typeof STORES)[keyof typeof STORES];

let connection: Promise<IDBDatabase> | null = null;

function upgrade(db: IDBDatabase): void {
  if (!db.objectStoreNames.contains(STORES.runs)) {
    const runs = db.createObjectStore(STORES.runs, { keyPath: 'id' });
    runs.createIndex('scenarioId', 'scenarioId');
    runs.createIndex('state', 'state');
  }
  if (!db.objectStoreNames.contains(STORES.results)) {
    const results = db.createObjectStore(STORES.results, { keyPath: 'id' });
    results.createIndex('runId', 'runId');
    // Non unique : les doublons d'une exécution sont signalés, pas supprimés (cahier §3.3).
    results.createIndex('runId_recordKey', ['runId', 'recordKey']);
  }
  if (!db.objectStoreNames.contains(STORES.logs)) {
    const logs = db.createObjectStore(STORES.logs, { autoIncrement: true });
    logs.createIndex('runId', 'runId');
  }
}

export function openDb(): Promise<IDBDatabase> {
  connection ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => upgrade(request.result);
    request.onsuccess = () => {
      const db = request.result;
      // Une autre page demande une version plus récente : on libère la base.
      db.onversionchange = () => {
        db.close();
        connection = null;
      };
      resolve(db);
    };
    request.onerror = () => {
      connection = null;
      reject(request.error ?? new Error('Ouverture de la base impossible.'));
    };
  });
  return connection;
}

/** Ferme la connexion (tests). */
export async function closeDb(): Promise<void> {
  const pending = connection;
  connection = null;
  if (pending) (await pending.catch(() => null))?.close();
}

export function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Exécute `body` dans une transaction et attend sa validation complète.
 * Les dépassements de quota sont convertis en StorageError('QUOTA_EXCEEDED') ;
 * la transaction est alors annulée et les données précédentes restent intactes.
 */
export async function transaction<T>(
  stores: StoreName[],
  mode: IDBTransactionMode,
  body: (tx: IDBTransaction) => Promise<T> | T,
): Promise<T> {
  const db = await openDb();
  try {
    const tx = db.transaction(stores, mode);
    const done = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('Transaction annulée.'));
    });
    let result: T;
    try {
      result = await body(tx);
    } catch (e) {
      try {
        tx.abort();
      } catch {
        // Déjà terminée.
      }
      await done.catch(() => undefined);
      throw e;
    }
    await done;
    return result;
  } catch (e) {
    throw toStorageError(e);
  }
}

/** Supprime toutes les entrées d'un index correspondant à une clé. */
export async function deleteByIndex(store: IDBObjectStore, index: string, key: IDBValidKey): Promise<number> {
  const keys = await request(store.index(index).getAllKeys(key));
  for (const k of keys) store.delete(k);
  return keys.length;
}
