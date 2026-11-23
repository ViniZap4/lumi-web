// Builds EditorSessions for a (vault, note) of the active books, with
// the offline replica wired in. Shared by the editor view and the
// background flusher. Eager module: the Yjs/editor chunk is only
// imported on demand (`loadEditorSession`).

import { accounts } from './accounts.svelte.ts';
import { books } from './books.svelte.ts';
import { offline } from './offline.svelte.ts';
import { notes } from './notes.svelte.ts';
import { isAuthFailure, createNoteWsTicket, getNoteSnapshot, getNoteStateVector, getNote } from './api.ts';
import { makeServerProbe } from './lineage.ts';
import { serverLabel } from './serverurl.ts';
import type { ConflictCopy, ReplicaRecord } from './offline-store.ts';
import type {
  EditorSession,
  EditorSessionOptions,
  ServerProbe,
} from './editor-session.svelte.ts';
import type { SessionUser } from './types.ts';

type SessionCtor = typeof import('./editor-session.svelte.ts').EditorSession;

let ctorP: Promise<SessionCtor> | null = null;
export function loadEditorSession(): Promise<SessionCtor> {
  ctorP ??= import('./editor-session.svelte.ts').then((m) => m.EditorSession);
  return ctorP;
}

export interface SessionPlan {
  vaultID: string;
  noteID: string;
  token: string;
  user: SessionUser;
  options: EditorSessionOptions;
  /** The replica the session restores (null = fresh join). */
  initial: ReplicaRecord | null;
}

export interface PlanOpts {
  headless?: boolean;
  onConflict?: (c: ConflictCopy) => void;
  onAuthFailure?: () => void;
}

/**
 * Everything needed to construct a session on the book's account.
 * Returns a user-facing error string when that is impossible.
 */
export async function planSession(vaultID: string, noteID: string, o: PlanOpts = {}): Promise<SessionPlan | string> {
  const book = books.bookForVault(vaultID);
  const key = book ? books.accountKeyOf(book) : null;
  const acct = key ? accounts.get(key) : null;
  const user = key ? accounts.user(key) : null;
  if (!book || !key || !acct || !user) return 'Nenhuma conta deste aparelho está ligada a este livro.';
  const token = accounts.tokenFor(key);
  if (!token) return `Entre em ${serverLabel(acct.server_url)} para editar.`;
  const client = accounts.client(key);

  const rkey = offline.keyFor(vaultID, noteID);
  let initial: ReplicaRecord | null = null;
  if (rkey && offline.store.available) {
    try {
      initial = await offline.store.loadReplica(rkey);
    } catch {
      initial = null;
    }
  }
  const meta = notes.vaultID === vaultID ? notes.list.find((n) => n.id === noteID) : undefined;

  // Full probe (lineage gate): /snapshot + metadata. Ack confirmation:
  // GET /state-vector only (falls back to /snapshot on older servers).
  const probe: (full: boolean) => Promise<ServerProbe> = makeServerProbe({
    snapshot: () => getNoteSnapshot(vaultID, noteID),
    stateVector: () => getNoteStateVector(vaultID, noteID),
    note: () => getNote(vaultID, noteID),
  });

  const options: EditorSessionOptions = {
    serverUrl: acct.server_url,
    headless: o.headless,
    probeAuth: async () => {
      try {
        await client.me();
        return 'ok';
      } catch (e) {
        return isAuthFailure(e) ? 'unauthorized' : 'unknown';
      }
    },
    onAuthFailure: () => {
      accounts.markNeedsLogin(key, 'sessão expirada');
      o.onAuthFailure?.();
    },
    // Fresh single-use ticket per (re)connect; 404 → ?token= fallback.
    fetchTicket: () => createNoteWsTicket(vaultID, noteID),
    getToken: () => accounts.tokenFor(key),
    offline: rkey && offline.store.available
      ? {
          store: offline.store,
          key: rkey,
          initial,
          lineage: { epoch: meta?.crdt_epoch ?? null, createdAt: meta?.created_at ?? null },
          probe,
          onConflict: (c) => {
            void offline.reloadConflicts();
            o.onConflict?.(c);
          },
          title: () => (notes.vaultID === vaultID ? (notes.list.find((n) => n.id === noteID)?.title ?? null) : null),
        }
      : undefined,
  };
  return { vaultID, noteID, token, user, options, initial };
}

