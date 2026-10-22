import { describe, expect, it } from 'vitest';
import { classifyInjectionError } from '../../src/background/tab-access';

describe('classifyInjectionError', () => {
  it.each([
    ['No tab with id: 42.', 'TAB_NOT_FOUND'],
    ['Cannot access a chrome:// URL', 'RESTRICTED_PAGE'],
    ['The extensions gallery cannot be scripted.', 'RESTRICTED_PAGE'],
    ['Cannot access contents of url "https://site.example/". Extension manifest must request permission to access this host.', 'NO_SITE_ACCESS'],
    ['Missing host permission for the tab', 'NO_SITE_ACCESS'],
  ])('« %s » → %s', (message, code) => {
    expect(classifyInjectionError(message)).toMatchObject({ ok: false, error: { code } });
  });
});
