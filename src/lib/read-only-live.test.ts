// @vitest-environment jsdom
//
// Read-only live view (viewers without note.edit, mirror books): the
// session joins empty (protocol §2), receives every update, and NEVER
// sends one — no doc update, no presence. 4403 stops for good (no
// reconnect loop); 1012 mirror_rebuild asks the view to rejoin with a
// new empty doc. The editor binding applies remote deltas and drops
// every local change.

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import * as Y from 'yjs';
import { EditorView } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { EditorSession, READ_ONLY_REFUSED } from './editor-session.svelte.ts';
import { fakeServer, fakeProviderFactory, type FakeProvider } from '../test/fake-provider.ts';
import { deltaToChanges, readOnlyYSync } from './read-only-sync.ts';
import { ApiClient } from './api.ts';

const USER = { id: 'u1', username: 'ana', display_name: 'Ana' };
const ROOM = 'n1/sync';
const BODY = '# Title\n\nhello world\n';

function readSession() {
  return new EditorSession('v1', 'n1', 'tk', USER, {
    serverUrl: 'https://lumi.work.com',
    providerFactory: fakeProviderFactory(),
    probeAuth: async () => 'ok',
    readOnly: true,
  });
}
const providerOf = (s: EditorSession) => s.provider as unknown as FakeProvider;

beforeEach(() => fakeServer.reset());

describe('read-only EditorSession', () => {
  it('joins empty, adopts the server text and follows remote edits', async () => {
    fakeServer.seed(ROOM, BODY);
    const s = readSession();
    expect(s.ytext.toString()).toBe('');
    await s.whenSynced();
    expect(s.ytext.toString()).toBe(BODY);
    fakeServer.doc(ROOM).getText('content').insert(0, '>> ');
    expect(s.ytext.toString()).toBe('>> ' + BODY);
    expect(s.readOnly).toBe(true);
    expect(providerOf(s).offeredToServer).toBe(0);
    s.destroy();
  });

  it('never sends: no presence, and a local change is neither sent nor offered on reconnect', async () => {
    fakeServer.seed(ROOM, BODY);
    const s = readSession();
    await s.whenSynced();
    expect(s.provider.awareness.getLocalState()).toBeNull();
    s.ytext.insert(0, 'X'); // a bug somewhere: must never reach the server
    expect(fakeServer.text(ROOM)).toBe(BODY);
    expect(s.stopped).toBe(true);
    expect(s.lastError).toMatch(/Somente leitura/);
    s.destroy();
  });

  it('close 4403 read_only: stops with a pt-BR error and does not reconnect', async () => {
    fakeServer.seed(ROOM, BODY);
    const s = readSession();
    await s.whenSynced();
    const p = providerOf(s);
    p.serverClose(4403);
    expect(s.stopped).toBe(true);
    expect(s.lastError).toBe(READ_ONLY_REFUSED);
    expect(p.shouldConnect).toBe(false);
    expect(s.rejoin).toBe(false);
    s.destroy();
  });

  it('close 1012 mirror_rebuild: asks for a rejoin with a new empty doc (the old one is never reused)', async () => {
    fakeServer.seed(ROOM, BODY);
    const s = readSession();
    await s.whenSynced();
    providerOf(s).serverClose(1012);
    expect(s.rejoin).toBe(true);
    expect(s.stopped).toBe(true); // the pool never hands it out again
    expect(s.lastError).toBeNull();
    // The rebuilt server doc: a new history with the same text.
    fakeServer.docs.delete(ROOM);
    fakeServer.seed(ROOM, BODY);
    const again = readSession();
    await again.whenSynced();
    expect(again.ytext.toString()).toBe(BODY); // no duplicate
    expect(fakeServer.text(ROOM)).toBe(BODY);
    s.destroy();
    again.destroy();
  });

  it('an edit session is unaffected by 1012 (plain reconnect)', async () => {
    fakeServer.seed(ROOM, BODY);
    const s = new EditorSession('v1', 'n1', 'tk', USER, { serverUrl: 'https://x', providerFactory: fakeProviderFactory(), probeAuth: async () => 'ok' });
    await s.whenSynced();
    providerOf(s).serverClose(1012);
    expect(s.stopped).toBe(false);
    expect(s.rejoin).toBe(false);
    s.destroy();
  });
});

describe('readOnlyYSync (editor binding)', () => {
  const R = Range.prototype as unknown as Record<string, unknown>;
  R.getClientRects ??= () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] });
  R.getBoundingClientRect ??= () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 });
  let view: EditorView | null = null;
  afterEach(() => view?.destroy());

  it('deltaToChanges maps retain/insert/delete to original coordinates', () => {
    expect(deltaToChanges([{ retain: 2 }, { insert: 'ab' }, { delete: 3 }, { retain: 1 }, { insert: 'z' }])).toEqual([
      { from: 2, insert: 'ab' },
      { from: 2, to: 5 },
      { from: 6, insert: 'z' },
    ]);
  });

  it('remote deltas reach the editor; local changes are dropped', () => {
    const doc = new Y.Doc();
    const t = doc.getText('content');
    t.insert(0, 'hello world');
    view = new EditorView({ state: EditorState.create({ doc: t.toString(), extensions: [readOnlyYSync(t, null)] }), parent: document.body });
    t.insert(5, ',');
    t.delete(0, 1);
    expect(view.state.doc.toString()).toBe(t.toString());
    view.dispatch({ changes: { from: 0, insert: 'NO ' } });
    expect(view.state.doc.toString()).toBe('ello, world');
    expect(t.toString()).toBe('ello, world');
  });
});

describe('ws-ticket mode', () => {
  it('POSTs {"mode":"read"} for a read ticket, no body for an edit ticket', async () => {
    const bodies: (string | null)[] = [];
    vi.stubGlobal('fetch', async (_u: string, init: RequestInit) => {
      bodies.push((init.body as string) ?? null);
      return new Response(JSON.stringify({ ticket: 't', expires_at: '', crdt_epoch: 'e', mode: 'read' }), { status: 201, headers: { 'content-type': 'application/json' } });
    });
    const c = new ApiClient({ serverUrl: 'https://x', getToken: () => 'tk' });
    expect((await c.createNoteWsTicket('v1', 'n1', 'read')).mode).toBe('read');
    await c.createNoteWsTicket('v1', 'n1');
    expect(bodies).toEqual(['{"mode":"read"}', null]);
    vi.unstubAllGlobals();
  });
});
