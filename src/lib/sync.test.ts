// Sync coordinator: account isolation, catch-up, degradation
// (SPEC-LIVROS §2.4.4, §3.3, §3.5, §4). Real FeedConnection + ApiClient
// against two in-process fake servers.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AccountRegistry } from './accounts.svelte.ts';
import { BooksStore } from './books.svelte.ts';
import { SyncCoordinator } from './sync.svelte.ts';
import { FeedConnection } from './feed.ts';
import { MemoryStore } from './storage.ts';
import { FakeFeedServer, ManualTimers, flush, json } from '../test/fake-feed-server.ts';
import type { NoteSummary } from './types.ts';

const A = 'https://a.example';
const B = 'https://b.example';
const vault = (id: string, name: string, extra: Record<string, unknown> = {}) =>
  ({ id, name, slug: name, created_by: 'x', created_at: '', owner_user_id: 'x', ...extra });
const note = (id: string, seq = 0): NoteSummary & { change_seq: number } =>
  ({ id, vault_id: 'va', path: `${id}.md`, title: id, created_at: '', updated_at: '', change_seq: seq });

let sa: FakeFeedServer;
let sb: FakeFeedServer;
let timers: ManualTimers;
let accounts: AccountRegistry;
let books: BooksStore;
let sync: SyncCoordinator;
let notesState: { vaultID: string | null; list: NoteSummary[]; refreshes: number };

function router(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = String(input);
  if (url.startsWith(A)) return sa.fetch(url, init);
  if (url.startsWith(B)) return sb.fetch(url, init);
  return Promise.reject(new TypeError('Failed to fetch'));
}

const meta = (server_url: string, username: string, added_at: string) => ({
  server_url, username, user_id: `u-${username}`, display_name: username, added_at, expires_at: null, remember: false,
});

beforeEach(async () => {
  sa = new FakeFeedServer(A);
  sb = new FakeFeedServer(B);
  sa.tokens = new Set(['tok-A']);
  sb.tokens = new Set(['tok-B']);
  // A: "va" (own) + "fed" (follower copy). B: "vb" + "fed" (home).
  sa.routes.set('GET /api/vaults', () => json(200, { vaults: [vault('va', 'A-book', { head: 3 }), vault('fed', 'Fed', { federation: { role: 'follower' } })] }));
  sb.routes.set('GET /api/vaults', () => json(200, { vaults: [vault('vb', 'B-book'), vault('fed', 'Fed', { federation: { role: 'home' } })] }));
  timers = new ManualTimers();
  const tab = null;
  accounts = new AccountRegistry({ durable: new MemoryStore(), tab, legacy: null, fetch: router as typeof fetch });
  await accounts.init();
  await accounts.add(meta(A, 'ana', '2026-01-01T00:00:00Z'), 'tok-A');
  await accounts.add(meta(B, 'bia', '2026-02-01T00:00:00Z'), 'tok-B');
  books = new BooksStore({ accounts, durable: new MemoryStore(), tab: null, local: null });
  await books.init();
  await books.refreshAll();
  notesState = { vaultID: null, list: [], refreshes: 0 };
  const notes = {
    get vaultID() { return notesState.vaultID; },
    async refresh() { notesState.refreshes++; },
    applyChanges(vaultID: string, changed: NoteSummary[], deleted: Array<{ id: string }>) {
      if (vaultID !== notesState.vaultID) return false;
      const gone = new Set(deleted.map((d) => d.id));
      const m = new Map(notesState.list.map((n) => [n.id, n]));
      for (const n of changed) m.set(n.id, n);
      for (const id of gone) m.delete(id);
      notesState.list = [...m.values()];
      return true;
    },
  };
  sync = new SyncCoordinator({
    accounts, books, notes, headless: true,
    feedFactory: (o) => new FeedConnection({ ...o, fetch: router as typeof fetch, timers, random: () => 0.5 }),
  });
  sync.start();
  await flush();
});

afterEach(() => sync.stop());

const HELLO_A = { protocol: 1, vaults: [{ vault_id: 'va', seq: 3, can_edit: true }, { vault_id: 'fed', seq: 99, can_edit: true }] };
const HELLO_B = { protocol: 1, vaults: [{ vault_id: 'vb', seq: 1, can_edit: true }, { vault_id: 'fed', seq: 7, can_edit: false }] };
const bookOf = (vid: string) => books.bookForVault(vid)!;

describe('setup sanity: dedupe binds the federated book to its home (B)', () => {
  it('fed → B, alternate A', () => {
    expect(bookOf('fed').server_url).toBe(B);
    expect(books.alternates['fed']).toEqual([{ server_url: A, account: 'ana', federation_role: 'follower' }]);
  });
});

