// Per-account event feed client (SPEC-LIVROS §3.2/§3.3, W3).
//
// GET /api/events read with fetch + ReadableStream — never EventSource,
// which cannot send headers. The token travels ONLY in the
// Authorization header; it is never put in the URL.
//
// One FeedConnection per account (not per book). It owns the
// connection lifecycle only; what an event *means* for books lives in
// the sync coordinator (sync.svelte.ts). Plain TS (no runes) so it is
// testable with an injected fetch, timers and RNG.
//
// Graceful degradation: the endpoint does not exist on servers that
// predate the feed. Before opening the stream we feature-detect with
// GET /api/info (`protocol >= 1`). A 404/405/501 on either route, or a
// non-SSE response (e.g. an SPA fallback serving index.html), puts the
// feed in `disabled` — shown as "Offline (feed indisponível)" — and we
// re-probe every few minutes instead of erroring or hammering.

import { SSEParser } from './sse.ts';

export type FeedState = 'connecting' | 'open' | 'backoff' | 'auth_dead' | 'disabled';

export interface HelloVault {
  vault_id: string;
  seq: number;
  role?: string;
  can_edit?: boolean;
}

export type FeedEvent =
  | { type: 'hello'; protocol: number; server_time?: string; user_id?: string; vaults: HelloVault[] }
  | { type: 'vault.head'; vault_id: string; seq: number }
  | { type: 'vault.access'; vault_id: string; role?: string; can_edit?: boolean }
  | { type: 'vault.updated'; vault_id: string; fields: string[] }
  | { type: 'vault.revoked'; vault_id: string; reason: string }
  | { type: 'session.ended'; reason: string }
  | { type: 'reconnect'; after_ms: number };

export interface FeedStateInfo {
  reason?: string;
  /** Delay before the next attempt (backoff / disabled re-probe). */
  retryInMs?: number;
  httpStatus?: number;
}

export interface Timers {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (h: unknown) => void;
}

export interface FeedOptions {
  serverUrl: string;
  getToken: () => string | null;
  onState: (state: FeedState, info: FeedStateInfo) => void;
  onEvent: (ev: FeedEvent) => void;
  fetch?: typeof fetch;
  timers?: Timers;
  random?: () => number;
  /** No bytes for this long = dead connection (spec: 60 s; ping 25 s). */
  pingTimeoutMs?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  /** Re-probe interval while the server has no feed. */
  disabledRecheckMs?: number;
}

/** Parse one SSE message into a typed event; null = ignore. Unknown
 *  event names and malformed payloads are dropped (forward compat). */
export function parseFeedEvent(event: string, data: string): FeedEvent | null {
  let p: any;
  try {
    p = JSON.parse(data);
  } catch {
    return null;
  }
  if (!p || typeof p !== 'object') return null;
  const str = (v: unknown) => typeof v === 'string' && v.length > 0;
  const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
  switch (event) {
    case 'hello':
      if (!Array.isArray(p.vaults)) return null;
      return {
        type: 'hello',
        protocol: num(p.protocol) ? p.protocol : 1,
        server_time: p.server_time,
        user_id: p.user_id,
        vaults: p.vaults
          .filter((v: any) => v && str(v.vault_id) && num(v.seq))
          .map((v: any) => ({ vault_id: v.vault_id, seq: v.seq, role: v.role, can_edit: v.can_edit })),
      };
    case 'vault.head':
      return str(p.vault_id) && num(p.seq) ? { type: 'vault.head', vault_id: p.vault_id, seq: p.seq } : null;
    case 'vault.access':
      return str(p.vault_id)
        ? { type: 'vault.access', vault_id: p.vault_id, role: p.role, can_edit: p.can_edit }
        : null;
    case 'vault.updated':
      return str(p.vault_id)
        ? { type: 'vault.updated', vault_id: p.vault_id, fields: Array.isArray(p.fields) ? p.fields : [] }
        : null;
    case 'vault.revoked':
      return str(p.vault_id)
        ? { type: 'vault.revoked', vault_id: p.vault_id, reason: str(p.reason) ? p.reason : 'removed' }
        : null;
    case 'session.ended':
      return { type: 'session.ended', reason: str(p.reason) ? p.reason : 'ended' };
    case 'reconnect':
      return { type: 'reconnect', after_ms: num(p.after_ms) && p.after_ms > 0 ? p.after_ms : 0 };
    default:
      return null;
  }
}

