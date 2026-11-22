// Yjs + WebsocketProvider session for exactly ONE note.
//
// See CRDT-CLIENT-PROTOCOL.md (wave1) for the rules this implements:
//
//   1. Join: the Y.Doc starts EMPTY. The client never seeds it from the
//      REST/markdown body — the server already holds the note text in
//      its own Y.Doc (initialised server-side from the file), and a
//      local insert under our clientID would merge as a second copy of
//      the body (duplication that is then mirrored to disk).
//   2. The editor stays read-only (the view shows a preview) until the
//      provider reports the first `sync` (SyncStep2 received). After
//      that, disconnects keep the doc editable: offline edits are
//      exchanged by y-websocket's step1/step2 handshake on reconnect.
//   3. A session is bound to one (vault, note) for its whole life.
//      Switching notes = destroy() this session + construct a new one;
//      there is no in-place retargeting that could leak the previous
//      note's Y.Doc state into the next note's room.
//   4. Auth failures stop the reconnect loop (close codes 4401/4403/
//      1008, or an HTTP-level upgrade rejection confirmed by an auth
//      probe) instead of hammering the server forever.
//   5. Socket auth (wave 3): when `fetchTicket` is given, every
//      connection attempt — including each automatic reconnect — first
//      fetches a fresh single-use ticket and dials `?ticket=`; older
//      servers (404 on the ticket endpoint) fall back to `?token=`.
//      A 4401 close on a ticketed socket gets ONE retry with a new
//      ticket before it counts as an auth failure (see lib/ws-ticket.ts).
//
// Why imperative (not reactive)? Yjs has its own observer system;
// wrapping Y.Text in a $state proxy fights it. Only connection
// metadata (status, synced, peers, errors) is reactive.
//
// Teardown order matters: destroy provider FIRST so it drops the socket
// without pushing more updates from a torn-down doc, THEN the doc.

import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import type { Awareness } from 'y-protocols/awareness';
import type { SessionUser } from './types.ts';
import { wsBase } from './serverurl.ts';
import type { EditorState } from './bookstatus.ts';
import { WsTicketAuth, WsAuthError, createTicketSocketClass, type WsTicket, type WsAuthMode } from './ws-ticket.ts';

export type ConnStatus = 'connecting' | 'connected' | 'disconnected' | 'closed';

export interface Peer {
  clientID: number;
  name: string;
  color: string;
}

/** Transaction origin for local, non-editor writes (e.g. the explicit
 *  "initialise from file" recovery action). Editor keystrokes carry
 *  y-codemirror's YSyncConfig as origin; remote updates carry the
 *  provider instance. */
export const ORIGIN_INIT_FROM_FILE = 'lumi:init-from-file';

/**
 * WebSocket close codes after which reconnecting is pointless.
 *   4401 — token invalid/expired (proposed server code; see spec)
 *   4403 — capability missing (proposed server code)
 *   4404 — note does not exist (proposed server code)
 *   1008 — policy violation (server uses it for the per-user
 *          concurrent-connection cap)
 */
export const FATAL_CLOSE_CODES: Record<number, string> = {
  4401: 'Your session expired. Sign in again.',
  4403: 'You no longer have permission to edit this note.',
  4404: 'This note no longer exists.',
  1008: 'Too many open connections. Close other editor tabs and retry.',
};
const AUTH_CLOSE_CODE = 4401;

/** Minimal surface of y-websocket's provider that the session uses.
 *  Lets tests inject a fake that simulates the server. */
export interface ProviderLike {
  awareness: Awareness;
  synced: boolean;
  on(event: string, fn: (...args: any[]) => void): void;
  off(event: string, fn: (...args: any[]) => void): void;
  disconnect(): void;
  destroy(): void;
}

export interface ProviderFactoryOpts {
  /** Static query params (legacy token mode). */
  params: Record<string, string>;
  /** Per-attempt auth params (ticket mode). When present it must be
   *  called once for EVERY connection attempt, reconnects included. */
  resolveParams?: () => Promise<Record<string, string>>;
  /** Underlying WebSocket implementation (tests). */
  WebSocketImpl?: typeof WebSocket;
}

export type ProviderFactory = (
  serverUrl: string,
  room: string,
  doc: Y.Doc,
  opts: ProviderFactoryOpts,
) => ProviderLike;

export type AuthProbeResult = 'ok' | 'unauthorized' | 'unknown';

