// @vitest-environment jsdom
//
// EditorSession: join rule (empty doc, wait for sync), single-note
// lifecycle, offline/reconnect merge, auth-failure reconnect stop.
// The server side is simulated by FakeServer (see src/test/fake-provider.ts).

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as Y from 'yjs';
import { EditorSession, ORIGIN_INIT_FROM_FILE } from './editor-session.svelte.ts';
import { FakeProvider, fakeServer, fakeProviderFactory, flushMicrotasks } from '../test/fake-provider.ts';

const USER = { id: 'u1', username: 'ana', display_name: 'Ana' };
const ROOM = 'n1/sync';
const BODY = '# Title\n\nhello world\n';

function newSession(opts: ConstructorParameters<typeof EditorSession>[4] = {}) {
  return new EditorSession('v1', 'n1', 'tk', USER, {
    providerFactory: fakeProviderFactory(),
    probeAuth: async () => 'ok',
    ...opts,
  });
}

beforeEach(() => {
  fakeServer.reset();
});

describe('join rule', () => {
  it('starts empty, then adopts the server text on sync without duplicating it', async () => {
    fakeServer.seed(ROOM, BODY);
    const s = newSession();
    expect(s.ytext.toString()).toBe(''); // never seeded locally
    expect(s.synced).toBe(false);

    await s.whenSynced();
    expect(s.synced).toBe(true);
    expect(s.ytext.toString()).toBe(BODY);
    expect(fakeServer.text(ROOM)).toBe(BODY); // server text unchanged
    expect(s.emptyAtSync).toBe(false);
    s.destroy();
  });

  it('test vector: seeding locally before connecting duplicates the body (the old bug)', async () => {
    fakeServer.seed(ROOM, BODY);
    const doc = new Y.Doc();
    doc.getText('content').insert(0, BODY); // what VaultHomeView used to do
    const p = new FakeProvider('ws://x', ROOM, doc);
    await flushMicrotasks();
    expect(p.synced).toBe(true);
    expect(doc.getText('content').toString()).toBe(BODY + BODY);
    expect(fakeServer.text(ROOM)).toBe(BODY + BODY);
    p.destroy();
  });

  it('two clients joining concurrently converge on the single server copy', async () => {
    fakeServer.seed(ROOM, BODY);
    const a = newSession();
    const b = newSession();
    await Promise.all([a.whenSynced(), b.whenSynced()]);
    expect(a.ytext.toString()).toBe(BODY);
    expect(b.ytext.toString()).toBe(BODY);
    a.ytext.insert(0, 'A');
    b.ytext.insert(b.ytext.length, 'B');
    expect(a.ytext.toString()).toBe('A' + BODY + 'B');
    expect(b.ytext.toString()).toBe('A' + BODY + 'B');
    a.destroy();
    b.destroy();
  });

  it('flags an empty server doc and only initialises from file on explicit request', async () => {
    const s = newSession();
    expect(s.initialiseFromFile(BODY)).toBe(false); // not synced yet
    await s.whenSynced();
    expect(s.emptyAtSync).toBe(true);
    let origin: unknown;
    s.ydoc.on('afterTransaction', (tr) => (origin = tr.origin));
    expect(s.initialiseFromFile(BODY)).toBe(true);
    expect(origin).toBe(ORIGIN_INIT_FROM_FILE);
    expect(fakeServer.text(ROOM)).toBe(BODY);
    expect(s.initialiseFromFile(BODY)).toBe(false); // no longer empty
    expect(fakeServer.text(ROOM)).toBe(BODY);
    s.destroy();
  });
});

describe('reconnect', () => {
  it('stays editable offline and merges offline edits with concurrent remote edits', async () => {
    fakeServer.seed(ROOM, 'abc');
    const s = newSession();
    await s.whenSynced();
    const p = fakeServer.providers[0];

    p.serverClose(1006);
    expect(s.status).toBe('disconnected');
    expect(s.synced).toBe(true); // sync gate does not flip back

    s.ytext.insert(3, 'X'); // offline local edit: abcX
    fakeServer.doc(ROOM).getText('content').insert(0, 'R'); // remote: Rabc
    expect(s.ytext.toString()).toBe('abcX');

    p.reconnect();
    expect(s.status).toBe('connected');
    expect(s.ytext.toString()).toBe('RabcX');
    expect(fakeServer.text(ROOM)).toBe('RabcX');
    s.destroy();
  });
});

