// Offline store: scoping, LRU eviction that never drops unsent work,
// LGPD wipes, boot sweep, and the lineage decision table.

import { describe, it, expect, beforeEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import {
  OfflineStore,
  scopeKey,
  replicaID,
  ORPHAN_DIRTY_RETENTION_MS,
  type ReplicaKey,
  type ReplicaRecord,
} from './offline-store.ts';
import { checkLineage } from './lineage.ts';
import { OfflineCoordinator, bundleMarkdown, exportFilename } from './offline.svelte.ts';

const A = 'https://a.example';
const B = 'https://b.example';
const key = (note: string, origin = A, user = 'ua', vault = 'v1'): ReplicaKey => ({ origin, userID: user, vaultID: vault, noteID: note });

let now = 1_000;
let store: OfflineStore;

/** Write a replica with fixed size/dirty, bypassing Yjs. */
async function put(k: ReplicaKey, opts: { bytes?: number; dirty?: boolean; text?: string } = {}): Promise<ReplicaRecord | null> {
  const state = new Uint8Array(opts.bytes ?? 100);
  return store.saveReplica(k, {
    localClients: [1],
    merge: () => ({ state, text: opts.text ?? k.noteID, dirty: opts.dirty ?? false }),
  });
}

beforeEach(() => {
  now = 1_000;
  store = new OfflineStore(new IDBFactory(), { maxBytes: 1_000, maxReplicas: 100, now: () => now });
});

describe('keys', () => {
  it('scopes by server origin AND user id; separators cannot be injected', () => {
    expect(scopeKey(A, 'u1')).not.toBe(scopeKey(B, 'u1'));
    expect(scopeKey(A, 'u1')).not.toBe(scopeKey(A, 'u2'));
    expect(replicaID(key('a|b'))).not.toBe(replicaID({ ...key('b'), vaultID: 'v1|a' }));
  });

  it('accounts never mix: same vault/note under another user is another row', async () => {
    await put(key('n1', A, 'ua'), { text: 'mine' });
    expect(await store.loadReplica(key('n1', A, 'ub'))).toBeNull();
    expect((await store.loadReplica(key('n1', A, 'ua')))!.text).toBe('mine');
  });
});

describe('eviction', () => {
  it('drops clean replicas least-recently-opened first, never dirty or open ones', async () => {
    for (const [i, n] of ['old', 'dirty-old', 'open-old', 'mid', 'new'].entries()) {
      now = 1_000 + i * 10;
      // 5 × 300 bytes (+ text) > 1000 cap
      await put(key(n), { bytes: 300, dirty: n === 'dirty-old' });
    }
    const detach = store.attach(key('open-old'), { kill: () => null });
    const evicted = await store.evict();
    expect(evicted).toEqual([replicaID(key('old')), replicaID(key('mid'))]);
    const left = (await store.listReplicas()).map((r) => r.noteID).sort();
    expect(left).toEqual(['dirty-old', 'new', 'open-old']);
    detach();
  });

  it('keeps dirty replicas even when they alone exceed the cap', async () => {
    await put(key('big1'), { bytes: 900, dirty: true });
    await put(key('big2'), { bytes: 900, dirty: true });
    expect(await store.evict()).toEqual([]);
    expect(await store.listReplicas()).toHaveLength(2);
  });

  it('opening a replica refreshes its LRU position', async () => {
    now = 1;
    await put(key('a'), { bytes: 400 });
    now = 2;
    await put(key('b'), { bytes: 400 });
    now = 3;
    await store.loadReplica(key('a')); // touch
    now = 4;
    await put(key('c'), { bytes: 400 });
    await store.evict();
    expect((await store.listReplicas()).map((r) => r.noteID).sort()).toEqual(['a', 'c']);
  });
});

describe('wipes (LGPD)', () => {
  it('wipeScope removes replicas, caches and conflicts of ONE account and returns unsent text', async () => {
    await put(key('n1'), { dirty: true, text: 'unsent text' });
    await put(key('n2'), { dirty: false });
    await store.putCache(scopeKey(A, 'ua'), 'notes:v1', [{ id: 'n1' }]);
    await store.addConflict({ scope: scopeKey(A, 'ua'), vaultID: 'v1', noteID: 'n3', text: 'conflict', reason: 'lineage' });
    await put(key('n1', B, 'ub'), { dirty: true, text: 'other account' });
    await store.putCache(scopeKey(B, 'ub'), 'notes:v1', [{ id: 'x' }]);

    const rescued = await store.wipeScope(scopeKey(A, 'ua'));
    expect(rescued.map((r) => r.text).sort()).toEqual(['conflict', 'unsent text']);
    expect(await store.listReplicas(scopeKey(A, 'ua'))).toEqual([]);
    expect(await store.getCache(scopeKey(A, 'ua'), 'notes:v1')).toBeNull();
    expect(await store.listConflicts(scopeKey(A, 'ua'))).toEqual([]);
    // B untouched.
    expect((await store.listReplicas(scopeKey(B, 'ub'))).map((r) => r.text)).toEqual(['other account']);
    expect(await store.getCache(scopeKey(B, 'ub'), 'notes:v1')).not.toBeNull();
  });

  it('a late write from an open editor cannot resurrect a wiped scope', async () => {
    let killed = false;
    store.attach(key('n1'), { kill: () => ((killed = true), { vaultID: 'v1', noteID: 'n1', text: 'live unsent' }) });
    const rescued = await store.wipeScope(scopeKey(A, 'ua'));
    expect(killed).toBe(true);
    expect(rescued.map((r) => r.text)).toEqual(['live unsent']);
    await put(key('n1'), { dirty: true });
    expect(await store.listReplicas()).toEqual([]);
    store.allowScope(scopeKey(A, 'ua')); // signed in again
    await put(key('n1'));
    expect(await store.listReplicas()).toHaveLength(1);
  });

  it('wipeVault removes one book only', async () => {
    await put(key('n1', A, 'ua', 'v1'), { dirty: true, text: 'v1 text' });
    await put(key('n1', A, 'ua', 'v2'));
    await store.putCache(scopeKey(A, 'ua'), 'notes:v1', []);
    await store.putCache(scopeKey(A, 'ua'), 'vaults', []);
    const rescued = await store.wipeVault(scopeKey(A, 'ua'), 'v1');
    expect(rescued.map((r) => r.text)).toEqual(['v1 text']);
    expect((await store.listReplicas()).map((r) => r.vaultID)).toEqual(['v2']);
    expect(await store.getCache(scopeKey(A, 'ua'), 'notes:v1')).toBeNull();
    expect(await store.getCache(scopeKey(A, 'ua'), 'vaults')).not.toBeNull();
  });

  it('boot sweep drops orphan scopes, keeping unsent work for the retention window', async () => {
    await put(key('clean', B, 'gone'));
    await put(key('dirty', B, 'gone'), { dirty: true });
    await store.putCache(scopeKey(B, 'gone'), 'vaults', []);
    await put(key('mine'));
    await store.sweepOrphans(new Set([scopeKey(A, 'ua')]));
    expect((await store.listReplicas()).map((r) => r.noteID).sort()).toEqual(['dirty', 'mine']);
    expect(await store.getCache(scopeKey(B, 'gone'), 'vaults')).toBeNull();
    now += ORPHAN_DIRTY_RETENTION_MS + 1;
    await store.sweepOrphans(new Set([scopeKey(A, 'ua')]));
    expect((await store.listReplicas()).map((r) => r.noteID)).toEqual(['mine']);
  });

  it('coordinator: session.ended-style wipe keeps the unsent text in memory only', async () => {
    const accounts = { get: () => null, list: [] } as any;
    const books = { bookForVault: () => null, accountKeyOf: () => '' } as any;
    const off = new OfflineCoordinator({ store, accounts, books });
    await put(key('n1'), { dirty: true, text: 'rescue me' });
    await off.wipeAccount({ server_url: A, user_id: 'ua' }, 'session_ended');
    expect(off.rescues).toHaveLength(1);
    expect(off.rescues[0].items[0].text).toBe('rescue me');
    expect(await store.listReplicas()).toEqual([]);
    // sign-out: the UI already offered the export → nothing kept.
    await put(key('n2', A, 'ub'), { dirty: true });
    await off.wipeAccount({ server_url: A, user_id: 'ub' }, 'signed_out');
    expect(off.rescues).toHaveLength(1);
  });

  it('export bundles several notes into one markdown file', () => {
    const items = [
      { vaultID: 'v1', noteID: 'a', text: 'A' },
      { vaultID: 'v1', noteID: 'b', title: 'Bee', text: 'B' },
    ];
    expect(bundleMarkdown([items[0]])).toBe('A');
    expect(bundleMarkdown(items)).toContain('# Bee\n\nB');
    expect(exportFilename([items[0]])).toBe('a.local.md');
    expect(exportFilename(items, new Date('2026-11-22T00:00:00Z'))).toBe('lumi-pendentes-2026-11-22.md');
  });
});

describe('checkLineage', () => {
  const sv = (o: Record<number, number>) => new Map(Object.entries(o).map(([k, v]) => [Number(k), v]));

  it('epoch is authoritative when both sides have it', () => {
    expect(checkLineage({ stamp: { epoch: 'e1' }, sv: sv({ 9: 5 }), localClients: new Set() }, { stamp: { epoch: 'e1' }, sv: sv({}) }))
      .toEqual({ ok: true, basis: 'epoch' });
    expect(checkLineage({ stamp: { epoch: 'e1' }, sv: sv({}), localClients: new Set() }, { stamp: { epoch: 'e2' }, sv: null }))
      .toEqual({ ok: false, reason: 'epoch' });
  });

  it('server must dominate every server-origin client; local clients may be ahead', () => {
    const local = { stamp: {}, sv: sv({ 100: 11, 7: 3 }), localClients: new Set([7]) };
    expect(checkLineage(local, { stamp: {}, sv: sv({ 100: 11, 200: 4 }) })).toEqual({ ok: true, basis: 'state-vector' });
    expect(checkLineage(local, { stamp: {}, sv: sv({ 300: 20 }) })).toEqual({ ok: false, reason: 'history' });
    expect(checkLineage(local, { stamp: {}, sv: sv({ 100: 10 }) })).toEqual({ ok: false, reason: 'history' });
  });

  it('falls back to created_at only when nothing server-authored can be compared', () => {
    const onlyLocal = { stamp: { createdAt: 't1' }, sv: sv({ 7: 3 }), localClients: new Set([7]) };
    expect(checkLineage(onlyLocal, { stamp: { createdAt: 't2' }, sv: sv({ 1: 2 }) })).toEqual({ ok: false, reason: 'recreated' });
    expect(checkLineage(onlyLocal, { stamp: { createdAt: 't1' }, sv: sv({}) })).toEqual({ ok: true, basis: 'created-at' });
    // State-vector proof wins over a differing created_at (metadata
    // rewritten by a rescan must not invent conflicts).
    const synced = { stamp: { createdAt: 't1' }, sv: sv({ 100: 11 }), localClients: new Set<number>() };
    expect(checkLineage(synced, { stamp: { createdAt: 't9' }, sv: sv({ 100: 11 }) }).ok).toBe(true);
  });

  it('an empty replica has nothing to protect', () => {
    expect(checkLineage({ stamp: {}, sv: sv({}), localClients: new Set() }, { stamp: {}, sv: null }))
      .toEqual({ ok: true, basis: 'nothing-to-protect' });
  });
});