export interface EditorSessionOptions {
  /** Normalised HTTP base URL of the server the ACTIVE BOOK's account
   *  lives on (SPEC-LIVROS: editor uses the book's account). Required:
   *  there is no global server any more. */
  serverUrl: string;
  providerFactory?: ProviderFactory;
  /** Called after repeated failed connection attempts to tell an
   *  HTTP-level 401 upgrade rejection (browser sees close 1006) apart
   *  from a network blip — typically GET /api/users/me on the book's
   *  account client. Default: 'unknown' (keep retrying). */
  probeAuth?: () => Promise<AuthProbeResult>;
  /** Called once when the session concludes the token is dead. */
  onAuthFailure?: () => void;
  /** Consecutive never-opened attempts before probing auth. */
  probeAfterFailures?: number;
  /** POST /api/vaults/:vault/notes/:id/ws-ticket on the book's
   *  account. When omitted the session dials `?token=` (legacy). */
  fetchTicket?: () => Promise<WsTicket>;
  /** Current account token, read at dial time for the `?token=`
   *  fallback (re-login rotates it). Defaults to the constructor token. */
  getToken?: () => string | null;
  /** Underlying WebSocket implementation (tests). */
  WebSocketImpl?: typeof WebSocket;
}

export const defaultProviderFactory: ProviderFactory = (serverUrl, room, doc, opts) => {
  const Impl = opts.WebSocketImpl ?? globalThis.WebSocket;
  const WebSocketPolyfill = opts.resolveParams ? createTicketSocketClass(opts.resolveParams, Impl) : Impl;
  return new WebsocketProvider(serverUrl, room, doc, {
    params: opts.params,
    WebSocketPolyfill,
    // Not a y-websocket option (ignored by it); lets a test double that
    // replaces the provider class see the per-attempt resolver.
    ...({ resolveParams: opts.resolveParams } as object),
  }) as unknown as ProviderLike;
};

async function defaultProbeAuth(): Promise<AuthProbeResult> {
  return 'unknown';
}

const PALETTE = [
  '#7aa2f7', '#bb9af7', '#7dcfff', '#9ece6a', '#e0af68',
  '#f7768e', '#f5c2e7', '#a9b1d6', '#f9e2af', '#cba6f7',
];

function pickColor(username: string): string {
  let h = 0;
  for (let i = 0; i < username.length; i++) h = (h * 31 + username.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(h) % PALETTE.length];
}

export class EditorSession {
  // ---- reactive surface ----
  status = $state<ConnStatus>('connecting');
  /** True once the first SyncStep2 arrived. Never flips back: after
   *  the initial sync the local doc is a valid replica and stays
   *  editable while offline. */
  synced = $state(false);
  /** Y.Text was empty right after the initial sync. Combined with a
   *  non-empty file body this means the server never initialised the
   *  note's CRDT state (legacy note) — see view recovery action. */
  emptyAtSync = $state(false);
  peers = $state<Peer[]>([]);
  lastError = $state<string | null>(null);
  /** Reconnecting was stopped for good (auth/permission/policy). */
  stopped = $state(false);
  /** Local edits made while disconnected that have not been confirmed
   *  by a SyncStep2 after reconnecting (SPEC-LIVROS §4.2 "pendente"). */
  pending = $state(false);
  /** Provider reports a completed handshake on the CURRENT connection
   *  (flips back to false on disconnect, unlike `synced`). */
  liveSynced = $state(false);

  /** CRDT-CLIENT-PROTOCOL §2.1 state, for the book sync indicator. */
  get protocolState(): EditorState {
    if (this.destroyed) return 'closed';
    if (this.stopped) return 'CLOSED';
    if (this.status === 'connected') return this.liveSynced ? 'LIVE' : 'SYNCING';
    if (!this.synced) return 'CONNECTING';
    return 'OFFLINE';
  }

  // ---- plain, owned by Yjs ----
  readonly vaultID: string;
  readonly noteID: string;
  readonly ydoc: Y.Doc;
  readonly ytext: Y.Text;
  readonly undoManager: Y.UndoManager;
  readonly provider: ProviderLike;

  private destroyed = false;
  private openedThisAttempt = false;
  private failedAttempts = 0;
  private probing = false;
  private syncWaiters: Array<() => void> = [];
  /** Ticket resolver (null = legacy token-only session). */
  private readonly wsAuth: WsTicketAuth | null;
  /** The one-shot "4401 → fetch a new ticket" retry was used and no
   *  handshake has succeeded since. */
  private authRetryUsed = false;
  private readonly opts: Required<
    Omit<EditorSessionOptions, 'onAuthFailure' | 'serverUrl' | 'fetchTicket' | 'getToken' | 'WebSocketImpl'>
  > &
    Pick<EditorSessionOptions, 'onAuthFailure'>;

