/**
 * Sélecteur visuel dans la page (cahier §3.1) : surbrillance au survol, clic pour
 * choisir, Échap pour annuler. La surcouche vit dans un Shadow DOM fermé afin de
 * ne pas être affectée par les styles de la page ni lisible par ses scripts.
 * Pendant la sélection, les clics sont interceptés : la page ne réagit pas.
 */
import { OVERLAY_ATTR, tagOf, textOf } from './dom-utils';

const STYLE = `
  .box { position: fixed; pointer-events: none; border: 2px solid #2b6cb0; background: rgba(43,108,176,.12);
         border-radius: 3px; box-sizing: border-box; display: none; transition: all 60ms linear; }
  .tip { position: fixed; pointer-events: none; display: none; max-width: 320px; padding: 2px 6px;
         font: 12px/1.4 system-ui, sans-serif; color: #fff; background: #17365d; border-radius: 3px;
         white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .banner { position: fixed; top: 8px; left: 50%; transform: translateX(-50%); pointer-events: none;
            padding: 6px 12px; font: 13px/1.4 system-ui, sans-serif; color: #fff; background: #17365d;
            border-radius: 6px; box-shadow: 0 2px 8px rgba(0,0,0,.3); }
`;

interface Overlay {
  show(el: Element, tip?: string): void;
  destroy(): void;
}

function createOverlay(doc: Document, banner?: string): Overlay {
  const host = doc.createElement('div');
  host.setAttribute(OVERLAY_ATTR, '');
  host.style.cssText = 'all: initial; position: fixed; top: 0; left: 0; width: 0; height: 0; z-index: 2147483647; pointer-events: none;';
  const shadow = host.attachShadow({ mode: 'closed' });
  const style = doc.createElement('style');
  style.textContent = STYLE;
  const box = doc.createElement('div');
  box.className = 'box';
  const tip = doc.createElement('div');
  tip.className = 'tip';
  shadow.append(style, box, tip);
  if (banner) {
    const bannerEl = doc.createElement('div');
    bannerEl.className = 'banner';
    bannerEl.setAttribute('role', 'status');
    bannerEl.textContent = banner;
    shadow.append(bannerEl);
  }
  doc.documentElement.append(host);

  return {
    show(el, tipText) {
      const rect = el.getBoundingClientRect();
      Object.assign(box.style, {
        display: 'block',
        left: `${rect.left}px`,
        top: `${rect.top}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
      });
      if (tipText) {
        tip.textContent = tipText;
        Object.assign(tip.style, {
          display: 'block',
          left: `${Math.max(0, rect.left)}px`,
          top: `${rect.top > 24 ? rect.top - 22 : rect.bottom + 2}px`,
        });
      }
    },
    destroy() {
      host.remove();
    },
  };
}

function describe(el: Element): string {
  const text = textOf(el);
  return `${tagOf(el)}${text ? ` — ${text.length > 50 ? `${text.slice(0, 47)}…` : text}` : ''}`;
}

let activeCancel: (() => void) | null = null;

export function isPicking(): boolean {
  return activeCancel !== null;
}

export function cancelPick(): void {
  activeCancel?.();
}

export function pickElement(doc: Document): Promise<Element | null> {
  const view = doc.defaultView!;
  return new Promise((resolve) => {
    const overlay = createOverlay(doc, 'Cliquez sur l’élément à extraire — Échap pour annuler');
    let current: Element | null = null;

    const targetOf = (event: Event): Element | null => {
      const target = event.composedPath()[0];
      return target && (target as Node).nodeType === 1 ? (target as Element) : null;
    };
    const block = (event: Event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const onMove = (event: Event) => {
      const target = targetOf(event);
      if (target && target !== current) {
        current = target;
        overlay.show(target, describe(target));
      }
    };
    const onScroll = () => current && overlay.show(current, describe(current));
    const onClick = (event: Event) => {
      block(event);
      finish(targetOf(event));
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        block(event);
        finish(null);
      }
    };
    const blocked = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'dblclick', 'auxclick', 'contextmenu', 'submit'];

    function finish(el: Element | null) {
      view.removeEventListener('pointermove', onMove, true);
      view.removeEventListener('scroll', onScroll, true);
      view.removeEventListener('click', onClick, true);
      view.removeEventListener('keydown', onKey, true);
      for (const type of blocked) view.removeEventListener(type, block, true);
      overlay.destroy();
      activeCancel = null;
      resolve(el);
    }

    view.addEventListener('pointermove', onMove, true);
    view.addEventListener('scroll', onScroll, true);
    view.addEventListener('click', onClick, true);
    view.addEventListener('keydown', onKey, true);
    for (const type of blocked) view.addEventListener(type, block, true);
    activeCancel = () => finish(null);
  });
}

/** Met un élément en évidence pendant deux secondes, après l'avoir fait défiler à l'écran. */
export function flashElement(doc: Document, el: Element): void {
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  const overlay = createOverlay(doc);
  const view = doc.defaultView!;
  const end = Date.now() + 2000;
  const frame = () => {
    if (Date.now() > end) {
      overlay.destroy();
      return;
    }
    overlay.show(el);
    view.requestAnimationFrame(frame);
  };
  frame();
}