export function startSession(Ctor: SessionCtor, p: SessionPlan): EditorSession {
  return new Ctor(p.vaultID, p.noteID, p.token, p.user, p.options);
}

// ---- background flush ------------------------------------------------------------

const FLUSH_TIMEOUT_MS = 20_000;
let flushing: Promise<void> | null = null;

/**
 * Push persisted replicas of `vaultID` that still hold unsent edits,
 * one note at a time, through a headless session (same join + lineage
 * gate + confirmation as the editor). Skips `except` (the note open in
 * the editor). Re-entrant calls share the running flush.
 */
export function flushPending(vaultID: string, except: string | null = null): Promise<void> {
  if (flushing) return flushing;
  flushing = (async () => {
    try {
      const ids = offline.pendingNotes(vaultID, except);
      if (!ids.length) return;
      const Ctor = await loadEditorSession();
      for (const noteID of ids) {
        if (!offline.browserOnline) return;
        const plan = await planSession(vaultID, noteID, { headless: true });
        if (typeof plan === 'string' || !plan.initial) continue;
        const s = startSession(Ctor, plan);
        try {
          await waitSettled(s);
        } finally {
          s.destroy();
        }
      }
    } catch (e) {
      console.warn('offline: background flush failed', e);
    } finally {
      flushing = null;
    }
  })();
  return flushing;
}

function waitSettled(s: EditorSession): Promise<void> {
  return new Promise((resolve) => {
    const started = Date.now();
    const tick = () => {
      if (s.isDestroyed || s.stopped || !s.unsent || Date.now() - started > FLUSH_TIMEOUT_MS) {
        resolve();
        return;
      }
      if (s.liveSynced) void s.confirmNow();
      setTimeout(tick, 500);
    };
    setTimeout(tick, 300);
  });
}

// ---- task toggle from the reader -------------------------------------------

const TOGGLE_JOIN_MS = 8_000;

/**
 * Toggle task `index` of a note that is NOT open in the editor: join
 * the note's live doc headless (empty doc, wait for the server's
 * SyncStep2 — CRDT client protocol §2), locate the marker in the
 * *current* CRDT text and apply a single-character ranged change in
 * one transaction. Returns the new text, or an error string.
 */
export async function toggleTaskHeadless(vaultID: string, noteID: string, index: number): Promise<{ text: string } | { error: string }> {
  const { taskToggle } = await import('./markdown.ts');
  const Ctor = await loadEditorSession();
  const plan = await planSession(vaultID, noteID, { headless: true });
  if (typeof plan === 'string') return { error: plan };
  const s = startSession(Ctor, plan);
  try {
    const started = Date.now();
    while (!s.editable && !s.stopped && !s.isDestroyed && Date.now() - started < TOGGLE_JOIN_MS) {
      await new Promise((r) => setTimeout(r, 80));
    }
    if (!s.editable || s.isDestroyed) return { error: 'Sem conexão com o editor ao vivo — tente de novo.' };
    if (s.emptyAtSync) return { error: 'Abra a nota no editor para inicializar a edição ao vivo.' };
    const change = taskToggle(s.ytext.toString(), index);
    if (!change) return { error: 'Tarefa não encontrada (a nota mudou?).' };
    s.ydoc.transact(() => {
      s.ytext.delete(change.from, change.to - change.from);
      s.ytext.insert(change.from, change.insert);
    });
    const text = s.ytext.toString();
    // Let the update reach the server (or the offline replica).
    const sent = Date.now();
    while (s.unsent && !s.isDestroyed && Date.now() - sent < 4_000) {
      if (s.liveSynced) void s.confirmNow();
      await new Promise((r) => setTimeout(r, 150));
    }
    return { text };
  } finally {
    s.destroy();
  }
}
