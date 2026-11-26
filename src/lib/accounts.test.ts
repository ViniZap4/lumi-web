// Account registry (SPEC-LIVROS §2.2, §2.5; W1): legacy migration,
// token storage per "Lembrar neste aparelho", per-account 401
// isolation.

import { describe, it, expect, beforeEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { AccountRegistry, TAB_ACCOUNTS_KEY, LEGACY_SESSION_KEY, type AccountMeta } from './accounts.svelte.ts';
import { IndexedDBStore, MemoryStore, getDeviceKey } from './storage.ts';
import { ApiError } from './types.ts';

class MemStorage implements Storage {
  m = new Map<string, string>();
  get length() { return this.m.size; }
  clear() { this.m.clear(); }
  getItem(k: string) { return this.m.get(k) ?? null; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  removeItem(k: string) { this.m.delete(k); }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
}

const meta = (server_url: string, username: string, remember: boolean): AccountMeta => ({
  server_url, username, user_id: `u-${username}`, display_name: username,
  added_at: '2026-11-22T10:00:00.000Z', expires_at: null, remember,
});

function dumpAll(durable: MemoryStore, tab: MemStorage, local: MemStorage): string {
  return JSON.stringify([(durable as any).data && [...(durable as any).data.values()].map((m: Map<string, unknown>) => [...m.entries()]), [...tab.m], [...local.m]]);
}

let durable: MemoryStore;
let tab: MemStorage;
let local: MemStorage;
const mk = (extra: Partial<ConstructorParameters<typeof AccountRegistry>[0]> = {}) =>
  new AccountRegistry({ durable, tab, legacy: local, ...extra });

beforeEach(() => {
  durable = new MemoryStore();
  tab = new MemStorage();
  local = new MemStorage();
});

describe('legacy lumi.v2.session (§2.5, no longer migrated)', () => {
  it('deletes the fixed-key blob unread and creates no account', async () => {
    local.setItem(LEGACY_SESSION_KEY, '{"iv":"AAAA","ct":"BBBB"}');
    const reg = mk();
    await reg.init();
    expect(reg.list).toEqual([]);
    expect(local.getItem(LEGACY_SESSION_KEY)).toBeNull();
  });

  it('a device without the blob boots normally', async () => {
    const reg = mk();
    await reg.init();
    expect(reg.ready).toBe(true);
    expect(local.getItem(LEGACY_SESSION_KEY)).toBeNull();
  });
});

describe('token storage', () => {
  it('"Lembrar neste aparelho" off: tab-only (sessionStorage, sealed), nothing durable', async () => {
    const reg = mk();
    await reg.init();
    await reg.add(meta('https://a.example', 'ana', false), 'tab-secret');
    expect(await durable.getAll('accounts')).toEqual([]);
    expect(tab.getItem(TAB_ACCOUNTS_KEY)).not.toBeNull();
    expect(dumpAll(durable, tab, local)).not.toContain('tab-secret');
    // Reload within the tab keeps it…
    const again = mk();
    await again.init();
    expect(again.tokenFor('https://a.example#ana')).toBe('tab-secret');
    // …closing the tab (new sessionStorage) loses it.
    const newTab = mk({ tab: new MemStorage() });
    await newTab.init();
    expect(newTab.list).toEqual([]);
  });

  it('remember on: IndexedDB with a non-extractable device key (real IDB semantics)', async () => {
    const idb = new IndexedDBStore(new IDBFactory());
    const reg = mk({ durable: idb });
    await reg.init();
    await reg.add(meta('https://a.example', 'ana', true), 'durable-secret');
    const rows = await idb.getAll<any>('accounts');
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain('durable-secret');
    const key = await getDeviceKey(idb);
    expect(key.extractable).toBe(false);
    await expect(crypto.subtle.exportKey('raw', key)).rejects.toBeTruthy();
    const again = mk({ durable: idb, tab: new MemStorage() });
    await again.init();
    expect(again.tokenFor('https://a.example#ana')).toBe('durable-secret');
  });

  it('a sealed token cannot be moved onto another account row (AAD = account key)', async () => {
    const reg = mk();
    await reg.init();
    await reg.add(meta('https://a.example', 'ana', true), 'ana-token');
    const row: any = await durable.get('accounts', 'https://a.example#ana');
    await durable.put('accounts', 'https://a.example#eve', { ...row, meta: { ...row.meta, username: 'eve' } });
    const again = mk();
    await again.init();
    expect(again.tokenFor('https://a.example#eve')).toBeNull();
    expect(again.get('https://a.example#eve')?.status).toBe('needs_login');
  });

  it('several accounts on the same server are distinct', async () => {
    const reg = mk();
    await reg.init();
    await reg.add(meta('https://a.example', 'ana', true), 't-ana');
    await reg.add(meta('https://a.example', 'bia', false), 't-bia');
    expect(reg.list.map((a) => a.key)).toEqual(['https://a.example#ana', 'https://a.example#bia']);
    expect(reg.tokenFor('https://a.example#bia')).toBe('t-bia');
  });

  it('signOut forgets token and metadata locally even if the server is unreachable', async () => {
    const reg = mk({ fetch: (async () => { throw new TypeError('offline'); }) as typeof fetch });
    await reg.init();
    await reg.add(meta('https://a.example', 'ana', true), 't');
    await reg.signOut('https://a.example#ana');
    expect(reg.list).toEqual([]);
    expect(await durable.getAll('accounts')).toEqual([]);
  });
});

describe('account isolation (REST)', () => {
  it('a 401 on account A marks only A "needs login"; B keeps working', async () => {
    const calls: Array<{ url: string; token: string | null }> = [];
    const fetchFn = (async (url: string, init: RequestInit) => {
      const token = (init.headers as Record<string, string>)['X-Lumi-Token'] ?? null;
      calls.push({ url, token });
      const status = url.startsWith('https://a.example') ? 401 : 200;
      return new Response(JSON.stringify(status === 401 ? { error: 'unauthorized' } : { vaults: [] }), {
        status, headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;
    const reg = mk({ fetch: fetchFn });
    await reg.init();
    await reg.add(meta('https://a.example', 'ana', false), 'tok-A');
    await reg.add(meta('https://b.example', 'bia', false), 'tok-B');

    await expect(reg.client('https://a.example#ana').listVaults()).rejects.toBeInstanceOf(ApiError);
    await expect(reg.client('https://b.example#bia').listVaults()).resolves.toEqual([]);

    expect(reg.get('https://a.example#ana')?.status).toBe('needs_login');
    expect(reg.tokenFor('https://a.example#ana')).toBeNull();
    expect(reg.get('https://b.example#bia')?.status).toBe('ok');
    // Each request carried its own account's token to its own server.
    expect(calls).toEqual([
      { url: 'https://a.example/api/vaults', token: 'tok-A' },
      { url: 'https://b.example/api/vaults', token: 'tok-B' },
    ]);
  });

  it('a late 401 for a token already rotated by re-login does not drop the fresh session', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const fetchFn = (async () => {
      await gate;
      return new Response('{"error":"unauthorized"}', { status: 401, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    const reg = mk({ fetch: fetchFn });
    await reg.init();
    await reg.add(meta('https://a.example', 'ana', false), 'old');
    const p = reg.client('https://a.example#ana').listVaults();
    await reg.add(meta('https://a.example', 'ana', false), 'new');
    release();
    await expect(p).rejects.toBeInstanceOf(ApiError);
    expect(reg.get('https://a.example#ana')?.status).toBe('ok');
    expect(reg.tokenFor('https://a.example#ana')).toBe('new');
  });

  it('a 401 on an anonymous call (wrong password) is a form error, not session loss', async () => {
    const fetchFn = (async () =>
      new Response('{"error":"invalid_credentials"}', { status: 401, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;
    const reg = mk({ fetch: fetchFn });
    await reg.init();
    await reg.add(meta('https://a.example', 'ana', false), 't');
    await expect(reg.anonymous('https://a.example').login('ana', 'bad')).rejects.toBeInstanceOf(ApiError);
    expect(reg.get('https://a.example#ana')?.status).toBe('ok');
  });
});