describe('auth failure', () => {
  it('stops reconnecting on close code 4401 and reports auth failure', async () => {
    const onAuthFailure = vi.fn();
    const s = newSession({ onAuthFailure });
    await s.whenSynced();
    const p = fakeServer.providers[0];
    p.serverClose(4401);
    expect(s.stopped).toBe(true);
    expect(s.status).toBe('closed');
    expect(p.shouldConnect).toBe(false);
    expect(onAuthFailure).toHaveBeenCalledTimes(1);
  });

  it('stops on policy-violation 1008 without logging out', async () => {
    const onAuthFailure = vi.fn();
    const s = newSession({ onAuthFailure });
    await s.whenSynced();
    fakeServer.providers[0].serverClose(1008);
    expect(s.stopped).toBe(true);
    expect(s.lastError).toMatch(/connections/i);
    expect(onAuthFailure).not.toHaveBeenCalled();
  });

  it('probes auth after repeated failed upgrades and stops when the token is dead', async () => {
    fakeServer.autoSync = false;
    const onAuthFailure = vi.fn();
    const probeAuth = vi.fn(async () => 'unauthorized' as const);
    const s = newSession({ onAuthFailure, probeAuth });
    await flushMicrotasks();
    const p = fakeServer.providers[0];
    p.disconnect(); // pretend the socket never opened
    p.shouldConnect = true;
    s.status = 'connecting';
    // HTTP 401 on upgrade → browser reports close 1006 before open.
    (s as any).openedThisAttempt = false;
    p.serverClose(1006, false);
    expect(probeAuth).not.toHaveBeenCalled();
    p.serverClose(1006, false);
    await flushMicrotasks();
    expect(probeAuth).toHaveBeenCalledTimes(1);
    expect(s.stopped).toBe(true);
    expect(p.shouldConnect).toBe(false);
    expect(onAuthFailure).toHaveBeenCalledTimes(1);
    s.destroy();
  });

  it('keeps retrying when the probe says the session is fine', async () => {
    fakeServer.autoSync = false;
    const s = newSession({ probeAuth: async () => 'ok' });
    await flushMicrotasks();
    (s as any).openedThisAttempt = false;
    const p = fakeServer.providers[0];
    p.serverClose(1006, false);
    p.serverClose(1006, false);
    await flushMicrotasks();
    expect(s.stopped).toBe(false);
    expect(s.lastError).toMatch(/retrying/i);
    s.destroy();
  });
});

describe('single-note lifecycle', () => {
  it('destroy() tears down provider and doc; late events are ignored', async () => {
    fakeServer.autoSync = false;
    const s = newSession();
    await flushMicrotasks();
    const p = fakeServer.providers[0];
    s.destroy();
    expect(p.destroyed).toBe(true);
    expect(s.isDestroyed).toBe(true);
    expect(s.status).toBe('closed');
    p.emit('sync', [true]);
    expect(s.synced).toBe(false);
    s.destroy(); // idempotent
  });

  it('a new session for another note never inherits the previous doc', async () => {
    fakeServer.seed('n1/sync', 'note one');
    fakeServer.seed('n2/sync', 'note two');
    const a = newSession();
    await a.whenSynced();
    a.destroy();
    const b = new EditorSession('v1', 'n2', 'tk', USER, { providerFactory: fakeProviderFactory() });
    await b.whenSynced();
    expect(b.ydoc).not.toBe(a.ydoc);
    expect(b.ytext.toString()).toBe('note two');
    expect(fakeServer.text('n2/sync')).toBe('note two');
    expect(fakeServer.text('n1/sync')).toBe('note one');
    b.destroy();
  });

  it('builds the per-note sync URL with the token as a query param', () => {
    const s = newSession();
    const p = s.provider as unknown as FakeProvider;
    expect(p.url).toMatch(/\/api\/vaults\/v1\/notes\/n1\/sync\?token=tk$/);
    s.destroy();
  });
});
