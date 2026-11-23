// @vitest-environment jsdom
//
// WS ticket flow (wave 3): every connection attempt — first dial and
// every reconnect — fetches a fresh single-use ticket; 404 on the
// ticket endpoint falls back to ?token=; a 4401 close earns exactly
// one retry with a new ticket before it is an auth failure.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EditorSession } from './editor-session.svelte.ts';
import { WsTicketAuth, WsAuthError, createTicketSocketClass, withParams } from './ws-ticket.ts';
import { ApiError } from './types.ts';
import { fakeServer, fakeProviderFactory, flushMicrotasks } from '../test/fake-provider.ts';

const USER = { id: 'u1', username: 'ana', display_name: 'Ana' };
const SERVER = 'https://lumi.work.com';
const BASE = 'wss://lumi.work.com/api/vaults/v1/notes/n1/sync';

function ticketSeq() {
  let n = 0;
  return vi.fn(async () => ({ ticket: `t${++n}`, expires_at: '2026-11-22T00:00:30Z' }));
}

function notFound() {
  return new ApiError(404, { error: 'not_found' });
}

beforeEach(() => fakeServer.reset());

describe('WsTicketAuth', () => {
  it('returns a fresh ticket per call', async () => {
    const fetchTicket = ticketSeq();
    const a = new WsTicketAuth(fetchTicket, () => 'tk');
    expect(await a.params()).toEqual({ ticket: 't1' });
    expect(await a.params()).toEqual({ ticket: 't2' });
    expect(a.mode).toBe('ticket');
    expect(fetchTicket).toHaveBeenCalledTimes(2);
  });

  it('records crdt_epoch from each ticket response (null when absent/empty)', async () => {
    const replies = [
      { ticket: 't1', expires_at: 'x', crdt_epoch: 'e1' },
      { ticket: 't2', expires_at: 'x', crdt_epoch: 'e2' },
      { ticket: 't3', expires_at: 'x' },
      { ticket: 't4', expires_at: 'x', crdt_epoch: '' },
    ];
    let i = 0;
    const a = new WsTicketAuth(async () => replies[i++], () => 'tk');
    await a.params();
    expect(a.lastEpoch).toBe('e1');
    await a.params();
    expect(a.lastEpoch).toBe('e2'); // re-mint after a 4401 ticket_stale sees the new lineage
    await a.params();
    expect(a.lastEpoch).toBeNull();
    await a.params();
    expect(a.lastEpoch).toBeNull();
  });

  it('falls back to ?token= on 404 and stops asking for tickets', async () => {
    const fetchTicket = vi.fn(async () => { throw notFound(); });
    let token = 'tk';
    const a = new WsTicketAuth(fetchTicket, () => token);
    expect(await a.params()).toEqual({ token: 'tk' });
    token = 'tk2'; // re-login rotates the token: read at dial time
    expect(await a.params()).toEqual({ token: 'tk2' });
    expect(a.mode).toBe('token');
    expect(fetchTicket).toHaveBeenCalledTimes(1);
  });

  it('maps failures to close codes', async () => {
    const cases: Array<[unknown, number]> = [
      [new ApiError(401, { error: 'unauthorized' }), 4401],
      [new ApiError(403, { error: 'forbidden' }), 4403],
      [new ApiError(500, { error: 'internal' }), 1006],
      [new ApiError(0, { error: 'network_error' }), 1006],
    ];
    for (const [err, code] of cases) {
      const a = new WsTicketAuth(async () => { throw err; }, () => 'tk');
      await expect(a.params()).rejects.toMatchObject({ closeCode: code });
    }
  });

  it('a 404 after tickets worked means the note is gone, not an old server', async () => {
    let fail = false;
    const a = new WsTicketAuth(async () => {
      if (fail) throw notFound();
      return { ticket: 'x', expires_at: '' };
    }, () => 'tk');
    await a.params();
    fail = true;
    await expect(a.params()).rejects.toMatchObject({ closeCode: 4404 });
    expect(a.mode).toBe('ticket');
  });

  it('withParams appends to an existing query', () => {
    expect(withParams('ws://h/x', { ticket: 'a b' })).toBe('ws://h/x?ticket=a+b');
    expect(withParams('ws://h/x?v=1', { ticket: 't' })).toBe('ws://h/x?v=1&ticket=t');
  });
});

