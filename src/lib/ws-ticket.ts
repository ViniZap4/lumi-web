// Single-use WebSocket tickets for the per-note sync socket (wave 3).
//
// Contract (PM, wave 3):
//   POST /api/vaults/:vault/notes/:id/ws-ticket   (account auth header)
//     → 201 {"ticket": "...", "expires_at": "<RFC3339>"}
//   The socket is then opened with `?ticket=<ticket>` instead of
//   `?token=<token>`, so the long-lived account token never appears in
//   a URL (proxy logs, browser history, Referer).
//
// A ticket is single-use and valid for 30 s, so EVERY connection
// attempt — the first one and each reconnect — needs a fresh ticket.
// y-websocket's provider reconnects on its own (exponential backoff)
// and builds the socket synchronously via `new provider._WS(url)`, so
// there is no async hook before a connect. Instead of re-implementing
// its reconnect loop we hand it a WebSocket *class* (`WebSocketPolyfill`)
// whose constructor returns immediately in CONNECTING state, fetches a
// ticket, and only then opens the real socket. Each reconnect
// constructs a new instance → a new ticket. The provider's state
// machine (status/sync events, backoff, awareness) stays untouched.
//
// Old servers: the endpoint 404s → fall back to `?token=` for the rest
// of the session (no extra round trip on each reconnect).

import { ApiError } from './types.ts';

export interface WsTicket {
  ticket: string;
  expires_at: string;
  /** Optional CRDT epoch of the note (assumed future server field; see
   *  lib/lineage.ts). Ignored when absent. */
  crdt_epoch?: string | null;
}

export type WsAuthMode = 'unknown' | 'ticket' | 'token';

/** Why a connection attempt could not even get its auth params. The
 *  socket reports it as a close event with `closeCode`. */
export class WsAuthError extends Error {
  /** 4401 = account token rejected (definitive: refetching cannot
   *  help), 4403 = no permission, 4404 = note gone, 1006 = transient. */
  readonly closeCode: number;
  constructor(closeCode: number, message: string) {
    super(message);
    this.name = 'WsAuthError';
    this.closeCode = closeCode;
  }
}

/**
 * Resolves the query params for ONE connection attempt. One instance
 * per editor session (per note).
 */
export class WsTicketAuth {
  mode: WsAuthMode = 'unknown';
  /** Number of tickets successfully fetched (diagnostics/tests). */
  issued = 0;
  /** `crdt_epoch` of the last ticket response, when the server sends it. */
  lastEpoch: string | null = null;

  constructor(
    private readonly fetchTicket: () => Promise<WsTicket>,
    private readonly getToken: () => string | null,
  ) {}

  async params(): Promise<Record<string, string>> {
    if (this.mode === 'token') return this.tokenParams();
    let t: WsTicket;
    try {
      t = await this.fetchTicket();
    } catch (e) {
      if (e instanceof ApiError) {
        // Older server without the endpoint. Only before the first
        // ticket: once tickets worked, a 404 means the note is gone.
        if (e.status === 404 && this.mode === 'unknown') {
          this.mode = 'token';
          return this.tokenParams();
        }
        if (e.status === 404) throw new WsAuthError(4404, 'note not found');
        if (e.status === 401) throw new WsAuthError(4401, 'ticket request unauthorized');
        if (e.status === 403) throw new WsAuthError(4403, 'ticket request forbidden');
      }
      throw new WsAuthError(1006, e instanceof Error ? e.message : 'ticket request failed');
    }
    if (!t || typeof t.ticket !== 'string' || t.ticket === '') {
      throw new WsAuthError(1006, 'malformed ticket response');
    }
    this.mode = 'ticket';
    this.issued++;
    this.lastEpoch = typeof t.crdt_epoch === 'string' && t.crdt_epoch ? t.crdt_epoch : null;
    return { ticket: t.ticket };
  }

  private tokenParams(): Record<string, string> {
    const token = this.getToken();
    if (!token) throw new WsAuthError(4401, 'no token');
    return { token };
  }
}

type WSCtor = typeof WebSocket;

/** Append `params` to `url`'s query string (existing params kept). */
export function withParams(url: string, params: Record<string, string>): string {
  const qs = new URLSearchParams(params).toString();
  if (!qs) return url;
  return url + (url.includes('?') ? '&' : '?') + qs;
}

/**
 * Build a WebSocket-compatible class for y-websocket's
 * `WebSocketPolyfill` option. `resolveParams` runs once per instance,
 * i.e. once per connection attempt.
 *
 * Only the surface y-websocket uses is implemented: binaryType,
 * readyState / OPEN, onopen / onmessage / onerror / onclose, send(),
 * close().
 */
export function createTicketSocketClass(
  resolveParams: () => Promise<Record<string, string>>,
  Inner: WSCtor = globalThis.WebSocket,
): WSCtor {
  class TicketSocket {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;
    readonly CONNECTING = 0;
    readonly OPEN = 1;
    readonly CLOSING = 2;
    readonly CLOSED = 3;

    onopen: ((ev: Event) => void) | null = null;
    onmessage: ((ev: MessageEvent) => void) | null = null;
    onerror: ((ev: Event) => void) | null = null;
    onclose: ((ev: CloseEvent) => void) | null = null;

    private inner: WebSocket | null = null;
    private closed = false;
    private _binaryType: BinaryType = 'blob';
    /** URL actually dialled (with auth params), once known. */
    dialledUrl: string | null = null;

    constructor(url: string | URL, protocols?: string | string[]) {
      const base = String(url);
      resolveParams().then(
        (params) => {
          if (this.closed) return; // cancelled while fetching the ticket
          this.dialledUrl = withParams(base, params);
          const ws = new Inner(this.dialledUrl, protocols);
          ws.binaryType = this._binaryType;
          ws.onopen = (ev) => this.onopen?.(ev);
          ws.onmessage = (ev) => this.onmessage?.(ev);
          ws.onerror = (ev) => this.onerror?.(ev);
          ws.onclose = (ev) => {
            this.closed = true;
            this.onclose?.(ev);
          };
          this.inner = ws;
        },
        (err) => {
          if (this.closed) return;
          this.closed = true;
          const code = err instanceof WsAuthError ? err.closeCode : 1006;
          const reason = err instanceof Error ? err.message : 'ticket request failed';
          this.onclose?.({ code, reason, wasClean: false, type: 'close' } as CloseEvent);
        },
      );
    }

    get readyState(): number {
      if (this.inner) return this.inner.readyState;
      return this.closed ? 3 : 0;
    }

    get binaryType(): BinaryType {
      return this._binaryType;
    }

    set binaryType(v: BinaryType) {
      this._binaryType = v;
      if (this.inner) this.inner.binaryType = v;
    }

    get url(): string {
      return this.dialledUrl ?? '';
    }

    send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
      this.inner?.send(data as any);
    }

    close(code?: number, reason?: string): void {
      if (this.inner) {
        this.inner.close(code, reason);
        return;
      }
      // Not dialled yet: drop the pending attempt. No close event —
      // y-websocket only calls close() after it already forgot us.
      this.closed = true;
    }
  }
  return TicketSocket as unknown as WSCtor;
}
