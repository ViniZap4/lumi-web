// Sync coordinator (SPEC-LIVROS §3.3, §4; web / W3).
//
// Owns one FeedConnection per account and turns feed events into book
// state: heads, cursors, catch-up via GET /changes, access changes,
// revocations and session loss. Also collects REST health per account
// and the active editor session, and exposes `statusOf(book)` — the
// pure `bookStatus` reducer over those inputs.
//
// Isolation rule: every piece of state is keyed by account key or by
// book; an event from account A is only applied to books BOUND to A.
// Events for a vault_id reached through another account (an
// alternate, §2.4.4) are ignored.
//
// Degradation: when an account's server has no feed (`disabled`),
// books on it show "Offline — feed indisponível neste servidor", the
// open book's note list is refreshed every POLL_MS while the tab is
// visible, and "Tentar agora" refreshes on demand. The feed re-probes
// /api/info every few minutes and switches over by itself once the
// server gains the endpoint.

import { untrack } from 'svelte';
import { FeedConnection, type FeedEvent, type FeedState, type FeedStateInfo } from './feed.ts';
import {
  bookStatus,
  type BookStatus,
  type CatchUpInput,
  type EditorInput,
  type RestHealthInput,
} from './bookstatus.ts';
import { accounts as defaultAccounts, type AccountRegistry } from './accounts.svelte.ts';
import { books as defaultBooks, type BooksStore } from './books.svelte.ts';
import { notes as defaultNotes } from './notes.svelte.ts';
import type { Book } from './books-model.ts';
import type { RestOutcome } from './api.ts';
import { ApiError } from './types.ts';
import type { EditorSession } from './editor-session.svelte.ts';

export const POLL_MS = 60_000;
const MAX_ERRORS = 5;

export interface FeedView {
  state: FeedState;
  reason: string | null;
  since: number;
}

export interface BookError {
  at: number;
  message: string;
}

interface NotesLike {
  vaultID: string | null;
  refresh(): Promise<void>;
  applyChanges(vaultID: string, changed: any[], deleted: Array<{ id: string }>): boolean;
}

export interface SyncDeps {
  accounts?: AccountRegistry;
  books?: BooksStore;
  notes?: NotesLike;
  fetch?: typeof fetch;
  feedFactory?: (opts: ConstructorParameters<typeof FeedConnection>[0]) => FeedConnection;
  now?: () => number;
  /** Disable timers/window listeners (tests). */
  headless?: boolean;
}

const idleCatchUp = (): CatchUpInput => ({ state: 'idle', failures: 0, reason: null, cursor: 0, head: 0 });

export class SyncCoordinator {
  feeds = $state<Record<string, FeedView>>({});
  health = $state<Record<string, RestHealthInput>>({});
  catchUp = $state<Record<string, CatchUpInput>>({});
  errors = $state<Record<string, BookError[]>>({});
  lastSyncedAt = $state<Record<string, number>>({});
  /** Active editor session (only one at a time on the web). */
  editor = $state<{ vaultID: string; session: EditorSession } | null>(null);

  private conns = new Map<string, FeedConnection>();
  private running = new Set<string>(); // book ids with a catch-up in flight
  private accounts: AccountRegistry;
  private books: BooksStore;
  private notes: NotesLike;
  private deps: SyncDeps;
  private now: () => number;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private stopEffects: (() => void) | null = null;
  private onOnline = () => this.retryAll();
  private onOffline = () => {
    for (const a of this.accounts.list) this.setHealth(a.key, 'network', undefined, 'navegador offline');
  };

  constructor(deps: SyncDeps = {}) {
    this.deps = deps;
    this.accounts = deps.accounts ?? defaultAccounts;
    this.books = deps.books ?? defaultBooks;
    this.notes = deps.notes ?? defaultNotes;
    this.now = deps.now ?? Date.now;
  }

  // ---- lifecycle -------------------------------------------------------------