/** Retry-After as milliseconds (delta-seconds or HTTP date). */
export function parseRetryAfter(v: string | null, now = Date.now()): number | null {
  if (!v) return null;
  const s = Number(v);
  if (Number.isFinite(s) && s >= 0) return s * 1000;
  const t = Date.parse(v);
  return Number.isFinite(t) ? Math.max(0, t - now) : null;
}

const DISABLED_STATUSES = new Set([404, 405, 501]);

export class FeedConnection {
  state: FeedState = 'connecting';
  private readonly o: Required<Omit<FeedOptions, 'fetch' | 'timers' | 'random'>> & {
    fetch: typeof fetch;
    timers: Timers;
    random: () => number;
  };
  private running = false;
  private gen = 0;
  private attempt = 0;
  private probed = false;
  private abort: AbortController | null = null;
  private retryTimer: unknown = null;
  private watchdog: unknown = null;

  constructor(opts: FeedOptions) {
    this.o = {
      pingTimeoutMs: 60_000,
      baseBackoffMs: 1_000,
      maxBackoffMs: 30_000,
      disabledRecheckMs: 5 * 60_000,
      ...opts,
      fetch: opts.fetch ?? ((...a: Parameters<typeof fetch>) => globalThis.fetch(...a)),
      timers: opts.timers ?? {
        setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
        clearTimeout: (h) => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>),
      },
      random: opts.random ?? Math.random,
    };
  }

  get serverUrl(): string {
    return this.o.serverUrl;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    void this.connect();
  }

  /** Stop for good (account removed / signed out). */
  stop(): void {
    this.running = false;
    this.gen++;
    this.teardown();
  }

  /** User asked to retry ("Tentar agora") or the browser came online. */
  retryNow(): void {
    if (this.state === 'auth_dead' && !this.o.getToken()) return;
    this.running = true;
    this.attempt = 0;
    if (this.state === 'disabled') this.probed = false;
    this.gen++;
    this.teardown();
    void this.connect();
  }

  private teardown(): void {
    if (this.retryTimer != null) this.o.timers.clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.clearWatchdog();
    try {
      this.abort?.abort();
    } catch {
      // ignore
    }
    this.abort = null;
  }

  private setState(s: FeedState, info: FeedStateInfo = {}): void {
    this.state = s;
    try {
      this.o.onState(s, info);
    } catch {
      // listener bugs must not break the loop
    }
  }

  private schedule(ms: number, gen: number, fn: () => void): void {
    if (this.retryTimer != null) this.o.timers.clearTimeout(this.retryTimer);
    this.retryTimer = this.o.timers.setTimeout(() => {
      this.retryTimer = null;
      if (gen !== this.gen || !this.running) return;
      fn();
    }, ms);
  }

  /** 1 s · 2^n capped at 30 s, "equal jitter" (half fixed, half random). */
  backoffDelay(retryAfterMs: number | null = null): number {
    const n = this.attempt++;
    const d = Math.min(this.o.maxBackoffMs, this.o.baseBackoffMs * 2 ** n);
    const jittered = d / 2 + this.o.random() * (d / 2);
    return retryAfterMs != null ? Math.max(jittered, retryAfterMs) : jittered;
  }

  private backoff(gen: number, reason: string, retryAfterMs: number | null = null, httpStatus?: number): void {
    if (gen !== this.gen || !this.running) return;
    // Bump the generation so the aborted read loop / pending fetches of
    // this attempt cannot schedule a second retry.
    const g = ++this.gen;
    this.teardown();
    const ms = this.backoffDelay(retryAfterMs);
    this.setState('backoff', { reason, retryInMs: ms, httpStatus });
    this.schedule(ms, g, () => void this.connect());
  }

  private disable(gen: number, reason: string, httpStatus?: number): void {
    if (gen !== this.gen || !this.running) return;
    const g = ++this.gen;
    this.teardown();
    this.probed = false;
    const ms = this.o.disabledRecheckMs;
    this.setState('disabled', { reason, retryInMs: ms, httpStatus });
    this.schedule(ms, g, () => void this.connect());
  }

  private authDead(gen: number, reason: string): void {
    if (gen !== this.gen) return;
    this.running = false;
    this.gen++;
    this.teardown();
    this.setState('auth_dead', { reason });
  }

  private clearWatchdog(): void {
    if (this.watchdog != null) this.o.timers.clearTimeout(this.watchdog);
    this.watchdog = null;
  }

  private armWatchdog(gen: number): void {
    this.clearWatchdog();
    this.watchdog = this.o.timers.setTimeout(() => {
      this.watchdog = null;
      if (gen !== this.gen) return;
      this.backoff(gen, `sem dados há ${Math.round(this.o.pingTimeoutMs / 1000)} s`);
    }, this.o.pingTimeoutMs);
  }

  private async probe(gen: number, signal: AbortSignal): Promise<boolean> {
    let res: Response;
    try {
      res = await this.o.fetch(`${this.o.serverUrl}/api/info`, {
        headers: { Accept: 'application/json' },
        credentials: 'omit',
        cache: 'no-store',
        signal,
      });
    } catch {
      this.backoff(gen, 'servidor inacessível');
      return false;
    }
    if (gen !== this.gen) return false;
    if (DISABLED_STATUSES.has(res.status)) {
      this.disable(gen, 'este servidor ainda não oferece o feed de eventos', res.status);
      return false;
    }
    if (!res.ok) {
      this.backoff(gen, `GET /api/info: HTTP ${res.status}`, null, res.status);
      return false;
    }
    let info: any = null;
    try {
      info = await res.json();
    } catch {
      // HTML fallback or garbage: no feed here.
    }
    if (gen !== this.gen) return false;
    if (!info || typeof info.protocol !== 'number' || info.protocol < 1) {
      this.disable(gen, 'este servidor ainda não oferece o feed de eventos');
      return false;
    }
    this.probed = true;
    return true;
  }

  private async connect(): Promise<void> {
    if (!this.running) return;
    const gen = ++this.gen;
    this.teardown();
    const ctrl = new AbortController();
    this.abort = ctrl;
    this.setState('connecting');

    if (!this.probed && !(await this.probe(gen, ctrl.signal))) return;
    if (gen !== this.gen) return;

    const token = this.o.getToken();
    if (!token) {
      this.authDead(gen, 'sem token');
      return;
    }

    let res: Response;
    try {
      res = await this.o.fetch(`${this.o.serverUrl}/api/events`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
        credentials: 'omit',
        cache: 'no-store',
        signal: ctrl.signal,
      });
    } catch {
      this.backoff(gen, 'servidor inacessível');
      return;
    }
    if (gen !== this.gen) return;
    if (res.status === 401) {
      this.authDead(gen, 'sessão inválida (401)');
      return;
    }
    if (DISABLED_STATUSES.has(res.status)) {
      this.disable(gen, 'este servidor ainda não oferece o feed de eventos', res.status);
      return;
    }
    if (res.status === 429) {
      this.backoff(gen, 'muitas conexões (429)', parseRetryAfter(res.headers.get('retry-after')), 429);
      return;
    }
    if (!res.ok) {
      this.backoff(gen, `HTTP ${res.status}`, parseRetryAfter(res.headers.get('retry-after')), res.status);
      return;
    }
    const ct = res.headers.get('content-type') ?? '';
    if (!ct.includes('text/event-stream') || !res.body) {
      this.disable(gen, 'resposta não é text/event-stream');
      return;
    }
    await this.read(gen, res.body);
  }

  private async read(gen: number, body: ReadableStream<Uint8Array>): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    const parser = new SSEParser();
    let sawHello = false;
    this.armWatchdog(gen);
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (gen !== this.gen) return;
        if (done) break;
        this.armWatchdog(gen);
        const msgs = parser.push(decoder.decode(value, { stream: true }));
        for (const m of msgs) {
          const ev = parseFeedEvent(m.event, m.data);
          if (!ev) continue;
          if (ev.type === 'hello') {
            sawHello = true;
            this.attempt = 0;
            this.setState('open');
          } else if (!sawHello) {
            // Protocol: hello is always first. Anything before it is
            // ignored; reconciliation happens on hello anyway.
            if (ev.type !== 'session.ended') continue;
          }
          if (ev.type === 'session.ended') {
            try { this.o.onEvent(ev); } catch {}
            this.authDead(gen, `sessão encerrada (${ev.reason})`);
            return;
          }
          if (ev.type === 'reconnect') {
            const g = ++this.gen;
            this.teardown();
            this.attempt = 0;
            const ms = ev.after_ms + this.o.random() * 1000;
            this.setState('connecting', { reason: 'o servidor pediu reconexão', retryInMs: ms });
            this.schedule(ms, g, () => void this.connect());
            return;
          }
          try {
            this.o.onEvent(ev);
          } catch {
            // a handler bug must not kill the stream
          }
          if (gen !== this.gen) return;
        }
      }
      parser.end();
      this.backoff(gen, 'conexão encerrada pelo servidor');
    } catch {
      if (gen !== this.gen) return; // we aborted it ourselves
      this.backoff(gen, 'conexão perdida');
    } finally {
      try {
        reader.releaseLock();
      } catch {
        // ignore
      }
    }
  }
}