describe('EditorSession ticket flow (fake provider)', () => {
  function session(opts: Partial<ConstructorParameters<typeof EditorSession>[4]> = {}) {
    return new EditorSession('v1', 'n1', 'tk', USER, {
      serverUrl: SERVER,
      providerFactory: fakeProviderFactory(),
      probeAuth: async () => 'ok',
      ...opts,
    });
  }

  it('dials ?ticket= (never ?token=) and every reconnect uses a NEW ticket', async () => {
    fakeServer.seed('n1/sync', 'abc');
    const fetchTicket = ticketSeq();
    const s = session({ fetchTicket });
    await s.whenSynced();
    const p = fakeServer.providers[0];
    expect(p.urls).toEqual([`${BASE}?ticket=t1`]);
    expect(s.authMode).toBe('ticket');

    p.serverClose(1006);
    p.reconnect();
    await flushMicrotasks();
    p.serverClose(1006);
    p.reconnect();
    await flushMicrotasks();

    expect(p.urls).toEqual([`${BASE}?ticket=t1`, `${BASE}?ticket=t2`, `${BASE}?ticket=t3`]);
    expect(p.urls.some((u) => u.includes('token='))).toBe(false);
    expect(fetchTicket).toHaveBeenCalledTimes(3);
    expect(s.status).toBe('connected');
    s.destroy();
  });

  it('old server (404) → ?token= fallback, no ticket refetch on reconnect', async () => {
    const fetchTicket = vi.fn(async () => { throw notFound(); });
    const s = session({ fetchTicket });
    await s.whenSynced();
    const p = fakeServer.providers[0];
    p.serverClose(1006);
    p.reconnect();
    await flushMicrotasks();
    expect(p.urls).toEqual([`${BASE}?token=tk`, `${BASE}?token=tk`]);
    expect(fetchTicket).toHaveBeenCalledTimes(1);
    expect(s.authMode).toBe('token');
    s.destroy();
  });

  it('4401 → one retry with a fresh ticket, second 4401 → auth failure', async () => {
    const onAuthFailure = vi.fn();
    const fetchTicket = ticketSeq();
    fakeServer.autoSync = false; // no handshake, so the retry budget is not re-armed
    const s = session({ fetchTicket, onAuthFailure });
    await flushMicrotasks();
    const p = fakeServer.providers[0];

    p.serverClose(4401);
    expect(s.stopped).toBe(false);
    expect(onAuthFailure).not.toHaveBeenCalled();
    p.reconnect();
    await flushMicrotasks();
    expect(p.urls.at(-1)).toBe(`${BASE}?ticket=t2`);

    p.serverClose(4401);
    expect(s.stopped).toBe(true);
    expect(onAuthFailure).toHaveBeenCalledTimes(1);
    expect(p.shouldConnect).toBe(false);
    s.destroy();
  });

  it('a successful handshake re-arms the one-shot 4401 retry', async () => {
    const onAuthFailure = vi.fn();
    const s = session({ fetchTicket: ticketSeq(), onAuthFailure });
    await s.whenSynced();
    const p = fakeServer.providers[0];
    p.serverClose(4401);
    p.reconnect();
    await flushMicrotasks(); // handshake completes → budget re-armed
    p.serverClose(4401);
    expect(s.stopped).toBe(false);
    expect(onAuthFailure).not.toHaveBeenCalled();
    s.destroy();
  });

  it('in token-fallback mode 4401 is immediately fatal (as before)', async () => {
    const onAuthFailure = vi.fn();
    const s = session({ fetchTicket: async () => { throw notFound(); }, onAuthFailure });
    await s.whenSynced();
    fakeServer.providers[0].serverClose(4401);
    expect(s.stopped).toBe(true);
    expect(onAuthFailure).toHaveBeenCalledTimes(1);
  });

  it('ticket endpoint 401 (dead account token) stops without dialling', async () => {
    const onAuthFailure = vi.fn();
    const s = session({
      fetchTicket: async () => { throw new ApiError(401, { error: 'unauthorized' }); },
      onAuthFailure,
    });
    await flushMicrotasks();
    const p = fakeServer.providers[0];
    expect(p.urls).toEqual([]);
    expect(s.stopped).toBe(true);
    expect(onAuthFailure).toHaveBeenCalledTimes(1);
    s.destroy();
  });

  it('no fetchTicket configured keeps the legacy ?token= URL', () => {
    const s = session();
    expect(fakeServer.providers[0].url).toBe(`${BASE}?token=tk`);
    s.destroy();
  });
});

