import { describe, expect, it, vi } from 'vitest';
import { createRouter, type Handlers } from '../../src/background/message-router';
import { ok } from '../../src/shared/messages';

const ctx = { extensionId: 'ext-id', extensionOrigin: 'chrome-extension://ext-id/' };
const fromPanel = { id: 'ext-id', url: 'chrome-extension://ext-id/ui/sidepanel/index.html' };
const summary = { title: 't', url: 'u', tableCount: 0, formFieldCount: 0, sensitiveFieldCount: 0 };

function setup() {
  const handlers: Handlers = {
    GET_STATUS: vi.fn(async () => ok({ version: '0.1.0', phase: 1 })),
    PING_TAB: vi.fn(async () => ok(summary)),
    ENSURE_CONTENT: vi.fn(async () => ok({ injected: true as const })),
  };
  return { handlers, route: createRouter(ctx, handlers) };
}

describe('createRouter', () => {
  it('aiguille une requête valide vers son gestionnaire', async () => {
    const { handlers, route } = setup();
    expect(await route({ type: 'GET_STATUS' }, fromPanel)).toEqual({ ok: true, data: { version: '0.1.0', phase: 1 } });
    await route({ type: 'PING_TAB', tabId: 7 }, fromPanel);
    expect(handlers.PING_TAB).toHaveBeenCalledWith({ type: 'PING_TAB', tabId: 7 });
    expect(await route({ type: 'ENSURE_CONTENT', tabId: 3 }, fromPanel)).toEqual({ ok: true, data: { injected: true } });
  });

  it('refuse un message venant d’une autre extension', async () => {
    const { handlers, route } = setup();
    const r = await route({ type: 'GET_STATUS' }, { id: 'other', url: 'chrome-extension://other/x.html' });
    expect(r).toMatchObject({ ok: false, error: { code: 'FORBIDDEN_SENDER' } });
    expect(handlers.GET_STATUS).not.toHaveBeenCalled();
  });

  it('refuse un message de pilotage venant d’un content script (URL du site)', async () => {
    const { handlers, route } = setup();
    const r = await route({ type: 'PING_TAB', tabId: 1 }, { id: 'ext-id', url: 'https://site.example/page' });
    expect(r).toMatchObject({ ok: false, error: { code: 'FORBIDDEN_SENDER' } });
    expect(handlers.PING_TAB).not.toHaveBeenCalled();
  });

  it('refuse un expéditeur sans URL', async () => {
    const { route } = setup();
    expect(await route({ type: 'GET_STATUS' }, { id: 'ext-id' })).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN_SENDER' },
    });
  });

  it('refuse un message mal formé', async () => {
    const { route } = setup();
    expect(await route({ type: 'PING_TAB', tabId: 'x' }, fromPanel)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_MESSAGE' },
    });
  });

  it('convertit une exception du gestionnaire en erreur interne', async () => {
    const { handlers, route } = setup();
    vi.mocked(handlers.GET_STATUS).mockRejectedValueOnce(new Error('boom'));
    expect(await route({ type: 'GET_STATUS' }, fromPanel)).toMatchObject({
      ok: false,
      error: { code: 'INTERNAL_ERROR' },
    });
  });
});
