/**
 * Environnement de stockage pour les tests : faux chrome.storage.local (mêmes
 * règles de sérialisation JSON et de quota) et IndexedDB en mémoire, remis à
 * zéro avant chaque test.
 */
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach } from 'vitest';
import { closeDb } from '../../../src/storage/db';

export const QUOTA_BYTES = 10 * 1024 * 1024;

export class FakeStorageArea {
  readonly QUOTA_BYTES = QUOTA_BYTES;
  data = new Map<string, string>();
  /** Quota simulé (octets) ; par défaut celui de Chrome. */
  quota = QUOTA_BYTES;

  private bytes(entries: Iterable<[string, string]>): number {
    let total = 0;
    for (const [key, value] of entries) total += key.length + value.length;
    return total;
  }

  async get(keys: string | string[] | null): Promise<Record<string, unknown>> {
    const wanted = keys === null ? [...this.data.keys()] : Array.isArray(keys) ? keys : [keys];
    const result: Record<string, unknown> = {};
    for (const key of wanted) {
      const value = this.data.get(key);
      if (value !== undefined) result[key] = JSON.parse(value);
    }
    return result;
  }

  async set(items: Record<string, unknown>): Promise<void> {
    const next = new Map(this.data);
    for (const [key, value] of Object.entries(items)) next.set(key, JSON.stringify(value));
    if (this.bytes(next) > this.quota) throw new Error('Resource::kQuotaBytes quota exceeded');
    this.data = next;
  }

  async remove(keys: string | string[]): Promise<void> {
    for (const key of Array.isArray(keys) ? keys : [keys]) this.data.delete(key);
  }

  async clear(): Promise<void> {
    this.data.clear();
  }

  async getBytesInUse(_keys: null): Promise<number> {
    return this.bytes(this.data);
  }
}

export let storageArea = new FakeStorageArea();

/** À appeler en tête d'un fichier de test qui utilise le stockage. */
export function useFakeStorage(): void {
  beforeEach(async () => {
    await closeDb();
    globalThis.indexedDB = new IDBFactory();
    storageArea = new FakeStorageArea();
    (globalThis as { chrome?: unknown }).chrome = { storage: { local: storageArea } };
  });
}
