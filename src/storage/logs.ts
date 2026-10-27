/**
 * Journal local des exécutions (cahier §6.2 et §7) : codes d'étape, niveau,
 * code et message technique. Il ne contient ni valeur extraite ni donnée
 * personnelle ; les adresses y sont enregistrées sans paramètres.
 */
import type { LogEntry } from '../shared/types';
import { STORES, request, transaction } from './db';

const MAX_MESSAGE_LENGTH = 500;

/** Adresse sans paramètres ni fragment (les paramètres peuvent contenir des identifiants). */
export function urlWithoutParams(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return '';
  }
}

/** Retire les paramètres des adresses citées dans un message et borne sa longueur. */
export function sanitizeLogMessage(message: string): string {
  return message
    .replace(/https?:\/\/[^\s"'<>]+/g, (url) => urlWithoutParams(url) || '[adresse]')
    .slice(0, MAX_MESSAGE_LENGTH);
}

export async function addLogs(entries: LogEntry[]): Promise<void> {
  if (entries.length === 0) return;
  await transaction([STORES.logs], 'readwrite', (tx) => {
    const store = tx.objectStore(STORES.logs);
    for (const entry of entries) store.add({ ...entry, message: sanitizeLogMessage(entry.message) });
  });
}

export async function listLogs(runId: string): Promise<LogEntry[]> {
  const entries = await transaction([STORES.logs], 'readonly', (tx) =>
    request(tx.objectStore(STORES.logs).index('runId').getAll(runId)),
  );
  return entries as LogEntry[];
}
