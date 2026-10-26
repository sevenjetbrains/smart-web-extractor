import { useState, type ReactNode } from 'react';

/**
 * Bouton d'action destructrice en deux temps : un premier clic affiche la
 * demande de confirmation dans la page (sans boîte de dialogue du navigateur).
 */
export function ConfirmButton({
  label,
  confirmLabel,
  question,
  onConfirm,
  disabled,
}: {
  label: string;
  confirmLabel: string;
  question: ReactNode;
  onConfirm: () => void | Promise<void>;
  disabled?: boolean;
}) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!asking) {
    return (
      <button type="button" className="danger secondary" onClick={() => setAsking(true)} disabled={disabled}>
        {label}
      </button>
    );
  }
  return (
    <span className="confirm" role="group" aria-label="Confirmation">
      <span className="small">{question}</span>
      <button
        type="button"
        className="danger"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await onConfirm();
          } finally {
            setBusy(false);
            setAsking(false);
          }
        }}
      >
        {confirmLabel}
      </button>
      <button type="button" className="secondary" onClick={() => setAsking(false)} disabled={busy}>
        Annuler
      </button>
    </span>
  );
}