  /** How the socket authenticates: 'ticket', 'token' (legacy server or
   *  no ticket support configured) or 'unknown' before the first dial. */
  get authMode(): WsAuthMode {
    return this.wsAuth ? this.wsAuth.mode : 'token';
  }

  private readonly onStatus = (ev: { status: string }) => {
    if (this.destroyed || this.stopped) return;
    if (ev.status === 'connected') {
      this.openedThisAttempt = true;
      this.failedAttempts = 0;
      this.lastError = null;
      this.status = 'connected';
    } else if (ev.status === 'connecting') {
      this.status = 'connecting';
      this.liveSynced = false;
    } else {
      this.status = 'disconnected';
      this.liveSynced = false;
    }
  };

  private readonly onSync = (isSynced: boolean) => {
    if (this.destroyed) return;
    if (!isSynced) {
      this.liveSynced = false;
      return;
    }
    this.liveSynced = true;
    // A full handshake proves the credentials work: re-arm the one-shot
    // 4401 ticket retry.
    this.authRetryUsed = false;
    // SyncStep2 after (re)connecting: offline edits were exchanged.
    this.pending = false;
    if (this.synced) return;
    this.emptyAtSync = this.ytext.length === 0;
    this.synced = true;
    const waiters = this.syncWaiters;
    this.syncWaiters = [];
    for (const w of waiters) w();
  };

  private readonly onClose = (ev: CloseEvent | null) => {
    if (this.destroyed || this.stopped) return;
    const code = ev?.code;
    if (code === AUTH_CLOSE_CODE && this.authMode === 'ticket' && !this.authRetryUsed) {
      // Ticket rejected (expired in flight, replayed, server restart):
      // let y-websocket reconnect — the next attempt fetches a NEW
      // ticket. A second 4401 before any successful handshake is an
      // auth failure.
      this.authRetryUsed = true;
      this.openedThisAttempt = false;
      return;
    }
    if (code != null && code in FATAL_CLOSE_CODES) {
      this.stop(FATAL_CLOSE_CODES[code]);
      if (code === AUTH_CLOSE_CODE) this.opts.onAuthFailure?.();
      return;
    }
    if (this.openedThisAttempt) {
      this.failedAttempts = 0;
    } else {
      this.failedAttempts++;
      if (this.failedAttempts >= this.opts.probeAfterFailures) void this.maybeProbeAuth();
    }
    this.openedThisAttempt = false;
  };

  private readonly onDocUpdate = (_u: Uint8Array, origin: unknown) => {
    if (this.destroyed || origin === this.provider) return;
    // A local edit while not live on a synced connection is "pending"
    // until the next SyncStep2.
    if (!(this.status === 'connected' && this.liveSynced)) this.pending = true;
  };

  private readonly onAwareness = () => {
    if (this.destroyed) return;
    this.peers = collectPeers(this.provider.awareness);
  };

  constructor(
    vaultID: string,
    noteID: string,
    token: string,
    user: SessionUser,
    options: EditorSessionOptions,
  ) {
    this.vaultID = vaultID;
    this.noteID = noteID;
    this.opts = {
      providerFactory: options.providerFactory ?? defaultProviderFactory,
      probeAuth: options.probeAuth ?? defaultProbeAuth,
      probeAfterFailures: options.probeAfterFailures ?? 2,
      onAuthFailure: options.onAuthFailure,
    };

    // Fresh, EMPTY doc per session. Never seeded locally.
    this.ydoc = new Y.Doc();
    this.ytext = this.ydoc.getText('content');
    this.undoManager = new Y.UndoManager(this.ytext);

    // y-websocket appends `room` to serverUrl as a path segment and
    // `params` as the query string → /api/vaults/:v/notes/:id/sync.
    const serverUrl = `${wsBase(options.serverUrl)}/api/vaults/${vaultID}/notes`;
    const room = `${encodeURIComponent(noteID)}/sync`;
    const getToken = options.getToken ?? (() => token);
    this.wsAuth = options.fetchTicket ? new WsTicketAuth(options.fetchTicket, getToken) : null;
    this.provider = this.opts.providerFactory(serverUrl, room, this.ydoc, this.wsAuth
      ? { params: {}, resolveParams: () => this.resolveParams(), WebSocketImpl: options.WebSocketImpl }
      : { params: { token }, WebSocketImpl: options.WebSocketImpl });

    this.provider.awareness.setLocalStateField('user', {
      name: user.display_name || user.username,
      color: pickColor(user.username),
      colorLight: pickColor(user.username) + '33',
    });
    this.provider.on('status', this.onStatus);
    this.provider.on('sync', this.onSync);
    this.provider.on('connection-close', this.onClose);
    this.provider.awareness.on('change', this.onAwareness);
    this.ydoc.on('update', this.onDocUpdate);
    // The provider may already be synced if the factory completed the
    // handshake synchronously (tests) — honour that.
    if (this.provider.synced) this.onSync(true);
  }

