import { useCallback, useEffect, useState } from 'react';
import type { Scenario } from '../../shared/types';
import { storageErrorMessage } from '../../storage/errors';
import { listScenarios } from '../../storage/scenarios';

/**
 * Liste des scénarios, tenue à jour quand le stockage change (modification
 * depuis le tableau de bord ou une autre fenêtre).
 */
export function useScenarios() {
  const [scenarios, setScenarios] = useState<Scenario[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setScenarios(await listScenarios());
      setError(null);
    } catch (e) {
      setError(storageErrorMessage(e));
    }
  }, []);

  useEffect(() => {
    void reload();
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && Object.keys(changes).some((key) => key.startsWith('swx.scenario.'))) void reload();
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, [reload]);

  return { scenarios, error, reload };
}
