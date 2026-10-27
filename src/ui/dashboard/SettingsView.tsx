import { useCallback, useEffect, useState } from 'react';
import { OPTIONAL_HOST_PERMISSIONS } from '../../manifest';
import { storageErrorMessage } from '../../storage/errors';
import { clearAllData, deleteScenarioData, purgeExpiredRuns, storageUsage, type StorageUsage } from '../../storage/purge';
import { getSettings, updateSettings } from '../../storage/settings';
import { ConfirmButton } from '../components/ConfirmButton';
import { formatBytes } from '../lib/format';
import { useScenarios } from '../lib/useScenarios';

type Message = { kind: 'ok' | 'err'; text: string };

/**
 * Paramètres et données (cahier §6.2) : durée de conservation, espace utilisé,
 * accès aux domaines, suppression des résultats d'un scénario ou de toutes les
 * données.
 */
export function SettingsView() {
  const { scenarios } = useScenarios();
  const [retention, setRetention] = useState<number | null>(null);
  const [usage, setUsage] = useState<StorageUsage | null>(null);
  const [origins, setOrigins] = useState<string[]>([]);
  const [scenarioId, setScenarioId] = useState('');
  const [message, setMessage] = useState<Message | null>(null);

  const refresh = useCallback(async () => {
    setRetention((await getSettings()).retentionDays);
    setUsage(await storageUsage());
    const granted = (await chrome.permissions.getAll()).origins ?? [];
    // Seuls les accès accordés à la demande peuvent être retirés.
    setOrigins(granted.filter((o) => !(OPTIONAL_HOST_PERMISSIONS as readonly string[]).includes(o)));
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function act(action: () => Promise<string>) {
    setMessage(null);
    try {
      setMessage({ kind: 'ok', text: await action() });
    } catch (e) {
      setMessage({ kind: 'err', text: storageErrorMessage(e) });
    }
    await refresh();
  }

  return (
    <section aria-labelledby="settings-heading">
      <h2 id="settings-heading">Paramètres et données</h2>
      <div aria-live="polite">
        {message && (
          <p className={`alert ${message.kind}`} role={message.kind === 'err' ? 'alert' : 'status'}>
            {message.text}
          </p>
        )}
      </div>

      <form
        className="card"
        aria-labelledby="retention-title"
        onSubmit={(e) => {
          e.preventDefault();
          if (retention === null) return;
          void act(async () => {
            const { retentionDays } = await updateSettings({ retentionDays: retention });
            const purged = await purgeExpiredRuns(retentionDays);
            return `Durée de conservation : ${retentionDays} jour(s).${purged > 0 ? ` ${purged} exécution(s) plus ancienne(s) supprimée(s).` : ''}`;
          });
        }}
      >
        <h3 id="retention-title">Durée de conservation</h3>
        <p className="muted small">
          Les exécutions terminées et leurs résultats sont supprimés automatiquement après cette durée. Un avertissement
          s’affiche dans le tableau de bord 7 jours avant.
        </p>
        <div className="row">
          <label>
            Nombre de jours{' '}
            <input
              type="number"
              min={1}
              max={3650}
              step={1}
              required
              value={retention ?? ''}
              onChange={(e) => setRetention(Number(e.target.value))}
            />
          </label>
          <button type="submit">Enregistrer</button>
        </div>
      </form>

      <section className="card" aria-labelledby="usage-title">
        <h3 id="usage-title">Espace utilisé</h3>
        {usage && (
          <dl>
            <dt>Scénarios et préférences</dt>
            <dd>
              {formatBytes(usage.settingsBytes)} sur {formatBytes(usage.settingsQuota)}
            </dd>
            <dt>Total (résultats compris)</dt>
            <dd>
              {usage.totalBytes === null
                ? 'Inconnu'
                : `${formatBytes(usage.totalBytes)}${usage.totalQuota ? ` sur ${formatBytes(usage.totalQuota)} disponibles` : ''}`}
            </dd>
          </dl>
        )}
        <p className="muted small">
          Les données sont protégées par votre profil Chrome et votre session, mais ne sont pas chiffrées par l’extension.
        </p>
      </section>

      <section className="card" aria-labelledby="access-title">
        <h3 id="access-title">Accès aux domaines</h3>
        {origins.length === 0 ? (
          <p className="muted small">Aucun accès durable accordé.</p>
        ) : (
          <ul className="plain">
            {origins.map((origin) => (
              <li key={origin} className="row between">
                <code>{origin}</code>
                <button
                  type="button"
                  className="secondary"
                  onClick={() =>
                    void act(async () =>
                      (await chrome.permissions.remove({ origins: [origin] }))
                        ? `Accès retiré : ${origin}.`
                        : `Cet accès ne peut pas être retiré ici : ${origin}.`,
                    )
                  }
                >
                  Retirer l’accès
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card" aria-labelledby="delete-title">
        <h3 id="delete-title">Supprimer des données</h3>
        <div className="row">
          <label>
            Résultats du scénario{' '}
            <select value={scenarioId} onChange={(e) => setScenarioId(e.target.value)}>
              <option value="">Choisir…</option>
              {scenarios?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <ConfirmButton
            label="Supprimer ses résultats"
            confirmLabel="Supprimer les résultats"
            question="Supprimer toutes les exécutions de ce scénario ? Le scénario est conservé."
            disabled={!scenarioId}
            onConfirm={() =>
              act(async () => `${await deleteScenarioData(scenarioId)} exécution(s) supprimée(s). Le scénario est conservé.`)
            }
          />
        </div>
        <div className="row danger-zone">
          <ConfirmButton
            label="Supprimer toutes les données"
            confirmLabel="Tout supprimer définitivement"
            question="Supprimer tous les scénarios, résultats, journaux et préférences ?"
            onConfirm={() =>
              act(async () => {
                await clearAllData();
                return 'Toutes les données de l’extension ont été supprimées.';
              })
            }
          />
        </div>
      </section>
    </section>
  );
}
