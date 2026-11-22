import { describe, it, expect, beforeEach } from 'vitest';
import { FeedConnection, parseFeedEvent, parseRetryAfter, type FeedEvent, type FeedState } from './feed.ts';
import { FakeFeedServer, ManualTimers, flush } from '../test/fake-feed-server.ts';

let server: FakeFeedServer;
let timers: ManualTimers;
let states: Array<{ s: FeedState; reason?: string; retryInMs?: number }>;
let events: FeedEvent[];
let token: string | null;

function make(overrides: Partial<ConstructorParameters<typeof FeedConnection>[0]> = {}): FeedConnection {
  return new FeedConnection({
    serverUrl: server.base,
    getToken: () => token,
    onState: (s, info) => states.push({ s, ...info }),
    onEvent: (e) => events.push(e),
    fetch: server.fetch as typeof fetch,
    timers,
    random: () => 0.5,
    ...overrides,
  });
}

const HELLO = { protocol: 1, server_time: '2026-11-22T12:00:00Z', user_id: 'u', vaults: [{ vault_id: 'v1', seq: 42, role: 'Editor', can_edit: true }] };

beforeEach(() => {
  server = new FakeFeedServer();
  timers = new ManualTimers();
  states = [];
  events = [];
  token = 'tk';
});

describe('FeedConnection', () => {
  it('sends the token only in the Authorization header, never in the URL', async () => {
    const f = make();
    f.start();
    await flush();
    const ev = server.requests.find((r) => r.url.includes('/api/events'))!;
    expect(ev.url).toBe('https://feed.test/api/events');
    expect(ev.url).not.toMatch(/token/);
    expect(ev.headers['authorization']).toBe('Bearer tk');
    expect(ev.headers['accept']).toBe('text/event-stream');
    // /api/info is anonymous.
    const info = server.requests.find((r) => r.url.endsWith('/api/info'))!;
    expect(info.headers['authorization']).toBeUndefined();
    f.stop();
  });

  it('opens on hello and dispatches typed events; ignores comments and unknown events', async () => {
    const f = make();
    f.start();
    await flush();
    expect(f.state).toBe('connecting');
    server.last.send('hello', HELLO);
    server.last.ping();
    server.last.send('future.thing', { x: 1 });
    server.last.send('vault.head', { vault_id: 'v1', seq: 43 });
    await flush();
    expect(f.state).toBe('open');
    expect(events.map((e) => e.type)).toEqual(['hello', 'vault.head']);
    expect(events[1]).toEqual({ type: 'vault.head', vault_id: 'v1', seq: 43 });
    f.stop();
  });

  it('degrades to disabled when /api/info is missing (server without feed) and re-probes later', async () => {
    server.infoStatus = 404;
    const f = make({ disabledRecheckMs: 300_000 });
    f.start();
    await flush();
    expect(f.state).toBe('disabled');
    expect(server.requests.some((r) => r.url.includes('/api/events'))).toBe(false);
    server.infoStatus = 200;
    timers.advance(300_000);
    await flush();
    expect(server.streams).toHaveLength(1);
    f.stop();
  });

  it('degrades to disabled on 404 /api/events and on non-SSE responses', async () => {
    server.eventsStatus = 404;
    const f = make();
    f.start();
    await flush();
    expect(f.state).toBe('disabled');
    f.stop();

    server.eventsStatus = 200;
    server.eventsContentType = 'text/html';
    const g = make();
    g.start();
    await flush();
    expect(g.state).toBe('disabled');
    g.stop();
  });

  it('401 → auth_dead and no reconnect', async () => {
    token = 'revoked';
    const f = make();
    f.start();
    await flush();
    expect(f.state).toBe('auth_dead');
    expect(timers.pending).toEqual([]);
  });

  it('session.ended → auth_dead, stream closed, no reconnect', async () => {
    const f = make();
    f.start();
    await flush();
    server.last.send('hello', HELLO);
    server.last.send('session.ended', { reason: 'revoked' });
    await flush();
    expect(f.state).toBe('auth_dead');
    expect(events.at(-1)).toEqual({ type: 'session.ended', reason: 'revoked' });
    expect(timers.pending).toEqual([]);
    timers.advance(120_000);
    await flush();
    expect(server.streams).toHaveLength(1);
  });

  it('reconnects with exponential backoff + jitter, capped at 30 s, reset after hello', async () => {
    server.eventsStatus = null; // network failure
    const f = make();
    f.start();
    await flush();
    const delays: number[] = [];
    for (let i = 0; i < 7; i++) {
      expect(f.state).toBe('backoff');
      delays.push(states.at(-1)!.retryInMs!);
      timers.advance(states.at(-1)!.retryInMs!);
      await flush();
    }
    // random = 0.5 → 75% of 1,2,4,8,16,30,30 s
    expect(delays).toEqual([750, 1500, 3000, 6000, 12000, 22500, 22500]);

    server.eventsStatus = 200;
    timers.advance(states.at(-1)!.retryInMs!);
    await flush();
    server.last.send('hello', HELLO);
    await flush();
    expect(f.state).toBe('open');
    server.last.close();
    await flush();
    expect(f.state).toBe('backoff');
    expect(states.at(-1)!.retryInMs).toBe(750);
    f.stop();
  });

  it('respects Retry-After on 429', async () => {
    server.eventsStatus = 429;
    server.eventsHeaders = { 'retry-after': '20' };
    const f = make();
    f.start();
    await flush();
    expect(f.state).toBe('backoff');
    expect(states.at(-1)!.retryInMs).toBe(20_000);
    f.stop();
  });

  it('treats 60 s without bytes as a dead connection; pings keep it alive', async () => {
    const f = make();
    f.start();
    await flush();
    server.last.send('hello', HELLO);
    await flush();
    timers.advance(50_000);
    server.last.ping();
    await flush();
    timers.advance(50_000);
    await flush();
    expect(f.state).toBe('open');
    timers.advance(10_001);
    await flush();
    expect(f.state).toBe('backoff');
    expect(server.streams[0].closed).toBe(true);
    // Exactly one retry scheduled (no double backoff from the aborted read).
    expect(timers.pending).toHaveLength(1);
    timers.advance(timers.pending[0]);
    await flush();
    expect(server.streams).toHaveLength(2);
    f.stop();
  });

  it('honours the reconnect event: after_ms + jitter, no Offline flash', async () => {
    const f = make();
    f.start();
    await flush();
    server.last.send('hello', HELLO);
    server.last.send('reconnect', { after_ms: 2000 });
    await flush();
    expect(f.state).toBe('connecting');
    expect(states.at(-1)!.retryInMs).toBe(2500);
    timers.advance(2500);
    await flush();
    expect(server.streams).toHaveLength(2);
    f.stop();
  });

  it('retryNow reconnects immediately from backoff', async () => {
    server.eventsStatus = 503;
    const f = make();
    f.start();
    await flush();
    expect(f.state).toBe('backoff');
    server.eventsStatus = 200;
    f.retryNow();
    await flush();
    expect(server.streams).toHaveLength(1);
    f.stop();
  });

  it('stop() aborts the stream and cancels timers', async () => {
    const f = make();
    f.start();
    await flush();
    f.stop();
    await flush();
    expect(server.last.closed).toBe(true);
    expect(timers.pending).toEqual([]);
  });
});

describe('parseFeedEvent', () => {
  it('validates payloads', () => {
    expect(parseFeedEvent('vault.head', '{"vault_id":"a"}')).toBeNull();
    expect(parseFeedEvent('vault.head', 'not json')).toBeNull();
    expect(parseFeedEvent('hello', '{"vaults":[{"vault_id":"a","seq":1},{"seq":2}]}')).toMatchObject({
      vaults: [{ vault_id: 'a', seq: 1 }],
    });
    expect(parseFeedEvent('vault.revoked', '{"vault_id":"a"}')).toEqual({ type: 'vault.revoked', vault_id: 'a', reason: 'removed' });
  });
  it('parses Retry-After', () => {
    expect(parseRetryAfter('3')).toBe(3000);
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter(new Date(10_000).toUTCString(), 4_000)).toBe(6_000);
  });
});
