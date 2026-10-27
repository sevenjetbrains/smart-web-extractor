import { useEffect, useState, type KeyboardEvent } from 'react';
import type { StatusInfo } from '../../shared/messages';
import type { Run } from '../../shared/types';
import { clearLastPurge, getLastPurge, purgeExpiredRuns, runsExpiringSoon, type PurgeReport } from '../../storage/purge';
import { getSettings } from '../../storage/settings';
import { FirstRunNotice } from '../components/FirstRunNotice';
import { formatDate } from '../lib/format';
import { sendToBackground } from '../lib/messaging';
import { versionLabel } from '../lib/phases';
import { RunsView } from './RunsView';
import { ScenariosView } from './ScenariosView';
import { SettingsView } from './SettingsView';

const TABS = [
  { id: 'scenarios', label: 'Scénarios' },
  { id: 'runs', label: 'Exécutions et résultats' },
  { id: 'settings', label: 'Paramètres et données' },
] as const;
type TabId = (typeof TABS)[number]['id'];

/**
 * Tableau de bord (cahier §4.1) : scénarios, exécutions et résultats,
 * paramètres, purge des données. À l'ouverture, les exécutions dont la durée
 * de conservation est dépassée sont purgées, et l'utilisateur en est informé.
 */
export function Dashboard() {
  const [status, setStatus] = useState<StatusInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>('scenarios');
  const [runsFilter, setRunsFilter] = useState<string | null>(null);
  const [lastPurge, setLastPurge] = useState<PurgeReport | null>(null);
  const [expiring, setExpiring] = useState<Run[]>([]);

  useEffect(() => {
    void sendToBackground({ type: 'GET_STATUS' }).then((r) =>
      r.ok ? setStatus(r.data) : setError(r.error.message),
    );
    void (async () => {
      try {
        const { retentionDays } = await getSettings();
        await purgeExpiredRuns(retentionDays);
        setLastPurge(await getLastPurge());
        setExpiring(await runsExpiringSoon(retentionDays));
      } catch {
        // Stockage indisponible : les vues afficheront l'erreur.
      }
    })();
  }, []);

  function onTabKey(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const next = TABS[(index + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length]!;
    setTab(next.id);
    document.getElementById(`tab-${next.id}`)?.focus();
  }

  return (
    <main className="dashboard">
      <h1>Smart Web Extractor — Tableau de bord</h1>
      <p className="muted" aria-live="polite">
        {status && `${versionLabel(status)}. Service worker opérationnel.`}
        {error}
      </p>
      <FirstRunNotice />

      {lastPurge && (
        <p className="alert ok row between" role="status">
          <span>
            {lastPurge.count} exécution(s) supprimée(s) automatiquement le {formatDate(lastPurge.at)} (durée de
            conservation dépassée).
          </span>
          <button type="button" className="link" onClick={() => void clearLastPurge().then(() => setLastPurge(null))}>
            Fermer
          </button>
        </p>
      )}
      {expiring.length > 0 && (
        <p className="alert warn" role="status">
          {expiring.length} exécution(s) seront supprimées automatiquement dans les 7 prochains jours. Exportez-les ou
          allongez la durée de conservation dans les paramètres si vous souhaitez les garder.
        </p>
      )}

      <div className="tabs" role="tablist" aria-label="Sections du tableau de bord">
        {TABS.map((t, i) => (
          <button
            key={t.id}
            id={`tab-${t.id}`}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            aria-controls={`panel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => setTab(t.id)}
            onKeyDown={(e) => onTabKey(e, i)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div id={`panel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`}>
        {tab === 'scenarios' && (
          <ScenariosView
            onShowRuns={(id) => {
              setRunsFilter(id);
              setTab('runs');
            }}
          />
        )}
        {tab === 'runs' && <RunsView scenarioFilter={runsFilter} onFilterChange={setRunsFilter} />}
        {tab === 'settings' && <SettingsView />}
      </div>
    </main>
  );
}
