/**
 * Mise en forme commune des interfaces (dates, tailles, libellés d'états).
 */
import type { RecordStatus, RunMode, RunState, Scenario } from '../../shared/types';

const dateFormat = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' });

export function formatDate(iso: string | number): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '—' : dateFormat.format(date);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Ko`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Mo`;
  return `${(bytes / 1024 ** 3).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Go`;
}

export function scenarioStatusLabel(status: Scenario['status']): string {
  return status === 'validated' ? 'validé' : 'brouillon';
}

export const RECORD_TYPE_LABELS: Record<Scenario['recordType'], string> = {
  list: 'Liste',
  detail: 'Fiche',
  list_and_details: 'Liste et fiches',
};

export const RUN_STATE_LABELS: Record<RunState, string> = {
  running: 'En cours',
  paused: 'En pause',
  assisted: 'Mode assisté',
  completed: 'Terminée',
  stopped: 'Arrêtée',
  failed: 'Échouée',
};

export const RUN_MODE_LABELS: Record<RunMode, string> = {
  semi_automatic: 'Semi-automatique',
  automatic: 'Automatique',
};

export const RECORD_STATUS_LABELS: Record<RecordStatus, string> = {
  complete: 'Complet',
  incomplete: 'Incomplet',
  error: 'Erreur',
  duplicate: 'Doublon',
  uncertainMatch: 'Association incertaine',
};
