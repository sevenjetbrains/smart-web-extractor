import { useCallback, useEffect, useState } from 'react';
import type { AppError, PageSummary, StatusInfo } from '../../shared/messages';
import { getActiveTab, originPattern, sendToBackground, type ActiveTabInfo } from '../lib/messaging';

type Analysis =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'done'; summary: PageSummary }
  | { state: 'error'; error: AppError };

/**
 * Panneau latéral : interface principale (cahier §4.1). Il reste ouvert pendant
 * la navigation. En phase 1, il vérifie la chaîne panneau → service worker →
 * content script et la gestion de l'accès aux sites.
 */
export function SidePanel() {
  const [status, setStatus] = useState<StatusInfo | null>(null);
  const [tab, setTab] = useState<ActiveTabInfo | null>(null);
  const [granted, setGranted] = useState(false);
  const [analysis, setAnalysis] = useState<Analysis>({ state: 'idle' });

  const refreshTab = useCallback(async () => {
    const current = await getActiveTab();
    setTab(current);
    setAnalysis({ state: 'idle' });
    const pattern = originPattern(current?.url);
    setGranted(pattern ? await chrome.permissions.contains({ origins: [pattern] }) : false);
  }, []);

  useEffect(() => {
    void sendToBackground({ type: 'GET_STATUS' }).then((r) => r.ok && setStatus(r.data));
    void refreshTab();

    const onActivated = () => void refreshTab();
    const onUpdated = (_id: number, info: chrome.tabs.OnUpdatedInfo) => {
      if (info.status === 'complete') void refreshTab();
    };
    chrome.tabs.onActivated.addListener(onActivated);
    chrome.tabs.onUpdated.addListener(onUpdated);
    return () => {
      chrome.tabs.onActivated.removeListener(onActivated);
      chrome.tabs.onUpdated.removeListener(onUpdated);
    };
  }, [refreshTab]);

  async function analyze() {
    if (!tab) return;
    setAnalysis({ state: 'loading' });
    const result = await sendToBackground({ type: 'PING_TAB', tabId: tab.id });
    setAnalysis(result.ok ? { state: 'done', summary: result.data } : { state: 'error', error: result.error });
  }

  async function grantDomain() {
    const pattern = originPattern(tab?.url);
    if (!pattern) return;
    // Appelé dans le geste de l'utilisateur (clic), comme l'exige Chrome.
    const ok = await chrome.permissions.request({ origins: [pattern] });
    setGranted(ok);
  }

  const host = tab?.url ? originPattern(tab.url)?.replace(/^https?:\/\/|\/\*$/g, '') : undefined;

  return (
    <main style={{ padding: '1rem' }}>
      <h1>Smart Web Extractor</h1>

      <section className="card" aria-labelledby="page-title">
        <h2 id="page-title">Page courante</h2>
        {tab?.url ? (
          <p>
            <strong>{tab.title || 'Sans titre'}</strong>
            <br />
            <span className="muted">{host ?? tab.url}</span>
          </p>
        ) : (
          <p className="muted">
            Adresse inconnue : l’extension n’a pas encore accès à cet onglet. Cliquez sur l’icône de l’extension
            depuis la page pour lui donner un accès ponctuel.
          </p>
        )}
        {host && (
          <p className="muted">
            Accès durable à ce domaine : <strong>{granted ? 'accordé' : 'non accordé'}</strong>
          </p>
        )}
        <div className="row">
          <button type="button" onClick={() => void analyze()} disabled={!tab || analysis.state === 'loading'}>
            {analysis.state === 'loading' ? 'Analyse…' : 'Tester l’accès à la page'}
          </button>
          {host && !granted && (
            <button type="button" className="secondary" onClick={() => void grantDomain()}>
              Autoriser ce domaine
            </button>
          )}
        </div>

        <div aria-live="polite">
          {analysis.state === 'done' && (
            <div className="alert ok" style={{ marginTop: '0.75rem' }}>
              Connexion avec la page établie.
              <dl>
                <dt>Tableaux</dt>
                <dd>{analysis.summary.tableCount}</dd>
                <dt>Champs</dt>
                <dd>{analysis.summary.formFieldCount}</dd>
                <dt>Champs sensibles ignorés</dt>
                <dd>{analysis.summary.sensitiveFieldCount}</dd>
              </dl>
            </div>
          )}
          {analysis.state === 'error' && (
            <p className="alert err" role="alert" style={{ marginTop: '0.75rem' }}>
              {analysis.error.message}
            </p>
          )}
        </div>
      </section>

      <footer className="muted">
        {status ? `Version ${status.version} — phase ${status.phase} (fondations)` : 'Connexion au service worker…'}
      </footer>
    </main>
  );
}
