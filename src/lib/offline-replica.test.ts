// @vitest-environment jsdom
//
// Offline replicas (web): persistence round-trip, cold offline open,
// offline + concurrent server edits merging (y-protocols sync between
// two docs and through the session/provider), lineage mismatch →
// conflict copy, pending confirmation through the server state vector.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { EditorSession, type ServerProbe } from './editor-session.svelte.ts';
import { OfflineStore, type ReplicaKey } from './offline-store.ts';
import { ReplicaPersistence } from './replica.ts';
import { fakeServer, fakeProviderFactory, flushMicrotasks } from '../test/fake-provider.ts';
import { ApiError } from './types.ts';

const USER = { id: 'u1', username: 'ana', display_name: 'Ana' };
const ROOM = 'n1/sync';
const SERVER = 'https://lumi.work.com';
const KEY: ReplicaKey = { origin: SERVER, userID: 'u1', vaultID: 'v1', noteID: 'n1' };
const CREATED = '2026-11-01T10:00:00Z';

let store: OfflineStore;
/** When true the REST probe fails like a dead network. */
let networkDown = false;
let createdAt = CREATED;

const probe = async (): Promise<ServerProbe> => {
  if (networkDown) throw new ApiError(0, { error: 'network_error' });
  const d = fakeServer.doc(ROOM);
  return {
    sv: Y.decodeStateVector(Y.encodeStateVector(d)),
    text: d.getText('content').toString(),
    lineage: { createdAt },
  };
};

async function open(opts: { replica?: boolean } = {}) {
  const initial = opts.replica === false ? null : await store.loadReplica(KEY);
  return new EditorSession('v1', 'n1', 'tk', USER, {
    serverUrl: SERVER,
    providerFactory: fakeProviderFactory(),
    probeAuth: async () => 'ok',
    offline: { store, key: KEY, initial, lineage: { createdAt: CREATED }, probe, win: null, confirmDelayMs: 1 },
  });
}

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await flushMicrotasks(10);
    await new Promise((r) => setTimeout(r, 5));
  }
}

beforeEach(() => {
  fakeServer.reset();
  store = new OfflineStore(new IDBFactory());
  networkDown = false;
  createdAt = CREATED;
});

afterEach(() => {
  fakeServer.reset();
});

describe('persistence round-trip', () => {
  it('persists only after the first SyncStep2, then restores the same state', async () => {
    fakeServer.autoSync = false;
    fakeServer.seed(ROOM, 'hello');
    const s = await open();
    await settle();
    expect(s.synced).toBe(false);
    expect(await store.loadReplica(KEY, false)).toBeNull(); // nothing before Step2

    fakeServer.providers[0].handshake();
    await settle();
    expect(s.synced).toBe(true);
    s.ytext.insert(5, ' world');
    await s.persistence!.flush();
    const rec = await store.loadReplica(KEY, false);
    expect(rec).not.toBeNull();
    expect(rec!.text).toBe('hello world');
    expect(rec!.localClients).toContain(s.ydoc.clientID);
    expect(rec!.lineage.createdAt).toBe(CREATED);

    // Round trip: the stored update rebuilds exactly that text.
    const d = new Y.Doc();
    Y.applyUpdate(d, rec!.state);
    expect(d.getText('content').toString()).toBe('hello world');
    s.destroy();
  });

  it('pending is cleared only once the server state vector covers the local edits', async () => {
    fakeServer.seed(ROOM, 'abc');
    const s = await open();
    await s.whenSynced();
    s.ytext.insert(3, 'X');
    expect(s.unsent).toBe(true);
    expect(s.pending).toBe(false); // streaming on a live socket
    await s.confirmNow();
    expect(s.unsent).toBe(false);
    await s.persistence!.flush();
    expect((await store.loadReplica(KEY, false))!.dirty).toBe(false);
    s.destroy();
  });
});

