/**
 * Attente de stabilisation d'une page dynamique (cahier §3.1, §3.3) : la page est
 * considérée stable quand le DOM n'a pas changé pendant `quietMs` et qu'aucun
 * indicateur de chargement n'est visible, dans la limite de `timeoutMs`.
 */
import { isSkipped } from './dom-utils';

const BUSY_SELECTOR = '[aria-busy="true"], .loading, .loader, .spinner';

export function hasBusyIndicator(doc: Document): boolean {
  return Array.from(doc.querySelectorAll(BUSY_SELECTOR)).some((el) => {
    for (let current: Element | null = el; current; current = current.parentElement) {
      if (isSkipped(current)) return false;
    }
    return true;
  });
}

export interface StabilityResult {
  stable: boolean;
  waitedMs: number;
}

export function waitForStable(
  doc: Document,
  { quietMs = 400, timeoutMs = 5000, pollMs = 100 }: { quietMs?: number; timeoutMs?: number; pollMs?: number } = {},
): Promise<StabilityResult> {
  const view = doc.defaultView;
  if (!view) return Promise.resolve({ stable: true, waitedMs: 0 });
  const start = Date.now();
  let lastChange = start;

  return new Promise((resolve) => {
    const observer = new view.MutationObserver(() => {
      lastChange = Date.now();
    });
    observer.observe(doc.documentElement, { childList: true, subtree: true, characterData: true });

    const check = () => {
      const now = Date.now();
      if (now - lastChange >= quietMs && !hasBusyIndicator(doc)) {
        observer.disconnect();
        resolve({ stable: true, waitedMs: now - start });
      } else if (now - start >= timeoutMs) {
        observer.disconnect();
        resolve({ stable: false, waitedMs: now - start });
      } else {
        view.setTimeout(check, pollMs);
      }
    };
    // Une page déjà calme n'attend pas `quietMs` si rien n'est en cours de chargement.
    if (!hasBusyIndicator(doc)) lastChange = start - quietMs;
    check();
  });
}
