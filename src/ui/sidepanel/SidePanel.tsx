import { useCallback, useEffect, useRef, useState } from 'react';
import type { StatusInfo } from '../../shared/messages';
import { versionLabel } from '../lib/phases';
import { getActiveTab, originPattern, sendToBackground, type ActiveTabInfo } from '../lib/messaging';
import { ExtractionPreview } from './ExtractionPreview';
import { SourceDetail, Warnings, sourceSummary } from './SourceDetail';
import { useDetection } from './useDetection';

/**
 * Onglet piloté imposé par l'adresse (?tabId=…) : utilisé quand le panneau est
 * ouvert dans un onglet, notamment par les tests de bout en bout.
 */
const FORCED_TAB_ID = Number(new URLSearchParams(location.search).get('tabId')) || null;

async function currentTab(): Promise<ActiveTabInfo | null> {
  if (FORCED_TAB_ID === null) return getActiveTab();
  try {
    const tab = await chrome.tabs.get(FORCED_TAB_ID);
    return { id: FORCED_TAB_ID, windowId: tab.windowId, url: tab.url, title: tab.title };
  } catch {
    return null;
  }
}

/**
 * Panneau latéral : interface principale (cahier §4.1). Il reste ouvert pendant
 * la navigation et suit l'onglet actif. En phase 2 : analyse de la page,
 * choix et renommage des champs, sélection dans la page, extraction manuelle.
 */
export function SidePanel() {
  const [status, setStatus] = useState<StatusInfo | null>(null);
  const [tab, setTab] = useState<ActiveTabInfo | null>(null);
  const [granted, setGranted] = useState(false);
  const detection = useDetection(tab?.id ?? null);
  const { reset } = detection;

  const tabRef = useRef<ActiveTabInfo | null>(null);

  const refreshTab = useCallback(async () => {
    const current = await currentTab();
    const previous = tabRef.current;
    // Nouvelle page ou nouvel onglet : la détection précédente ne vaut plus.
    if (previous?.id !== current?.id || previous?.url !== current?.url) reset();
    tabRef.current = current;
    setTab(current);
    const pattern = originPattern(current?.url);
    setGranted(pattern ? await chrome.permissions.contains({ origins: [pattern] }) : false);
  }, [reset]);

  useEffect(() => {
    void sendToBackground({ type: 'GET_STATUS' }).then((r) => r.ok && setStatus(r.data));
    void refreshTab();

    const onActivated = () => FORCED_TAB_ID === null && void refreshTab();
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

  async function grantDomain() {
    const pattern = originPattern(tab?.url);
    if (!pattern) return;
    // Appelé dans le geste de l'utilisateur (clic), comme l'exige Chrome.
    setGranted(await chrome.permissions.request({ origins: [pattern] }));
  }

  const host = tab?.url ? new URL(tab.url).host : undefined;
  const { report, sources, order, activeId } = detection;
  const active = activeId ? sources[activeId] : undefined;

  return (
    <main className="panel">
      <h1>Smart Web Extractor</h1>

      <section className="card" aria-labelledby="page-title">
        <h2 id="page-title">Page courante</h2>
        {tab?.url ? (
          <p>
            <strong dir="auto">{tab.title || 'Sans titre'}</strong>
            <br />
            <span className="muted">{host || tab.url}</span>
          </p>
        ) : (
          <p className="muted">
            Adresse inconnue : l’extension n’a pas encore accès à cet onglet. Cliquez sur l’icône de l’extension
            depuis la page pour lui donner un accès ponctuel.
          </p>
        )}
        {host && (
          <p className="muted small">
            Accès durable à ce domaine : <strong>{granted ? 'accordé' : 'non accordé'}</strong>
            {!granted && (
              <>
                {' '}
                <button type="button" className="link" onClick={() => void grantDomain()}>
                  Autoriser ce domaine
                </button>
              </>
            )}
          </p>
        )}
        <div className="row">
          <button type="button" onClick={() => void detection.analyze()} disabled={!tab || detection.loading || detection.picking}>
            {detection.loading ? 'Analyse…' : report ? 'Réanalyser la page' : 'Analyser la page'}
          </button>
          {detection.picking ? (
            <button type="button" className="secondary" onClick={() => void detection.cancelPick()}>
              Annuler la sélection
            </button>
          ) : (
            <button type="button" className="secondary" onClick={() => void detection.pick()} disabled={!tab || detection.loading}>
              Choisir dans la page
            </button>
          )}
        </div>
        <div aria-live="polite">
          {detection.picking && <p className="muted small">Cliquez sur un élément de la page (Échap pour annuler).</p>}
          {detection.notice && <p className="alert ok small">{detection.notice}</p>}
          {detection.error && (
            <p className="alert err" role="alert">
              {detection.error.message}
            </p>
          )}
        </div>
      </section>

      {report && (
        <section aria-labelledby="sources-title">
          <h2 id="sources-title">
            {order.length === 0 ? 'Aucune donnée détectée' : `${order.length} source(s) de données`}
          </h2>
          <Warnings items={report.warnings} />
          {order.length > 0 && (
            <div className="source-tabs" role="group" aria-label="Sources détectées">
              {order.map((id) => {
                const state = sources[id]!;
                return (
                  <button
                    key={id}
                    type="button"
                    className={`source-tab${id === activeId ? ' active' : ''}`}
                    aria-pressed={id === activeId}
                    onClick={() => detection.setActiveId(id)}
                  >
                    <span dir="auto">{state.source.label}</span>
                    <span className="muted small">{sourceSummary(state)}</span>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      )}

      {active && <SourceDetail state={active} api={detection} />}
      <ExtractionPreview extraction={detection.extraction} />

      <footer className="muted small">
        {status ? versionLabel(status) : 'Connexion au service worker…'}
      </footer>
    </main>
  );
}