describe('cold offline open', () => {
  async function primeReplica(text = 'abc'): Promise<void> {
    fakeServer.seed(ROOM, text);
    const s = await open({ replica: false });
    await s.whenSynced();
    await s.persistence!.flush();
    s.destroy();
    await settle();
  }

  it('loads the replica into a fresh doc and is editable at once, offline', async () => {
    await primeReplica();
    networkDown = true;
    const s = await open();
    expect(s.restored).toBe(true);
    expect(s.editable).toBe(true); // no SyncStep2 needed
    expect(s.synced).toBe(false);
    expect(s.ytext.toString()).toBe('abc');
    await settle();
    expect(s.status).not.toBe('connected');
    expect(s.protocolState).toBe('OFFLINE');

    s.ytext.insert(3, '!');
    expect(s.unsent).toBe(true);
    expect(s.pending).toBe(true);
    await s.persistence!.flush();
    const rec = await store.loadReplica(KEY, false);
    expect(rec!.dirty).toBe(true);
    expect(rec!.text).toBe('abc!');
    expect(fakeServer.text(ROOM)).toBe('abc'); // nothing reached the server
    s.destroy();
  });

  it('notes without a replica keep the join rule (read-only until synced)', async () => {
    fakeServer.autoSync = false;
    fakeServer.seed(ROOM, 'abc');
    const s = await open();
    expect(s.restored).toBe(false);
    expect(s.editable).toBe(false);
    expect(s.ytext.toString()).toBe(''); // never seeded from REST
    s.destroy();
  });

  it('offline edits and concurrent server edits merge both ways on reconnect', async () => {
    await primeReplica('hello world');
    networkDown = true;
    const s = await open();
    await settle();
    s.ytext.insert(11, '?'); // offline local edit
    fakeServer.doc(ROOM).getText('content').insert(0, '> '); // concurrent remote edit
    expect(s.ytext.toString()).toBe('hello world?');

    networkDown = false;
    fakeServer.providers.at(-1)!.reconnect();
    await settle();
    expect(s.synced).toBe(true);
    expect(s.ytext.toString()).toBe('> hello world?');
    expect(fakeServer.text(ROOM)).toBe('> hello world?'); // no duplication (V11)
    await s.confirmNow();
    expect(s.unsent).toBe(false);
    expect(s.pending).toBe(false);
    s.destroy();
  });
});

describe('restored replica + y-protocols handshake (server = second Y.Doc)', () => {
  /** Run a y-protocols message from `from` and feed it to `to`;
   *  returns the reply (if any) for the other direction. */
  function deliver(msg: Uint8Array, to: Y.Doc, origin: string): Uint8Array | null {
    const dec = decoding.createDecoder(msg);
    const enc = encoding.createEncoder();
    syncProtocol.readSyncMessage(dec, enc, to, origin);
    return encoding.length(enc) > 0 ? encoding.toUint8Array(enc) : null;
  }
  function step1(d: Y.Doc): Uint8Array {
    const enc = encoding.createEncoder();
    syncProtocol.writeSyncStep1(enc, d);
    return encoding.toUint8Array(enc);
  }

  it('merges a restored offline replica with concurrent server edits, no duplicate body', async () => {
    const server = new Y.Doc();
    server.getText('content').insert(0, 'hello world'); // InitFromText

    // Session 1: joins empty, syncs, persists.
    const c1 = new Y.Doc();
    const r1 = deliver(step1(c1), server, 'c1'); // server answers our step1 with step2
    deliver(r1!, c1, 'server');
    const p1 = new ReplicaPersistence({ store, key: KEY, doc: c1, initial: null, lineage: {}, isRemote: (o) => o === 'server', win: null });
    p1.activate();
    await p1.close();
    c1.destroy();

    // Session 2 (reload, offline): restore + local edit.
    const c2 = new Y.Doc();
    const p2 = new ReplicaPersistence({ store, key: KEY, doc: c2, initial: await store.loadReplica(KEY), lineage: {}, isRemote: (o) => o === 'server', win: null });
    c2.getText('content').insert(5, ',');
    expect(p2.unsent).toBe(true);
    server.getText('content').insert(11, '!'); // concurrent server edit

    // Reconnect: both step1/step2 directions over y-protocols.
    const toServer = deliver(step1(server), c2, 'server'); // client replies step2 to server step1
    deliver(toServer!, server, 'c2');
    const toClient = deliver(step1(c2), server, 'c2');
    deliver(toClient!, c2, 'server');
    expect(server.getText('content').toString()).toBe('hello, world!');
    expect(c2.getText('content').toString()).toBe('hello, world!');

    p2.acknowledge(Y.decodeStateVector(Y.encodeStateVector(server)));
    expect(p2.unsent).toBe(false);
    await p2.close();
  });
});