// ---- real y-websocket provider, fake socket ------------------------------

class FakeSocket {
  static instances: FakeSocket[] = [];
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  readonly OPEN = 1;
  readyState = 0;
  binaryType = 'blob';
  onopen: ((e: Event) => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  onclose: ((e: CloseEvent) => void) | null = null;
  sent: unknown[] = [];
  constructor(public url: string) {
    FakeSocket.instances.push(this);
  }
  open() {
    this.readyState = 1;
    this.onopen?.(new Event('open'));
  }
  send(d: unknown) {
    this.sent.push(d);
  }
  serverClose(code: number) {
    this.readyState = 3;
    this.onclose?.({ code } as CloseEvent);
  }
  close() {
    this.readyState = 3;
  }
}

async function until(fn: () => boolean, label: string, ms = 2000) {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error(`timed out: ${label}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('EditorSession ticket flow (real y-websocket reconnect loop)', () => {
  beforeEach(() => {
    FakeSocket.instances = [];
  });

  it("y-websocket's own automatic reconnect dials with a fresh ticket", async () => {
    const fetchTicket = ticketSeq();
    const s = new EditorSession('v1', 'n1', 'tk', USER, {
      serverUrl: SERVER,
      fetchTicket,
      WebSocketImpl: FakeSocket as unknown as typeof WebSocket,
    });
    await until(() => FakeSocket.instances.length === 1, 'first dial');
    const first = FakeSocket.instances[0];
    expect(first.url).toBe(`${BASE}?ticket=t1`);
    first.open();
    expect(s.status).toBe('connected');

    // Network drop: nobody calls connect() — the provider's backoff
    // timer must redial, and the redial must carry a NEW ticket.
    first.serverClose(1006);
    expect(s.status).toBe('disconnected');
    await until(() => FakeSocket.instances.length === 2, 'automatic redial');
    expect(FakeSocket.instances[1].url).toBe(`${BASE}?ticket=t2`);
    expect(fetchTicket).toHaveBeenCalledTimes(2);
    FakeSocket.instances[1].open();
    expect(s.status).toBe('connected');
    s.destroy();
  });

  it('a failed ticket fetch is retried by the provider backoff, then dials', async () => {
    let calls = 0;
    const fetchTicket = vi.fn(async () => {
      calls++;
      if (calls === 1) throw new ApiError(0, { error: 'network_error' });
      return { ticket: `t${calls}`, expires_at: '' };
    });
    const s = new EditorSession('v1', 'n1', 'tk', USER, {
      serverUrl: SERVER,
      fetchTicket,
      WebSocketImpl: FakeSocket as unknown as typeof WebSocket,
    });
    await until(() => FakeSocket.instances.length === 1, 'dial after retry');
    expect(FakeSocket.instances[0].url).toBe(`${BASE}?ticket=t2`);
    expect(s.stopped).toBe(false);
    s.destroy();
  });

  it('destroy while a ticket is in flight never dials', async () => {
    let release!: (v: { ticket: string; expires_at: string }) => void;
    const s = new EditorSession('v1', 'n1', 'tk', USER, {
      serverUrl: SERVER,
      fetchTicket: () => new Promise((r) => (release = r)),
      WebSocketImpl: FakeSocket as unknown as typeof WebSocket,
    });
    s.destroy();
    release({ ticket: 'late', expires_at: '' });
    await new Promise((r) => setTimeout(r, 20));
    expect(FakeSocket.instances).toHaveLength(0);
  });
});

describe('createTicketSocketClass', () => {
  it('reports a rejected resolver as a close event with its code', async () => {
    const Cls = createTicketSocketClass(async () => { throw new WsAuthError(4403, 'nope'); },
      FakeSocket as unknown as typeof WebSocket);
    const ws = new Cls('ws://h/x');
    const closed = new Promise<CloseEvent>((r) => (ws.onclose = r));
    expect(ws.readyState).toBe(0);
    expect((await closed).code).toBe(4403);
    expect(ws.readyState).toBe(3);
  });
});
