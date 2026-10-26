import type { StatusInfo } from '../../shared/messages';

const PHASE_NAMES: Record<number, string> = {
  1: 'fondations',
  2: 'détection',
  3: 'stockage',
  4: 'apprentissage',
  5: 'automatisation',
  6: 'résultats et export',
  7: 'finalisation',
};

export function versionLabel(status: StatusInfo): string {
  const name = PHASE_NAMES[status.phase];
  return `Version ${status.version} — phase ${status.phase}${name ? ` (${name})` : ''}`;
}
