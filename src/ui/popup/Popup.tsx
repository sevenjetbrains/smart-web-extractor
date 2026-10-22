import { useEffect, useState } from 'react';
import { PATHS } from '../../manifest';
import { getActiveTab, type ActiveTabInfo } from '../lib/messaging';

/**
 * Popup : lancement rapide uniquement (cahier §4.1). Elle se ferme dès qu'elle
 * perd le focus, donc aucun pilotage d'exécution ne se fait ici.
 */
export function Popup() {
  const [tab, setTab] = useState<ActiveTabInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void getActiveTab().then(setTab);
  }, []);

  async function openSidePanel() {
    if (!tab) return;
    try {
      // Doit être appelé directement dans le geste de l'utilisateur.
      await chrome.sidePanel.open({ windowId: tab.windowId });
      window.close();
    } catch {
      setError('Impossible d’ouvrir le panneau latéral dans cette fenêtre.');
    }
  }

  async function openDashboard() {
    await chrome.tabs.create({ url: chrome.runtime.getURL(PATHS.dashboard) });
    window.close();
  }

  const host = tab?.url ? safeHost(tab.url) : null;

  return (
    <main>
      <h1>Smart Web Extractor</h1>
      <p className="muted">{host ? `Page : ${host}` : 'Page courante non accessible.'}</p>
      <div className="stack">
        <button type="button" onClick={() => void openSidePanel()} disabled={!tab}>
          Ouvrir le panneau latéral
        </button>
        <button type="button" className="secondary" onClick={() => void openDashboard()}>
          Tableau de bord
        </button>
      </div>
      {error && (
        <p className="alert err" role="alert">
          {error}
        </p>
      )}
    </main>
  );
}

function safeHost(url: string): string | null {
  try {
    return new URL(url).host || null;
  } catch {
    return null;
  }
}