describe('lineage safety', () => {
  it('note deleted and recreated with the same id → conflict copy, no merge', async () => {
    fakeServer.seed(ROOM, 'old body');
    const s1 = await open({ replica: false });
    await s1.whenSynced();
    s1.destroy();
    await settle();

    // Offline edit on the replica.
    networkDown = true;
    const s2 = await open();
    await settle();
    s2.ytext.insert(8, ' + offline edit');
    await s2.persistence!.flush();

    // Meanwhile the note is deleted and recreated: new server doc
    // (fresh clientID), new created_at.
    fakeServer.docs.delete(ROOM);
    fakeServer.seed(ROOM, 'brand new note');
    createdAt = '2026-11-20T09:00:00Z';
    networkDown = false;
    fakeServer.providers.at(-1)!.reconnect();
    await settle();

    expect(s2.lineageConflict).not.toBeNull();
    expect(s2.stopped).toBe(true);
    expect(fakeServer.text(ROOM)).toBe('brand new note'); // untouched: never merged
    const conflicts = await store.listConflicts(`${encodeURIComponent(SERVER)}|u1`);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].text).toBe('old body + offline edit');
    expect(conflicts[0].reason).toBe('lineage');
    expect(await store.loadReplica(KEY, false)).toBeNull(); // replica dropped
    s2.destroy();

    // A fresh session joins the new lineage empty.
    const s3 = await open();
    expect(s3.restored).toBe(false);
    await s3.whenSynced();
    expect(s3.ytext.toString()).toBe('brand new note');
    s3.destroy();
  });

  it('server CRDT reset (history lost) is caught by the state vector even with the same created_at', async () => {
    fakeServer.seed(ROOM, 'same text');
    const s1 = await open({ replica: false });
    await s1.whenSynced();
    s1.destroy();
    await settle();
    // Server re-seeds the same text from disk under a new clientID.
    fakeServer.docs.delete(ROOM);
    fakeServer.seed(ROOM, 'same text');
    const s2 = await open();
    await settle();
    expect(s2.lineageConflict).not.toBeNull();
    // Identical text: nothing would be lost, so no conflict copy.
    expect(s2.lineageConflict!.copy).toBeNull();
    expect(fakeServer.text(ROOM)).toBe('same text'); // not "same textsame text"
    s2.destroy();
  });

  it('a 404 probe (note deleted) keeps unsent text as a conflict copy', async () => {
    fakeServer.seed(ROOM, 'abc');
    const s1 = await open({ replica: false });
    await s1.whenSynced();
    s1.destroy();
    await settle();
    networkDown = true;
    const s2 = await open();
    await settle();
    s2.ytext.insert(3, 'd');
    await s2.persistence!.flush();
    networkDown = false;
    const gone = async (): Promise<ServerProbe> => {
      throw new ApiError(404, { error: 'not_found' });
    };
    s2.destroy();
    const s3 = new EditorSession('v1', 'n1', 'tk', USER, {
      serverUrl: SERVER,
      providerFactory: fakeProviderFactory(),
      offline: { store, key: KEY, initial: await store.loadReplica(KEY), lineage: {}, probe: gone, win: null },
    });
    await settle();
    expect(s3.stopped).toBe(true);
    const conflicts = await store.listConflicts(`${encodeURIComponent(SERVER)}|u1`);
    expect(conflicts.map((c) => [c.reason, c.text])).toEqual([['deleted', 'abcd']]);
    expect(await store.loadReplica(KEY, false)).toBeNull();
    s3.destroy();
  });
});
