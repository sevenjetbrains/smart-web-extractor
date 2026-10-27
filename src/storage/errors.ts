/**
 * Erreurs du stockage local, avec un message compréhensible par l'utilisateur.
 */

export type StorageErrorCode = 'QUOTA_EXCEEDED' | 'NOT_FOUND' | 'CONFLICT' | 'INVALID' | 'TOO_LARGE';

export class StorageError extends Error {
  constructor(
    readonly code: StorageErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'StorageError';
  }
}

const QUOTA_MESSAGE =
  'Espace de stockage insuffisant : les données déjà enregistrées sont conservées. Supprimez d’anciennes exécutions dans les paramètres, puis réessayez.';

/** Dépassement de quota d'IndexedDB (QuotaExceededError) ou de chrome.storage (QUOTA_BYTES). */
export function isQuotaError(e: unknown): boolean {
  if (e instanceof StorageError) return e.code === 'QUOTA_EXCEEDED';
  const name = (e as { name?: unknown } | null)?.name;
  const message = e instanceof Error ? e.message : String(e);
  return name === 'QuotaExceededError' || /quota/i.test(message);
}

/** Convertit une erreur de bas niveau en StorageError ; les autres erreurs sont relancées telles quelles. */
export function toStorageError(e: unknown): unknown {
  if (e instanceof StorageError) return e;
  if (isQuotaError(e)) return new StorageError('QUOTA_EXCEEDED', QUOTA_MESSAGE);
  return e;
}

/** Message à afficher pour une erreur quelconque du stockage. */
export function storageErrorMessage(e: unknown): string {
  const converted = toStorageError(e);
  return converted instanceof StorageError ? converted.message : 'Erreur inattendue du stockage local.';
}