describe('account isolation', () => {
  it("each feed carries only its own account's token, to its own server", () => {
    const evA = sa.requests.filter((r) => r.url.endsWith('/api/events'));
    const evB = sb.requests.filter((r) => r.url.endsWith('/api/events'));
    expect(evA.map((r) => r.headers['authorization'])).toEqual(['Bearer tok-A']);
    expect(evB.map((r) => r.headers['authorization'])).toEqual(['Bearer tok-B']);
    expect([...sa.requests, ...sb.requests].every((r) => !r.url.includes('token'))).toBe(true);
  });

  it("A's events never touch B's books (including the federated book bound to B)", async () => {
    sa.last.send('hello', HELLO_A);
    sb.last.send('hello', HELLO_B);
    await flush();
    // A says "fed" is at 99 and editable; B (bound) says 7 / read-only.
    expect(sync.catchUp[bookOf('fed').id]?.head).toBe(7);
    expect(books.canEdit['fed']).toBe(false);

    sa.last.send('vault.head', { vault_id: 'fed', seq: 500 });
    sa.last.send('vault.revoked', { vault_id: 'fed', reason: 'removed' });
    sa.last.send('vault.revoked', { vault_id: 'vb', reason: 'removed' });
    await flush();
    expect(sync.catchUp[bookOf('fed').id]?.head).toBe(7);
    expect(books.revoked).toEqual({});
    expect(sync.statusOf(bookOf('fed')).state).toBe('read_only');
  });

  it('session.ended on A → A "Precisa entrar"; B stays up to date and its feed stays open', async () => {
    sa.last.send('hello', HELLO_A);
    sb.last.send('hello', HELLO_B);
    await flush();
    sa.last.send('session.ended', { reason: 'revoked' });
    await flush();
    expect(accounts.get(`${A}#ana`)?.status).toBe('needs_login');
    expect(sync.statusOf(bookOf('va')).state).toBe('needs_login');
    expect(sync.statusOf(bookOf('vb')).state).toBe('up_to_date');
    expect(sync.feeds[`${B}#bia`].state).toBe('open');
    expect(accounts.tokenFor(`${B}#bia`)).toBe('tok-B');
  });

  it('REST health is per account', async () => {
    sb.last.send('hello', HELLO_B);
    await flush();
    sa.routes.set('GET /api/vaults', () => json(500, { error: 'boom' }));
    for (let i = 0; i < 3; i++) await books.refreshAccount(`${A}#ana`);
    expect(sync.health[`${A}#ana`].nonTransientFailures).toBe(3);
    expect(sync.statusOf(bookOf('va')).state).toBe('error');
    expect(sync.statusOf(bookOf('vb')).state).toBe('up_to_date');
  });
});

describe('reconcile on hello + catch-up', () => {
  it('a bound book missing from hello is revoked; unknown vaults become books', async () => {
    sa.routes.set('GET /api/vaults', () => json(200, { vaults: [vault('new1', 'Novo')] }));
    sa.last.send('hello', { protocol: 1, vaults: [{ vault_id: 'new1', seq: 1 }] });
    await flush();
    expect(books.revoked[bookOf('va').id]).toBe('removed');
    expect(sync.statusOf(bookOf('va')).state).toBe('error');
    expect(bookOf('new1').account).toBe('ana');
  });

  it('open book: head > cursor → GET /changes pages until head, applied to the list', async () => {
    notesState.vaultID = 'va';
    sync.onBookOpened(bookOf('va'));
    let calls: number[] = [];
    sa.changes.set('va', (after) => {
      calls.push(after);
      if (after === 0) return json(200, { notes: [note('n1', 1), note('n2', 2)], deleted: [], head: 5, more: true });
      return json(200, { notes: [note('n3', 4)], deleted: [{ id: 'n1', seq: 5 }], head: 5, more: false });
    });
    sa.last.send('hello', { protocol: 1, vaults: [{ vault_id: 'va', seq: 5 }, { vault_id: 'fed', seq: 1 }] });
    sb.last.send('hello', HELLO_B);
    await flush();
    expect(calls).toEqual([0, 2]);
    expect(notesState.list.map((n) => n.id).sort()).toEqual(['n2', 'n3']);
    expect(sync.catchUp[bookOf('va').id]).toMatchObject({ cursor: 5, head: 5, state: 'idle' });
    expect(sync.statusOf(bookOf('va')).state).toBe('up_to_date');

    calls = [];
    sa.changes.set('va', (after) => { calls.push(after); return json(200, { notes: [note('n4', 6)], deleted: [], head: 6, more: false }); });
    sa.last.send('vault.head', { vault_id: 'va', seq: 6 });
    await flush();
    expect(calls).toEqual([5]);
    expect(notesState.list.some((n) => n.id === 'n4')).toBe(true);
  });

  it('410 resync_required → full reload, cursor = head from the 410 body', async () => {
    notesState.vaultID = 'va';
    sa.changes.set('va', () => json(410, { error: 'resync_required', head: 40 }));
    sa.last.send('hello', { protocol: 1, vaults: [{ vault_id: 'va', seq: 42 }, { vault_id: 'fed', seq: 1 }] });
    await flush();
    expect(notesState.refreshes).toBeGreaterThanOrEqual(1);
    // cursor 40 < head 42 → another round (now 410 again) → eventually cursor follows.
    expect(sync.catchUp[bookOf('va').id].cursor).toBeGreaterThanOrEqual(40);
  });

  it('server without /changes (404) → falls back to a full list reload', async () => {
    notesState.vaultID = 'va';
    sa.last.send('hello', { protocol: 1, vaults: [{ vault_id: 'va', seq: 9 }, { vault_id: 'fed', seq: 1 }] });
    await flush();
    expect(notesState.refreshes).toBe(1);
    expect(sync.catchUp[bookOf('va').id]).toMatchObject({ cursor: 9, head: 9 });
  });

  it('non-open books just follow the head (no list cache to update)', async () => {
    sa.last.send('hello', HELLO_A);
    await flush();
    expect(sync.catchUp[bookOf('va').id]).toMatchObject({ cursor: 3, head: 3 });
    expect(sa.requests.some((r) => r.url.includes('/changes'))).toBe(false);
  });
});

describe('degradation without the feed endpoint', () => {
  it('server without /api/info → "Offline" with a clear reason, no errors, no hammering', async () => {
    sync.stop();
    sa.infoStatus = 404;
    sync.restartFeed(`${A}#ana`);
    await flush();
    expect(sync.feeds[`${A}#ana`].state).toBe('disabled');
    const st = sync.statusOf(bookOf('va'));
    expect(st).toEqual({ state: 'offline', reason: 'feed indisponível neste servidor' });
    const before = sa.requests.length;
    timers.advance(60_000);
    await flush();
    expect(sa.requests.length).toBe(before);
  });
});
