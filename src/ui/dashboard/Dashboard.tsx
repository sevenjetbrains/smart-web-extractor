import { useEffect, useState } from 'react';
import type { StatusInfo } from '../../shared/messages';
import { sendToBackground } from '../lib/messaging';

const UPCOMING = [
  { title: 'Scénarios', detail: 'Création, révisions, import et export — phase 3.' },
  { title: 'Exécutions et résultats', detail: 'Tableau de résultats, corrections, relances — phases 5 et 6.' },
  { title: 'Exports', detail: 'XLSX et CSV — phase 6.' },
  { title: 'Paramètres et données', detail: 'Durée de conservation, purge, accès aux domaines — phase 3.' },
];

export function Dashboard() {
  const [status, setStatus] = useState<StatusInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void sendToBackground({ type: 'GET_STATUS' }).then((r) =>
      r.ok ? setStatus(r.data) : setError(r.error.message),
    );
  }, []);

  return (
    <main style={{ maxWidth: 880, margin: '0 auto', padding: '1.5rem 1rem' }}>
      <h1>Smart Web Extractor — Tableau de bord</h1>
      <p className="muted" aria-live="polite">
        {status && `Version ${status.version} — phase ${status.phase} (fondations). Service worker opérationnel.`}
        {error}
      </p>
      <h2>Fonctionnalités à venir</h2>
      {UPCOMING.map((item) => (
        <section className="card" key={item.title}>
          <strong>{item.title}</strong>
          <p className="muted">{item.detail}</p>
        </section>
      ))}
    </main>
  );
}
