// @vitest-environment jsdom
//
// Auth facade over the account registry: sign-in per server with
// "Lembrar neste aparelho", invite flows, server probing (SPEC-LIVROS
// §5 "Adicionar servidor"). Real api/accounts/books code; only the
// network is stubbed.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { auth } from './auth.svelte.ts';
import { accounts } from './accounts.svelte.ts';
import { books } from './books.svelte.ts';

const S = 'https://lumi.work.com';
type Handler = (init: RequestInit, url: string) => Response | Promise<Response>;
let routes: Record<string, Handler>;
const seen: Array<{ url: string; headers: Record<string, string> }> = [];

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(async () => {
  for (const a of [...accounts.list]) await accounts.forget(a.key);
  books.clear();
  sessionStorage.clear();
  localStorage.clear();
  auth.lastError = null;
  seen.length = 0;
  routes = {};
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    seen.push({ url, headers: { ...(init.headers as Record<string, string>) } });
    const key = `${init.method ?? 'GET'} ${url}`;
    const h = routes[key];
    if (!h) return json(404, { error: 'not_found' });
    return h(init, url);
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('signIn', () => {
  it('adds a tab-only account by default and binds its books', async () => {
    routes[`POST ${S}/api/auth/login`] = () =>
      json(200, { token: 'tk-1', expires_at: '2026-12-31T00:00:00Z', user: { id: 'u1', username: 'ana', display_name: 'Ana' } });
    routes[`GET ${S}/api/vaults`] = () =>
      json(200, { vaults: [{ id: 'v1', slug: 'w', name: 'Work', created_by: 'u1', created_at: '', owner_user_id: 'u1' }] });

    const key = await auth.signIn({ serverUrl: 'lumi.work.com/', username: 'ana', password: 'pw', remember: false });
    expect(key).toBe(`${S}#ana`);
    expect(accounts.get(key)?.remember).toBe(false);
    expect(books.list.map((b) => [b.name, b.server_url, b.account])).toEqual([['Work', S, 'ana']]);
    expect(books.active?.vault_id).toBe('v1');
    expect(auth.user?.username).toBe('ana');
    expect(books.banners.map((b) => b.text)).toContain('1 livro adicionado de lumi.work.com');
    // Never in localStorage, never in plaintext anywhere.
    expect(JSON.stringify({ ...localStorage })).not.toContain('tk-1');
    expect(sessionStorage.getItem('lumi.tab.accounts.v1') ?? '').not.toContain('tk-1');
  });

  it('wrong password → readable error, no account', async () => {
    routes[`POST ${S}/api/auth/login`] = () => json(401, { error: 'invalid_credentials' });
    await expect(auth.signIn({ serverUrl: S, username: 'ana', password: 'x', remember: false })).rejects.toBeTruthy();
    expect(auth.lastError).toBe('Usuário ou senha inválidos.');
    expect(accounts.list).toEqual([]);
  });
});

describe('AuthStore.signUpViaInvite', () => {
  it('accept → me with the fresh token → account + book of the joined vault', async () => {
    routes[`POST ${S}/api/invites/inv-token-123/accept`] = () =>
      json(200, { token: 'tk-abc', expires_at: '2026-12-31T00:00:00Z', vault: { id: 'v9', slug: 'demo', name: 'Demo' } });
    routes[`GET ${S}/api/users/me`] = (init) =>
      (init.headers as Record<string, string>)['X-Lumi-Token'] === 'tk-abc'
        ? json(200, { id: 'u9', username: 'invited', display_name: 'Invited' })
        : json(401, { error: 'unauthorized' });
    routes[`GET ${S}/api/vaults`] = () =>
      json(200, { vaults: [{ id: 'v9', slug: 'demo', name: 'Demo', created_by: 'x', created_at: '', owner_user_id: 'x' }] });

    const out = await auth.signUpViaInvite('inv-token-123', {
      serverUrl: S, remember: false, username: 'invited', password: 'pw', display_name: 'Invited',
    });
    expect(out).toEqual({ vaultID: 'v9', accountKey: `${S}#invited` });
    expect(accounts.get(`${S}#invited`)?.user_id).toBe('u9');
    expect(books.bookForVault('v9')?.account).toBe('invited');
    // The accept call itself is anonymous.
    const accept = seen.find((r) => r.url.endsWith('/accept'))!;
    expect(accept.headers['X-Lumi-Token']).toBeUndefined();
  });

  it('maps invite errors to readable messages', async () => {
    routes[`POST ${S}/api/invites/exp/accept`] = () => json(410, { error: 'invite_expired' });
    await expect(
      auth.signUpViaInvite('exp', { serverUrl: S, remember: false, username: 'x', password: 'y', display_name: 'x' }),
    ).rejects.toBeTruthy();
    expect(auth.lastError).toBe('Este convite expirou. Peça um novo.');
  });
});

describe('AuthStore.acceptInvite (existing account)', () => {
  it('uses that account and refreshes its books', async () => {
    await accounts.add(
      { server_url: S, username: 'ana', user_id: 'u1', display_name: 'Ana', added_at: '2026-01-01T00:00:00Z', expires_at: null, remember: false },
      'tk-ana',
    );
    routes[`POST ${S}/api/invites/inv-1/accept`] = (init) =>
      (init.headers as Record<string, string>)['X-Lumi-Token'] === 'tk-ana'
        ? json(200, { vault: { id: 'v2', slug: 's', name: 'Shared' } })
        : json(401, { error: 'unauthorized' });
    routes[`GET ${S}/api/vaults`] = () =>
      json(200, { vaults: [{ id: 'v2', slug: 's', name: 'Shared', created_by: 'x', created_at: '', owner_user_id: 'x' }] });
    const out = await auth.acceptInvite('inv-1', `${S}#ana`);
    expect(out.vaultID).toBe('v2');
    expect(books.bookForVault('v2')).not.toBeNull();
  });
});

describe('probeServer', () => {
  it('normalises the URL and reads /api/info', async () => {
    routes[`GET ${S}/api/info`] = () => json(200, { name: 'Work', version: '1.2', protocol: 1, public_key: 'pk-1' });
    const r = await auth.probeServer('HTTPS://Lumi.Work.com:443/');
    expect(r).toMatchObject({ ok: true, serverUrl: S, info: { name: 'Work' }, duplicateOf: null });
  });

  it('accepts old servers without /api/info', async () => {
    const r = await auth.probeServer(S);
    expect(r).toMatchObject({ ok: true, info: null });
  });

  it('explains CORS failures with the origin to whitelist', async () => {
    routes[`GET ${S}/api/info`] = () => { throw new TypeError('Failed to fetch'); };
    const r = await auth.probeServer(S);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('LUMI_ALLOWED_ORIGINS');
  });

  it('refuses public http servers', async () => {
    const r = await auth.probeServer('http://example.com');
    expect(r.ok).toBe(false);
  });

  it('detects the same server under another URL via public_key', async () => {
    await accounts.add(
      { server_url: S, username: 'ana', user_id: 'u1', display_name: 'Ana', added_at: '2026-01-01T00:00:00Z', expires_at: null, remember: false, public_key: 'pk-1' },
      't',
    );
    routes[`GET https://lumi.tailnet.ts.net/api/info`] = () => json(200, { protocol: 1, public_key: 'pk-1' });
    const r = await auth.probeServer('https://lumi.tailnet.ts.net');
    expect(r).toMatchObject({ ok: true, serverUrl: S, duplicateOf: S });
  });
});