  start(): void {
    this.accounts.setHooks({
      onAdded: (k) => this.restartFeed(k),
      onNeedsLogin: (k) => this.stopFeed(k, 'auth_dead', 'precisa entrar'),
      onRemoved: (k) => {
        this.stopFeed(k);
        this.forgetAccount(k);
        this.books.removeAccount(k);
      },
      onOutcome: (k, o, e) => this.setHealth(k, o, e),
    });
    for (const a of this.accounts.list) {
      if (a.status === 'ok') this.restartFeed(a.key);
      else this.setFeed(a.key, 'auth_dead', { reason: a.statusReason ?? 'precisa entrar' });
    }
    if (this.deps.headless) return;
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.onOnline);
      window.addEventListener('offline', this.onOffline);
    }
    this.pollTimer = setInterval(() => this.pollTick(), POLL_MS);
    // last_synced_at = last time a book reached "Atualizado" (§4.2).
    this.stopEffects = $effect.root(() => {
      $effect(() => {
        const ups: string[] = [];
        for (const b of this.books.list) if (this.statusOf(b).state === 'up_to_date') ups.push(b.id);
        untrack(() => {
          const t = this.now();
          const next = { ...this.lastSyncedAt };
          for (const id of ups) next[id] = t;
          if (ups.length) this.lastSyncedAt = next;
        });
      });
    });
  }

  stop(): void {
    for (const k of [...this.conns.keys()]) this.stopFeed(k);
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
    this.stopEffects?.();
    this.stopEffects = null;
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.onOnline);
      window.removeEventListener('offline', this.onOffline);
    }
  }

  restartFeed(key: string): void {
    this.stopFeed(key);
    const a = this.accounts.get(key);
    if (!a || a.status !== 'ok') return;
    const opts = {
      serverUrl: a.server_url,
      getToken: () => this.accounts.tokenFor(key),
      onState: (s: FeedState, info: FeedStateInfo) => this.onFeedState(key, s, info),
      onEvent: (ev: FeedEvent) => void this.onEvent(key, ev),
      fetch: this.deps.fetch,
    };
    const conn = this.deps.feedFactory ? this.deps.feedFactory(opts) : new FeedConnection(opts);
    this.conns.set(key, conn);
    this.setFeed(key, 'connecting', {});
    conn.start();
  }

  stopFeed(key: string, state?: FeedState, reason?: string): void {
    const c = this.conns.get(key);
    if (c) c.stop();
    this.conns.delete(key);
    if (state) this.setFeed(key, state, { reason });
  }

  /** "Tentar agora": reconnect feeds and re-run REST for the open book. */
  retryAll(): void {
    for (const a of this.accounts.list) {
      if (a.status !== 'ok') continue;
      const c = this.conns.get(a.key);
      if (c) c.retryNow();
      else this.restartFeed(a.key);
    }
    void this.books.refreshAll();
    if (this.notes.vaultID) void this.notes.refresh();
  }

  retryBook(book: Book): void {
    const key = this.books.accountKeyOf(book);
    this.catchUp = { ...this.catchUp, [book.id]: { ...this.cu(book.id), state: 'idle', failures: 0, reason: null } };
    this.health = { ...this.health, [key]: { last: null, nonTransientFailures: 0, reason: null } };
    const c = this.conns.get(key);
    if (c) c.retryNow();
    else this.restartFeed(key);
    void this.books.refreshAccount(key);
    if (this.notes.vaultID === book.vault_id) void this.notes.refresh();
  }

  setEditor(vaultID: string, session: EditorSession | null): void {
    if (session) this.editor = { vaultID, session };
    else if (this.editor?.vaultID === vaultID || this.editor?.session.isDestroyed) this.editor = null;
  }

  // ---- derived ---------------------------------------------------------------

  feedOf(key: string): FeedView | null {
    return this.feeds[key] ?? null;
  }

  statusOf(book: Book): BookStatus {
    const key = this.books.accountKeyOf(book);
    const acct = this.accounts.get(key);
    const feed = this.feeds[key];
    const accountFeed =
      !acct || acct.status !== 'ok' ? null : { state: feed?.state ?? ('connecting' as FeedState) };
    return bookStatus(
      {
        kind: 'bound',
        vault_id: book.vault_id ?? null,
        can_edit: this.books.canEdit[book.vault_id] ?? true,
        revoked: this.books.revoked[book.id] ?? null,
      },
      accountFeed,
      this.cu(book.id),
      this.editorInput(book.vault_id),
      this.health[key] ?? { last: null, nonTransientFailures: 0, reason: null },
    );
  }

  editorInput(vaultID: string): EditorInput {
    const e = this.editor;
    if (!e || e.vaultID !== vaultID || e.session.isDestroyed) return { state: 'closed', pending: false };
    return { state: e.session.protocolState, pending: e.session.pending };
  }

  private cu(bookID: string): CatchUpInput {
    return this.catchUp[bookID] ?? idleCatchUp();
  }

  // ---- state updates ---------------------------------------------------------

  private setFeed(key: string, state: FeedState, info: FeedStateInfo): void {
    const prev = this.feeds[key];
    this.feeds = {
      ...this.feeds,
      [key]: { state, reason: info.reason ?? null, since: prev?.state === state ? prev.since : this.now() },
    };
  }

  private onFeedState(key: string, s: FeedState, info: FeedStateInfo): void {
    this.setFeed(key, s, info);
    if (s === 'auth_dead') this.accounts.markNeedsLogin(key, info.reason ?? 'sessão encerrada');
  }

  private setHealth(key: string, o: RestOutcome, err?: ApiError, reason?: string): void {
    const prev = this.health[key] ?? { last: null, nonTransientFailures: 0, reason: null };
    const nonTransient = o === 'server' || o === 'parse';
    const next: RestHealthInput = {
      last: o,
      nonTransientFailures: nonTransient ? prev.nonTransientFailures + 1 : o === 'ok' ? 0 : prev.nonTransientFailures,
      reason: o === 'ok' ? null : (reason ?? err?.detail ?? err?.code ?? prev.reason ?? null),
    };
    if (prev.last === next.last && prev.nonTransientFailures === next.nonTransientFailures) return;
    this.health = { ...this.health, [key]: next };
    if (o !== 'ok') {
      const b = this.books.active;
      if (b && this.books.accountKeyOf(b) === key) this.logError(b.id, next.reason ?? o);
    }
  }

  private logError(bookID: string, message: string): void {
    const list = [...(this.errors[bookID] ?? []), { at: this.now(), message }].slice(-MAX_ERRORS);
    this.errors = { ...this.errors, [bookID]: list };
  }

  private forgetAccount(key: string): void {
    const f = { ...this.feeds };
    delete f[key];
    this.feeds = f;
    const h = { ...this.health };
    delete h[key];
    this.health = h;
  }

  /** Book bound to THIS account for `vaultID`, else null. */
  private boundBook(key: string, vaultID: string): Book | null {
    const b = this.books.bookForVault(vaultID);
    return b && this.books.accountKeyOf(b) === key ? b : null;
  }

  // ---- events ----------------------------------------------------------------

  async onEvent(key: string, ev: FeedEvent): Promise<void> {
    switch (ev.type) {
      case 'hello': {
        const listed = new Set(ev.vaults.map((v) => v.vault_id));
        let unknown = false;
        for (const v of ev.vaults) {
          const b = this.boundBook(key, v.vault_id);
          if (!b) {
            if (!this.books.bookForVault(v.vault_id)) unknown = true;
            continue; // alternate: ignore
          }
          this.books.setCanEdit(v.vault_id, v.can_edit);
          this.books.clearRevoked(v.vault_id);
          this.setHead(b, v.seq);
        }
        // A book bound to this account missing from hello = revoked.
        for (const b of this.books.list) {
          if (this.books.accountKeyOf(b) === key && !listed.has(b.vault_id)) {
            this.books.markRevoked(b.vault_id, key, 'removed');
          }
        }
        if (unknown) await this.books.refreshAccount(key);
        await Promise.all(
          this.books.list.filter((b) => this.books.accountKeyOf(b) === key).map((b) => this.maybeCatchUp(b)),
        );
        return;
      }
      case 'vault.head': {
        const b = this.boundBook(key, ev.vault_id);
        if (!b) return;
        this.setHead(b, ev.seq);
        await this.maybeCatchUp(b);
        return;
      }
      case 'vault.access': {
        const b = this.boundBook(key, ev.vault_id);
        if (b) {
          this.books.setCanEdit(ev.vault_id, ev.can_edit);
          this.books.clearRevoked(ev.vault_id);
        } else if (!this.books.bookForVault(ev.vault_id)) {
          await this.books.refreshAccount(key, true);
        }
        return;
      }
      case 'vault.updated': {
        const b = this.boundBook(key, ev.vault_id);
        if (!b) return;
        try {
          const v = await this.accounts.client(key).getVault(ev.vault_id);
          if (this.boundBook(key, ev.vault_id)) this.books.applyVaultUpdate(ev.vault_id, v);
          if (ev.fields.includes('federation') && v.federation?.status === 'severed') {
            this.books.pushBanner({
              kind: 'severed',
              vault_id: ev.vault_id,
              text: `Este livro deixou de sincronizar com ${v.federation.home_url ?? 'a origem'}.`,
            });
          }
        } catch (e) {
          this.logError(b.id, `GET vault: ${e instanceof Error ? e.message : String(e)}`);
        }
        return;
      }
      case 'vault.revoked': {
        const b = this.boundBook(key, ev.vault_id);
        if (!b) return;
        this.books.markRevoked(ev.vault_id, key, ev.reason);
        this.logError(b.id, `acesso revogado (${ev.reason})`);
        return;
      }
      case 'session.ended':
        this.accounts.markNeedsLogin(key, `sessão encerrada (${ev.reason})`);
        return;
      case 'reconnect':
        return; // handled by FeedConnection
    }
  }

  private setHead(b: Book, seq: number): void {
    const cur = this.cu(b.id);
    if (seq === cur.head) return;
    this.catchUp = { ...this.catchUp, [b.id]: { ...cur, head: seq } };
  }

  /**
   * Bring the book's cursor up to its head. The web keeps a list cache
   * only for the OPEN book (notes store); for other books there is
   * nothing to update, so the cursor simply follows the head and the
   * full list is fetched when the book is opened.
   */
  async maybeCatchUp(b: Book): Promise<void> {
    const cur = this.cu(b.id);
    if (cur.head <= cur.cursor || this.running.has(b.id)) return;
    const key = this.books.accountKeyOf(b);
    if (this.notes.vaultID !== b.vault_id) {
      this.catchUp = { ...this.catchUp, [b.id]: { ...cur, cursor: cur.head, state: 'idle', failures: 0, reason: null } };
      return;
    }
    this.running.add(b.id);
    this.catchUp = { ...this.catchUp, [b.id]: { ...cur, state: 'running' } };
    let cursor = cur.cursor;
    try {
      const client = this.accounts.client(key);
      for (let page = 0; page < 100; page++) {
        const r = await client.getChanges(b.vault_id, cursor);
        if (!this.boundBook(key, b.vault_id)) return; // rebound meanwhile
        this.notes.applyChanges(b.vault_id, r.notes ?? [], r.deleted ?? []);
        const last = Math.max(
          cursor,
          ...(r.notes ?? []).map((n) => n.change_seq ?? 0),
          ...(r.deleted ?? []).map((d) => d.seq ?? 0),
        );
        cursor = r.more ? last : Math.max(last, r.head ?? last);
        if (!r.more) break;
      }
      this.finishCatchUp(b.id, cursor);
    } catch (e) {
      if (e instanceof ApiError && e.status === 410) {
        // resync_required: head first, then the full list (§3.5).
        const head = typeof e.body.head === 'number' ? e.body.head : this.cu(b.id).head;
        await this.fullReload(b, head);
      } else if (e instanceof ApiError && (e.status === 404 || e.status === 405 || e.status === 501)) {
        // Server without /changes yet: full list is the fallback.
        await this.fullReload(b, this.cu(b.id).head);
      } else {
        const now = this.cu(b.id);
        const reason = e instanceof ApiError ? (e.detail ?? e.code) : e instanceof Error ? e.message : 'erro';
        this.catchUp = {
          ...this.catchUp,
          [b.id]: { ...now, state: 'failed', failures: now.failures + 1, reason: `changes: ${reason}` },
        };
        this.logError(b.id, `changes: ${reason}`);
      }
    } finally {
      this.running.delete(b.id);
    }
    // A head that moved during the catch-up triggers another round —
    // only if this round made progress (no tight loop on a stuck head).
    const after = this.cu(b.id);
    if (after.state === 'idle' && after.head > after.cursor && after.cursor > cur.cursor) {
      await this.maybeCatchUp(b);
    }
  }

  private async fullReload(b: Book, head: number): Promise<void> {
    await this.notes.refresh();
    this.finishCatchUp(b.id, head);
  }

  private finishCatchUp(bookID: string, cursor: number): void {
    const now = this.cu(bookID);
    this.catchUp = {
      ...this.catchUp,
      [bookID]: { ...now, cursor, head: Math.max(now.head, cursor), state: 'idle', failures: 0, reason: null },
    };
  }

  /** Book opened: the notes store just did (or will do) a full list. */
  onBookOpened(b: Book): void {
    const cur = this.cu(b.id);
    this.catchUp = { ...this.catchUp, [b.id]: { ...cur, cursor: cur.head, state: 'idle', failures: 0, reason: null } };
  }

  /** "Trocar servidor": seq is per server — cursor back to 0. */
  resetBook(bookID: string): void {
    this.catchUp = { ...this.catchUp, [bookID]: idleCatchUp() };
  }

  private pollTick(): void {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    const b = this.books.active;
    if (!b || this.notes.vaultID !== b.vault_id) return;
    const f = this.feeds[this.books.accountKeyOf(b)];
    if (f?.state === 'disabled') void this.notes.refresh();
  }
}

export const sync = new SyncCoordinator();