  /** Resolves after the initial sync (immediately if already synced).
   *  Never resolves for a session destroyed before syncing. */
  whenSynced(): Promise<void> {
    if (this.synced) return Promise.resolve();
    return new Promise((resolve) => this.syncWaiters.push(resolve));
  }

  /** Recovery for notes whose server-side CRDT was never initialised
   *  (synced doc is empty but the markdown file is not). Explicit user
   *  action only — automatic seeding is exactly the duplication bug. */
  initialiseFromFile(body: string): boolean {
    if (!this.synced || this.destroyed || this.ytext.length !== 0 || body === '') return false;
    this.ydoc.transact(() => this.ytext.insert(0, body), ORIGIN_INIT_FROM_FILE);
    this.emptyAtSync = false;
    return true;
  }

  /** Tear down provider + doc. Idempotent. A destroyed session cannot
   *  be reopened — construct a new one. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    try { this.provider.awareness.off('change', this.onAwareness); } catch {}
    try { this.ydoc.off('update', this.onDocUpdate); } catch {}
    try { this.provider.off('status', this.onStatus); } catch {}
    try { this.provider.off('sync', this.onSync); } catch {}
    try { this.provider.off('connection-close', this.onClose); } catch {}
    try { this.provider.destroy(); } catch {}
    try { this.undoManager.destroy(); } catch {}
    try { this.ydoc.destroy(); } catch {}
    this.syncWaiters = [];
    this.peers = [];
    this.status = 'closed';
  }

  get isDestroyed(): boolean {
    return this.destroyed;
  }

  /** Auth params for one connection attempt (ticket mode). A rejected
   *  account token is definitive: stop before the socket even reports
   *  the failed attempt. */
  private async resolveParams(): Promise<Record<string, string>> {
    if (!this.wsAuth || this.destroyed || this.stopped) throw new WsAuthError(1006, 'session closed');
    try {
      return await this.wsAuth.params();
    } catch (e) {
      if (!this.destroyed && !this.stopped && e instanceof WsAuthError && e.closeCode in FATAL_CLOSE_CODES) {
        this.stop(FATAL_CLOSE_CODES[e.closeCode]);
        if (e.closeCode === AUTH_CLOSE_CODE) this.opts.onAuthFailure?.();
      }
      throw e;
    }
  }

  private stop(reason: string): void {
    this.stopped = true;
    this.lastError = reason;
    this.status = 'closed';
    // disconnect() flips shouldConnect=false, so y-websocket's pending
    // backoff timer will not open a new socket.
    try { this.provider.disconnect(); } catch {}
  }

  private async maybeProbeAuth(): Promise<void> {
    if (this.probing) return;
    this.probing = true;
    try {
      const res = await this.opts.probeAuth();
      if (this.destroyed || this.stopped) return;
      if (res === 'unauthorized') {
        this.stop(FATAL_CLOSE_CODES[AUTH_CLOSE_CODE]);
        this.opts.onAuthFailure?.();
      } else if (res === 'ok' && this.failedAttempts >= this.opts.probeAfterFailures) {
        // Session is valid but the upgrade keeps failing (403 on
        // note.edit, server down, ...). Keep retrying with backoff but
        // tell the user.
        this.lastError = 'Cannot reach the live editing service; retrying…';
      }
    } finally {
      this.probing = false;
    }
  }
}

function collectPeers(awareness: Awareness): Peer[] {
  const out: Peer[] = [];
  const localID = awareness.clientID;
  awareness.getStates().forEach((state, clientID) => {
    if (clientID === localID) return;
    const user = (state as any).user;
    if (!user) return;
    out.push({ clientID, name: user.name ?? 'guest', color: user.color ?? '#888' });
  });
  return out;
}
