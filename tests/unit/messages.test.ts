import { describe, expect, it } from 'vitest';
import { BackgroundRequest, ContentPingResponse, ContentRequest } from '../../src/shared/messages';

describe('BackgroundRequest', () => {
  it('accepte les requêtes valides', () => {
    expect(BackgroundRequest.safeParse({ type: 'GET_STATUS' }).success).toBe(true);
    expect(BackgroundRequest.safeParse({ type: 'PING_TAB', tabId: 12 }).success).toBe(true);
  });

  it.each([
    ['type inconnu', { type: 'DELETE_ALL' }],
    ['absence de type', { tabId: 1 }],
    ['propriété en trop', { type: 'GET_STATUS', extra: true }],
    ['tabId non entier', { type: 'PING_TAB', tabId: 1.5 }],
    ['tabId négatif', { type: 'PING_TAB', tabId: -1 }],
    ['tabId texte', { type: 'PING_TAB', tabId: '1' }],
    ['valeur nulle', null],
    ['chaîne', 'GET_STATUS'],
  ])('rejette : %s', (_label, message) => {
    expect(BackgroundRequest.safeParse(message).success).toBe(false);
  });
});

describe('ContentRequest', () => {
  it('accepte CONTENT_PING et rejette le reste', () => {
    expect(ContentRequest.safeParse({ type: 'CONTENT_PING' }).success).toBe(true);
    expect(ContentRequest.safeParse({ type: 'CONTENT_PING', script: 'alert(1)' }).success).toBe(false);
    expect(ContentRequest.safeParse({ type: 'GET_STATUS' }).success).toBe(false);
  });
});

describe('ContentPingResponse', () => {
  const summary = { title: 'Agents', url: 'http://127.0.0.1/', tableCount: 1, formFieldCount: 2, sensitiveFieldCount: 1 };

  it('accepte une réponse conforme', () => {
    expect(ContentPingResponse.safeParse({ ok: true, data: summary }).success).toBe(true);
    expect(
      ContentPingResponse.safeParse({ ok: false, error: { code: 'INVALID_MESSAGE', message: 'x' } }).success,
    ).toBe(true);
  });

  it('rejette une réponse contenant des données inattendues', () => {
    expect(ContentPingResponse.safeParse({ ok: true, data: { ...summary, password: 'secret' } }).success).toBe(false);
    expect(ContentPingResponse.safeParse({ ok: true, data: { ...summary, tableCount: -1 } }).success).toBe(false);
    expect(ContentPingResponse.safeParse({ ok: true, data: { ...summary, title: 'x'.repeat(501) } }).success).toBe(false);
    expect(ContentPingResponse.safeParse({ ok: false, error: { code: 'UNKNOWN', message: 'x' } }).success).toBe(false);
  });
});
