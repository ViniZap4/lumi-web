// Yjs + WebsocketProvider session for a single open note. Owns the
// Y.Doc + provider; survives the lifetime of the open editor and is
// torn down explicitly when the user navigates away.
//
// Why imperative (not reactive)?
//
// Yjs has its own observer system optimised for incremental
// integration. Wrapping Y.Text in a Svelte $state proxy fights
// against it — every keystroke becomes a proxy-level update,
// CodeMirror's own update listener sees stale snapshots, and
// teardown gets racy. Pattern (a) from the stack research: keep
// the Y.Doc as a plain object on this class, and use $state only
// for the *connection metadata* (status, peer list) the UI needs to
// render.
//
// Teardown order matters: destroy provider FIRST so it drops the
// socket cleanly without trying to push more updates into a torn-
// down doc, THEN destroy ydoc. Skipping this leaks both — a doc
// kept alive by a still-firing observer, and a socket holding the
// last update in its outbound queue.

import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { API_URL } from './api.ts';
import type { SessionUser } from './types.ts';

export type ConnStatus = 'idle' | 'connecting' | 'connected' | 'disconnected';

export interface Peer {
  clientID: number;
  name: string;
  color: string;
}

// Derive the WebSocket origin from the configured HTTP API_URL by
// swapping the scheme. The token comes from the active auth session
// — we send it as a `?token=` query param (server's `/sync` path is
// the only `?token=` allow-listed endpoint outside /ws).
function wsOrigin(): string {
  if (API_URL.startsWith('https://')) return 'wss://' + API_URL.slice('https://'.length);
  if (API_URL.startsWith('http://')) return 'ws://' + API_URL.slice('http://'.length);
  return API_URL;
}

// Stable colour assignment per username. Distinct, theme-agnostic
// hex strings; y-codemirror.next uses these for remote-cursor
// decorations. Pulled from a small curated palette so two
// concurrent peers are visually distinguishable even on busy docs.
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
  status = $state<ConnStatus>('idle');
  peers = $state<Peer[]>([]);
  lastError = $state<string | null>(null);

  // ---- plain owned by Yjs ----
  ydoc: Y.Doc;
  ytext: Y.Text;
  provider: WebsocketProvider | null = null;
  undoManager: Y.UndoManager;
  private awarenessChangeHandler: (() => void) | null = null;
  private statusHandler: ((ev: { status: string }) => void) | null = null;
  /** key identifying the currently-open note; used to guard against
   *  late events from a previous open(). */
  private currentKey: string | null = null;

  constructor() {
    this.ydoc = new Y.Doc();
    this.ytext = this.ydoc.getText('content');
    this.undoManager = new Y.UndoManager(this.ytext);
  }

  /**
   * Open a connection for (vaultID, noteID) under the given session
   * token. Idempotent on the same target; switching targets tears the
   * existing provider down and constructs a new one. Returns when
   * the underlying socket reports the first sync — calls do NOT
   * block on a network round trip though, so callers should treat
   * the returned promise as "best-effort open".
   */
  open(vaultID: string, noteID: string, token: string, user: SessionUser): void {
    const key = `${vaultID}/${noteID}`;
    if (this.currentKey === key && this.provider) return;
    this.close();

    this.currentKey = key;
    this.status = 'connecting';
    this.lastError = null;

    // y-websocket appends `room` to serverUrl as a path segment, then
    // adds `params` as a querystring. Build pieces so the final URL
    // matches the server's expected /sync route.
    const serverUrl = `${wsOrigin()}/api/vaults/${vaultID}/notes`;
    const room = `${encodeURIComponent(noteID)}/sync`;
    this.provider = new WebsocketProvider(serverUrl, room, this.ydoc, {
      params: { token },
      // We do NOT pass `connect: false` — auto-connect on construct.
    });

    // Awareness: publish our local user state so peers can label our
    // cursor. y-codemirror.next consumes this via 'user.name' /
    // 'user.color' / 'user.colorLight'.
    this.provider.awareness.setLocalStateField('user', {
      name: user.display_name || user.username,
      color: pickColor(user.username),
      colorLight: pickColor(user.username) + '33', // ~20% alpha
    });

    this.statusHandler = (ev) => {
      const s = ev.status;
      if (s === 'connected') this.status = 'connected';
      else if (s === 'connecting') this.status = 'connecting';
      else this.status = 'disconnected';
    };
    this.provider.on('status', this.statusHandler);

    this.awarenessChangeHandler = () => {
      this.peers = collectPeers(this.provider!);
    };
    this.provider.awareness.on('change', this.awarenessChangeHandler);
  }

  /** Tear down the active provider + doc and reset all reactive
   *  state. Safe to call repeatedly. */
  close(): void {
    if (this.provider) {
      if (this.awarenessChangeHandler) {
        try { this.provider.awareness.off('change', this.awarenessChangeHandler); } catch {}
      }
      if (this.statusHandler) {
        try { this.provider.off('status', this.statusHandler); } catch {}
      }
      try { this.provider.destroy(); } catch {}
      this.provider = null;
    }
    // The ydoc lives across the open/close cycle — destroying it
    // would orphan the UndoManager + ytext we exposed to the editor
    // before close ran. Callers that need to fully release memory
    // construct a new EditorSession instead.
    this.peers = [];
    this.status = 'idle';
    this.currentKey = null;
    this.awarenessChangeHandler = null;
    this.statusHandler = null;
  }

  /** Hard-destroy: tears down everything including the Y.Doc. Use
   *  when navigating away from the editor entirely. */
  destroy(): void {
    this.close();
    try { this.undoManager.destroy(); } catch {}
    try { this.ydoc.destroy(); } catch {}
  }
}

function collectPeers(provider: WebsocketProvider): Peer[] {
  const out: Peer[] = [];
  const localID = provider.awareness.clientID;
  provider.awareness.getStates().forEach((state, clientID) => {
    if (clientID === localID) return;
    const user = (state as any).user;
    if (!user) return;
    out.push({ clientID, name: user.name ?? 'guest', color: user.color ?? '#888' });
  });
  return out;
}
