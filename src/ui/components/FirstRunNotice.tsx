import { useEffect, useState } from 'react';
import { getSettings, updateSettings } from '../../storage/settings';

/**
 * Avertissement du premier lancement (cahier §6.2) : l'utilisateur est
 * responsable de la licéité de l'extraction et du traitement des données.
 * Il reste affiché tant qu'il n'a pas été accepté.
 */
export function FirstRunNotice() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    void getSettings().then((s) => setVisible(s.warningAcknowledgedAt === null));
  }, []);

  if (!visible) return null;
  return (
    <section className="card notice" aria-labelledby="first-run-title">
      <h2 id="first-run-title">Avant de commencer</h2>
      <p>
        N’extrayez que des données de sites auxquels vous avez légitimement accès, dans le respect de leurs conditions
        d’utilisation. Vous êtes responsable de la licéité de l’extraction et du traitement des données, notamment des
        données personnelles (RGPD ou loi nationale applicable).
      </p>
      <p className="muted small">
        Tout reste sur cet ordinateur : rien n’est envoyé à un serveur. Les résultats sont supprimés automatiquement
        après la durée de conservation choisie dans les paramètres (30 jours par défaut).
      </p>
      <button
        type="button"
        onClick={() => void updateSettings({ warningAcknowledgedAt: new Date().toISOString() }).then(() => setVisible(false))}
      >
        J’ai compris
      </button>
    </section>
  );
}
