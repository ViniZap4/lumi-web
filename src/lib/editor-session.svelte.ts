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
//   6. Offline replica (optional `offline` option): after the first
//      SyncStep2 the doc is persisted per (server, user, vault, note)
//      in IndexedDB (lib/replica.ts). A later session for the same note
//      restores that replica into its fresh doc and is editable at
//      once, offline included (CRDT protocol §5: "if it persisted its
//      doc locally it MAY restore that doc and reconnect"). Before
//      EVERY dial of a non-empty doc a lineage gate (lib/lineage.ts)
//      checks that the server still holds the history the replica was
//      forked from; on mismatch the local text becomes a conflict copy
//      and the session stops instead of merging.
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
import { ApiError } from './types.ts';
import { scopeKey, type ConflictCopy, type LineageStamp, type OfflineStore, type ReplicaKey, type ReplicaRecord } from './offline-store.ts';
import { checkLineage, LINEAGE_REASON, type StateVector } from './lineage.ts';
import { ReplicaPersistence, decodeSVBase64 } from './replica.ts';

function probeSV(p: ServerProbe): StateVector | null {
  if (p.sv) return p.sv;
  if (!p.vectorClock) return null;
  try {
    return decodeSVBase64(p.vectorClock);
  } catch {
    return null;
  }
}

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
  // Client-side only (never sent by the server): the lineage gate
  // refused to merge a persisted replica into another CRDT history.
  4409: 'Esta cópia local pertence a outra versão da nota; ela foi guardada como cópia em conflito.',
};
/** Client-side close code raised by the lineage gate. */
export const LINEAGE_CLOSE_CODE = 4409;
const NOTE_GONE_CLOSE_CODE = 4404;
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

/** What the server says about a note right now (REST). */
export interface ServerProbe {
  /** Server state vector, decoded… */
  sv?: StateVector | null;
  /** …or as GET /snapshot `vector_clock` (base64), decoded here. */
  vectorClock?: string | null;
  lineage: LineageStamp;
  /** Current server text (GET /snapshot `text`), when fetched. */
  text?: string | null;
}

