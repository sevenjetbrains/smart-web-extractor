import { describe, expect, it } from 'vitest';
import { buildManifest } from '../../src/manifest';

describe('manifeste (cahier §4.3)', () => {
  const prod = buildManifest({ version: '1.2.3', e2e: false });

  it('est un manifeste V3', () => {
    expect(prod.manifest_version).toBe(3);
    expect(prod.version).toBe('1.2.3');
    expect(prod.background).toEqual({ service_worker: 'background/service-worker.js', type: 'module' });
  });

  it('ne demande que les permissions indispensables', () => {
    expect([...(prod.permissions ?? [])].sort()).toEqual(['activeTab', 'scripting', 'sidePanel', 'storage']);
  });

  it('ne demande aucune permission interdite', () => {
    const all = [...(prod.permissions ?? []), ...(prod.optional_permissions ?? [])] as string[];
    for (const forbidden of ['cookies', 'webRequest', 'history', 'tabs', 'debugger', '<all_urls>']) {
      expect(all).not.toContain(forbidden);
    }
  });

  it('demande l’accès aux sites à la demande uniquement', () => {
    expect(prod.host_permissions).toBeUndefined();
    expect(prod.optional_host_permissions).toEqual(['https://*/*', 'http://*/*']);
  });

  it('n’expose rien aux pages et ne déclare pas de content script permanent', () => {
    expect(prod.content_scripts).toBeUndefined();
    expect(prod.web_accessible_resources).toBeUndefined();
    expect(prod.externally_connectable).toBeUndefined();
  });

  it('conserve la CSP par défaut de Manifest V3', () => {
    expect(prod.content_security_policy).toBeUndefined();
  });

  it('limite l’accès permanent du build de test à 127.0.0.1', () => {
    const e2e = buildManifest({ version: '1.2.3', e2e: true });
    expect(e2e.host_permissions).toEqual(['http://127.0.0.1/*']);
    expect(e2e.permissions).toEqual(prod.permissions);
  });
});