export interface OfflineOptions {
  store: OfflineStore;
  key: ReplicaKey;
  /** Replica loaded by the caller (null = none: fresh join). */
  initial: ReplicaRecord | null;
  /** Lineage stamp from the note metadata at open time. */
  lineage: LineageStamp;
  /** REST probe. `full` = also the metadata needed for the lineage
   *  check; otherwise only the state vector (pending confirmation). */
  probe: (full: boolean) => Promise<ServerProbe>;
  /** A conflict copy was saved (lineage mismatch / note deleted). */
  onConflict?: (c: ConflictCopy) => void;
  title?: () => string | null;
  /** pagehide/visibilitychange target (tests pass null). */
  win?: Pick<Window, 'addEventListener' | 'removeEventListener'> | null;
  /** Idle time after a live local edit before confirming it reached
   *  the server. */
  confirmDelayMs?: number;
}

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
  /** Offline replica + lineage gate (omit = in-memory only, as before). */
  offline?: OfflineOptions;
  /** Background flush of a persisted replica: no presence broadcast. */
  headless?: boolean;
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
  /** "Pendente" for the UI (SPEC-LIVROS §4.2): local edits the server
   *  is not known to have, while not live. Without the offline option:
   *  edits made while disconnected, cleared by the next SyncStep2. With
   *  it: `unsent` and not streaming on a live socket (or the live
   *  confirmation failed). */
  pending = $state(false);
  /** Local edits not yet covered by a confirmed server state vector
   *  (offline option only; persisted with the replica). */
  unsent = $state(false);
  /** The doc was restored from a persisted replica: editable before
   *  (and without) a SyncStep2. */
  restored = $state(false);
  /** Lineage mismatch: the replica was NOT merged; its text was kept
   *  as a conflict copy. The view rebuilds a fresh session. */
  lineageConflict = $state<{ reason: string; copy: ConflictCopy | null } | null>(null);
  /** Provider reports a completed handshake on the CURRENT connection
   *  (flips back to false on disconnect, unlike `synced`). */
  liveSynced = $state(false);

  /** CRDT-CLIENT-PROTOCOL §2.1 state, for the book sync indicator. */
  get protocolState(): EditorState {
    if (this.destroyed) return 'closed';
    if (this.stopped) return 'CLOSED';
    if (this.status === 'connected') return this.liveSynced ? 'LIVE' : 'SYNCING';
    if (!this.synced && !this.restored) return 'CONNECTING';
    return 'OFFLINE';
  }

  /** The editor may be mounted: first SyncStep2 seen, or a replica
   *  restored (a valid local replica, never a seed). */
  get editable(): boolean {
    return this.synced || this.restored;
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
  private readonly offline: OfflineOptions | null;
  readonly persistence: ReplicaPersistence | null;
  private confirmTimer: ReturnType<typeof setTimeout> | null = null;
  private confirmFailures = 0;
  private confirmStuck = false;
  /** Ticket resolver (null = legacy token-only session). */
  private readonly wsAuth: WsTicketAuth | null;
  /** The one-shot "4401 → fetch a new ticket" retry was used and no
   *  handshake has succeeded since. */
  private authRetryUsed = false;
  private readonly opts: Required<
    Omit<EditorSessionOptions, 'onAuthFailure' | 'serverUrl' | 'fetchTicket' | 'getToken' | 'WebSocketImpl' | 'offline' | 'headless'>
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
    this.updatePending();
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
    if (this.offline) {
      // The server's Step2 can arrive before it applied ours: confirm
      // through its state vector instead of assuming.
      this.persistence?.activate();
      if (this.unsent) this.scheduleConfirm(0);
      this.updatePending();
    } else {
      // SyncStep2 after (re)connecting: offline edits were exchanged.
      this.pending = false;
    }
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
    if (code === NOTE_GONE_CLOSE_CODE) void this.handleNoteGone();
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
    if (this.offline) {
      // Persistence tracks `unsent`; while live, confirm once idle.
      if (this.status === 'connected' && this.liveSynced) this.scheduleConfirm();
      this.updatePending();
      return;
    }
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

    // Fresh, EMPTY doc per session. Never seeded locally — the only
    // thing ever loaded into it before the server's SyncStep2 is a
    // replica of this same note persisted after an earlier SyncStep2.
    this.ydoc = new Y.Doc();
    this.ytext = this.ydoc.getText('content');
    // Tracks only origins registered by the editor views (their
    // YSyncConfig) and the structured views ('lumi:structured') — never
    // the default `null` origin, so no untagged write (task toggle,
    // recovery) can ever be undone as if it were the user's edit.
    this.undoManager = new Y.UndoManager(this.ytext, { trackedOrigins: new Set() });
    this.offline = options.offline ?? null;
    this.persistence = this.offline
      ? new ReplicaPersistence({
          store: this.offline.store,
          key: this.offline.key,
          doc: this.ydoc,
          initial: this.offline.initial,
          lineage: this.offline.lineage,
          isRemote: (origin) => origin === this.provider && this.provider != null,
          onUnsent: (u) => {
            this.unsent = u;
            this.updatePending();
          },
          title: this.offline.title,
          win: this.offline.win,
        })
      : null;
    if (this.persistence?.restored) {
      this.restored = true;
      this.unsent = this.persistence.unsent;
    }

    // y-websocket appends `room` to serverUrl as a path segment and
    // `params` as the query string → /api/vaults/:v/notes/:id/sync.
    const serverUrl = `${wsBase(options.serverUrl)}/api/vaults/${vaultID}/notes`;
    const room = `${encodeURIComponent(noteID)}/sync`;
    const getToken = options.getToken ?? (() => token);
    this.wsAuth = options.fetchTicket ? new WsTicketAuth(options.fetchTicket, getToken) : null;
    // Ticket mode and the offline lineage gate both need an async step
    // before every dial → per-attempt resolver.
    this.getToken = getToken;
    this.provider = this.opts.providerFactory(serverUrl, room, this.ydoc, this.wsAuth || this.offline
      ? { params: {}, resolveParams: () => this.resolveParams(), WebSocketImpl: options.WebSocketImpl }
      : { params: { token }, WebSocketImpl: options.WebSocketImpl });

    if (options.headless) {
      this.provider.awareness.setLocalState(null);
    } else {
      this.provider.awareness.setLocalStateField('user', {
        name: user.display_name || user.username,
        color: pickColor(user.username),
        colorLight: pickColor(user.username) + '33',
      });
    }
    this.provider.on('status', this.onStatus);
    this.provider.on('sync', this.onSync);
    this.provider.on('connection-close', this.onClose);
    this.provider.awareness.on('change', this.onAwareness);
    this.ydoc.on('update', this.onDocUpdate);
    // The provider may already be synced if the factory completed the
    // handshake synchronously (tests) — honour that.
    if (this.provider.synced) this.onSync(true);
    this.updatePending();
  }

  private readonly getToken: () => string | null;

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
    if (this.confirmTimer) clearTimeout(this.confirmTimer);
    this.confirmTimer = null;
    // Encodes the state synchronously, so it is safe before the doc
    // is destroyed below.
    void this.persistence?.close();
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
    if (this.destroyed || this.stopped) throw new WsAuthError(1006, 'session closed');
    try {
      if (this.offline) {
        await this.lineageGate();
        if (this.destroyed || this.stopped) throw new WsAuthError(1006, 'session closed');
      }
      if (!this.wsAuth) {
        const t = this.getToken();
        if (!t) throw new WsAuthError(4401, 'no token');
        return { token: t };
      }
      const params = await this.wsAuth.params();
      // A server that ships a CRDT epoch in the ticket response gets a
      // last check right before the dial.
      const epoch = this.wsAuth.lastEpoch;
      if (epoch && this.persistence) {
        const local = this.persistence.lineage.epoch;
        if (local && local !== epoch && this.hasContent()) {
          await this.handleLineageMismatch('epoch', null);
          throw new WsAuthError(LINEAGE_CLOSE_CODE, 'lineage mismatch');
        }
        this.persistence.updateLineage({ epoch });
      }
      return params;
    } catch (e) {
      if (!this.destroyed && e instanceof WsAuthError && e.closeCode === NOTE_GONE_CLOSE_CODE) {
        void this.handleNoteGone();
      }
      if (!this.destroyed && !this.stopped && e instanceof WsAuthError && e.closeCode in FATAL_CLOSE_CODES) {
        this.stop(FATAL_CLOSE_CODES[e.closeCode]);
        if (e.closeCode === AUTH_CLOSE_CODE) this.opts.onAuthFailure?.();
      }
      throw e;
    }
  }

  private hasContent(): boolean {
    return Y.decodeStateVector(Y.encodeStateVector(this.ydoc)).size > 0;
  }

  /**
   * Before dialling with a non-empty doc: make sure the server still
   * holds the CRDT history this doc belongs to (lib/lineage.ts). Runs
   * for every attempt, so a server reset while we were offline is
   * caught on reconnect too. An empty doc has nothing to protect.
   */
  private async lineageGate(): Promise<void> {
    const off = this.offline;
    const p = this.persistence;
    if (!off || !p || !this.hasContent()) return;
    let probe: ServerProbe;
    try {
      probe = await off.probe(true);
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.status === 404) throw new WsAuthError(4404, 'note not found');
        if (e.status === 401) throw new WsAuthError(4401, 'probe unauthorized');
        if (e.status === 403) throw new WsAuthError(4403, 'probe forbidden');
      }
      throw new WsAuthError(1006, e instanceof Error ? e.message : 'lineage probe failed');
    }
    if (this.destroyed) throw new WsAuthError(1006, 'session closed');
    const verdict = checkLineage(
      { stamp: p.lineage, sv: Y.decodeStateVector(Y.encodeStateVector(this.ydoc)), localClients: p.localClients },
      { stamp: probe.lineage, sv: probeSV(probe) },
    );
    if (!verdict.ok) {
      await this.handleLineageMismatch(verdict.reason, probe.text ?? null);
      throw new WsAuthError(LINEAGE_CLOSE_CODE, 'lineage mismatch');
    }
    p.updateLineage(probe.lineage);
    const sv = probeSV(probe);
    if (sv) p.acknowledge(sv);
  }

  /** Keep the local text as a conflict copy (unless it is identical to
   *  what the server has now — then nothing would be lost), drop the
   *  replica, stop. Never merges. */
  private async handleLineageMismatch(reason: 'epoch' | 'history' | 'recreated', serverText: string | null): Promise<void> {
    const off = this.offline;
    const p = this.persistence;
    if (!off || !p || this.lineageConflict) return;
    const text = this.ytext.toString();
    let copy: ConflictCopy | null = null;
    if (text !== '' && text !== serverText) {
      copy = await off.store.addConflict({
        scope: scopeOf(off.key),
        vaultID: off.key.vaultID,
        noteID: off.key.noteID,
        title: off.title?.() ?? null,
        text,
        reason: 'lineage',
      });
    }
    await p.discardStored();
    this.unsent = false;
    this.lineageConflict = { reason: LINEAGE_REASON[reason], copy };
    if (copy) off.onConflict?.(copy);
    this.stop(FATAL_CLOSE_CODES[LINEAGE_CLOSE_CODE]);
  }

  /** The note is gone on the server (4404 / probe 404 / tombstone):
   *  unsent text becomes a conflict copy, the replica is dropped. */
  private async handleNoteGone(): Promise<void> {
    const off = this.offline;
    const p = this.persistence;
    if (!off || !p || p.isKilled) return;
    const unsent = p.unsent;
    const text = this.ydoc.isDestroyed ? '' : this.ytext.toString();
    await p.discardStored();
    if (unsent && text !== '') {
      const copy = await off.store.addConflict({
        scope: scopeOf(off.key),
        vaultID: off.key.vaultID,
        noteID: off.key.noteID,
        title: off.title?.() ?? null,
        text,
        reason: 'deleted',
      });
      if (copy) off.onConflict?.(copy);
    }
    this.unsent = false;
    this.updatePending();
  }

  /** Confirm that the server's state vector covers our local edits. */
  private scheduleConfirm(delay?: number): void {
    if (!this.offline || this.destroyed) return;
    if (this.confirmTimer) clearTimeout(this.confirmTimer);
    this.confirmTimer = setTimeout(() => {
      this.confirmTimer = null;
      void this.confirmNow();
    }, delay ?? this.offline.confirmDelayMs ?? 1500);
  }

  /** Visible for tests. */
  async confirmNow(): Promise<boolean> {
    const off = this.offline;
    const p = this.persistence;
    if (!off || !p || this.destroyed || !p.unsent) return true;
    if (!(this.status === 'connected' && this.liveSynced)) return false;
    try {
      const probe = await off.probe(false);
      if (this.destroyed) return false;
      const sv = probeSV(probe);
      if (sv) p.acknowledge(sv);
    } catch {
      // network blip: retry below
    }
    if (!p.unsent) {
      this.confirmFailures = 0;
      this.confirmStuck = false;
      this.updatePending();
      return true;
    }
    // The server may not have applied our Step2/updates yet.
    this.confirmFailures++;
    if (this.confirmFailures >= 3) this.confirmStuck = true;
    this.updatePending();
    if (this.confirmFailures < 6) this.scheduleConfirm(1000 * this.confirmFailures);
    return false;
  }

  private updatePending(): void {
    if (!this.offline || this.destroyed) return;
    const live = this.status === 'connected' && this.liveSynced;
    this.pending = this.unsent && (!live || this.confirmStuck);
    if (!this.unsent) {
      this.confirmFailures = 0;
      this.confirmStuck = false;
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

function scopeOf(k: ReplicaKey): string {
  return scopeKey(k.origin, k.userID);
}
