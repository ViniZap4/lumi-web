// App-level offline coordinator (web). No Yjs here — this module is
// part of the eager bundle; everything CRDT lives in the lazy editor
// chunk (lib/replica.ts, lib/editor-session.svelte.ts).
//
// Responsibilities:
//   - map books/accounts to replica scopes (server origin + user id);
//   - reactive "pending" bookkeeping per book (dirty replicas);
//   - conflict copies of the open note;
//   - LGPD wipes: sign-out, session.ended, vault.revoked, boot sweep —
//     each returns the unsent text so the UI can offer an export
//     before (sign-out) or right after (server-initiated) the wipe;
//   - note tombstones: a deleted note's replica becomes a conflict copy
//     when it had unsent edits, and is dropped either way, so a later
//     note with the same id never merges into the dead lineage.

import {
  offlineStore as defaultStore,
  scopeKey,
  type ConflictCopy,
  type OfflineStore,
  type ReplicaKey,
  type RescuedText,
} from './offline-store.ts';
import { accounts as defaultAccounts, type AccountRegistry } from './accounts.svelte.ts';
import { books as defaultBooks, type BooksStore } from './books.svelte.ts';
import type { NoteSummary } from './types.ts';

export interface AccountLike {
  server_url: string;
  user_id: string;
}

export interface OfflineDeps {
  store?: OfflineStore;
  accounts?: AccountRegistry;
  books?: BooksStore;
}

export interface Rescue {
  id: number;
  reason: 'session_ended' | 'revoked' | 'signed_out';
  items: RescuedText[];
}

export class OfflineCoordinator {
  /** `${scope}|${vaultID}` → note ids with unsent edits. */
  dirty = $state<Record<string, string[]>>({});
  /** Conflict copies of the watched book (all its notes). */
  conflicts = $state<ConflictCopy[]>([]);
  /** Unsent text taken off the disk by a server-initiated wipe, held in
   *  memory only until the user downloads or discards it. */
  rescues = $state<Rescue[]>([]);
  browserOnline = $state(typeof navigator === 'undefined' ? true : navigator.onLine !== false);

  readonly store: OfflineStore;
  private accounts: AccountRegistry;
  private books: BooksStore;
  private watched: { scope: string; vaultID: string } | null = null;
  private rescueSeq = 0;
  private refreshTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(deps: OfflineDeps = {}) {
    this.store = deps.store ?? defaultStore;
    this.accounts = deps.accounts ?? defaultAccounts;
    this.books = deps.books ?? defaultBooks;
    this.store.subscribe((scope, vaultID) => this.onStoreChange(scope, vaultID));
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => (this.browserOnline = true));
      window.addEventListener('offline', () => (this.browserOnline = false));
    }
  }

  // ---- scopes ----------------------------------------------------------------

  scopeOfAccount(a: AccountLike): string {
    return scopeKey(a.server_url, a.user_id);
  }

  /** Scope of the account the book for `vaultID` is bound to. */
  scopeForVault(vaultID: string): string | null {
    const b = this.books.bookForVault(vaultID);
    if (!b) return null;
    const a = this.accounts.get(this.books.accountKeyOf(b));
    return a?.user_id ? this.scopeOfAccount(a) : null;
  }

  keyFor(vaultID: string, noteID: string): ReplicaKey | null {
    const b = this.books.bookForVault(vaultID);
    if (!b) return null;
    const a = this.accounts.get(this.books.accountKeyOf(b));
    if (!a?.user_id) return null;
    return { origin: a.server_url, userID: a.user_id, vaultID, noteID };
  }

  // ---- pending -----------------------------------------------------------------

  /** Note ids of `vaultID` with unsent edits, minus `except`. */
  pendingNotes(vaultID: string, except: string | null = null): string[] {
    const scope = this.scopeForVault(vaultID);
    if (!scope) return [];
    const list = this.dirty[`${scope}|${vaultID}`] ?? [];
    return except ? list.filter((n) => n !== except) : list;
  }

  async refreshDirty(scope: string, vaultID: string): Promise<void> {
    const ids = (await this.store.dirtyReplicas(scope, vaultID)).map((r) => r.noteID).sort();
    const k = `${scope}|${vaultID}`;
    const prev = this.dirty[k] ?? [];
    if (prev.length === ids.length && prev.every((x, i) => x === ids[i])) return;
    const next = { ...this.dirty };
    if (ids.length) next[k] = ids;
    else delete next[k];
    this.dirty = next;
  }

  /** Load the dirty sets of every known book (boot). */
  async refreshAllDirty(): Promise<void> {
    const all = await this.store.listReplicas();
    const next: Record<string, string[]> = {};
    for (const r of all) if (r.dirty) (next[`${r.scope}|${r.vaultID}`] ??= []).push(r.noteID);
    for (const k of Object.keys(next)) next[k].sort();
    this.dirty = next;
  }

  private onStoreChange(scope: string, vaultID: string | null): void {
    const k = `${scope}|${vaultID ?? '*'}`;
    const t = this.refreshTimers.get(k);
    if (t) clearTimeout(t);
    this.refreshTimers.set(
      k,
      setTimeout(() => {
        this.refreshTimers.delete(k);
        if (vaultID) void this.refreshDirty(scope, vaultID);
        else void this.refreshAllDirty();
        if (this.watched && this.watched.scope === scope && (vaultID == null || this.watched.vaultID === vaultID)) {
          void this.reloadConflicts();
        }
      }, 30),
    );
  }

  // ---- conflicts -------------------------------------------------------------------

  async watchConflicts(vaultID: string | null): Promise<void> {
    const scope = vaultID ? this.scopeForVault(vaultID) : null;
    if (scope && vaultID && this.watched?.scope === scope && this.watched.vaultID === vaultID) return;
    this.watched = scope && vaultID ? { scope, vaultID } : null;
    await this.reloadConflicts();
  }

  async reloadConflicts(): Promise<void> {
    const w = this.watched;
    const list = w ? await this.store.listConflicts(w.scope, w.vaultID) : [];
    if (w === this.watched) this.conflicts = list;
  }

  async discardConflict(id: string): Promise<void> {
    await this.store.deleteConflict(id);
    await this.reloadConflicts();
  }

  // ---- cached text / lists -----------------------------------------------------------

  /** Text of the persisted replica of a note (offline preview). */
  async replicaText(vaultID: string, noteID: string): Promise<string | null> {
    const k = this.keyFor(vaultID, noteID);
    if (!k) return null;
    const r = await this.store.loadReplica(k, false);
    return r ? r.text : null;
  }

  async saveNotesCache(vaultID: string, list: NoteSummary[]): Promise<void> {
    const scope = this.scopeForVault(vaultID);
    if (scope) await this.store.putCache(scope, `notes:${vaultID}`, list);
  }

  async loadNotesCache(vaultID: string): Promise<{ at: number; list: NoteSummary[] } | null> {
    const scope = this.scopeForVault(vaultID);
    if (!scope) return null;
    const c = await this.store.getCache<NoteSummary[]>(scope, `notes:${vaultID}`);
    return c && Array.isArray(c.value) ? { at: c.at, list: c.value } : null;
  }

  // ---- tombstones ------------------------------------------------------------------------

  /** Notes deleted on the server (GET /changes `deleted`). */
  async onNotesDeleted(vaultID: string, ids: string[]): Promise<void> {
    if (!ids.length) return;
    const scope = this.scopeForVault(vaultID);
    if (!scope) return;
    const gone = new Set(ids);
    for (const r of await this.store.listReplicas(scope, vaultID)) {
      if (gone.has(r.noteID)) await this.dropDeleted(r.vaultID, r.noteID);
    }
  }

  /** A successful FULL note list is authoritative: replicas of notes
   *  missing from it were deleted (or renamed to a new id). */
  async onFullList(vaultID: string, list: NoteSummary[]): Promise<void> {
    const scope = this.scopeForVault(vaultID);
    if (!scope) return;
    const present = new Set(list.map((n) => n.id));
    for (const r of await this.store.listReplicas(scope, vaultID)) {
      if (!present.has(r.noteID)) await this.dropDeleted(r.vaultID, r.noteID);
    }
  }

  private async dropDeleted(vaultID: string, noteID: string): Promise<void> {
    const k = this.keyFor(vaultID, noteID);
    if (!k || this.store.isAttached(k)) return; // the open editor handles its own 4404
    const r = await this.store.loadReplica(k, false);
    if (!r) return;
    if (r.dirty && r.text !== '') {
      await this.store.addConflict({ scope: r.scope, vaultID, noteID, text: r.text, reason: 'deleted' });
    }
    await this.store.deleteReplica(k);
  }

  // ---- wipes (LGPD) ------------------------------------------------------------------------

  /** Unsent text of an account (sign-out warning / export). */
  async pendingForAccount(a: AccountLike): Promise<RescuedText[]> {
    const scope = this.scopeOfAccount(a);
    const out: RescuedText[] = (await this.store.dirtyReplicas(scope)).map((r) => ({
      vaultID: r.vaultID,
      noteID: r.noteID,
      text: r.text,
    }));
    for (const c of await this.store.listConflicts(scope)) {
      out.push({ vaultID: c.vaultID, noteID: c.noteID, title: c.title, text: c.text });
    }
    return out;
  }

  /** Wipe every replica, cache and conflict copy of an account. For a
   *  server-initiated end (session.ended) the unsent text is kept in
   *  memory for export; for a sign-out the caller already offered it. */
  async wipeAccount(a: AccountLike, reason: Rescue['reason']): Promise<RescuedText[]> {
    const items = await this.store.wipeScope(this.scopeOfAccount(a));
    if (items.length && reason !== 'signed_out') this.pushRescue(reason, items);
    return items;
  }

  async wipeVault(a: AccountLike, vaultID: string): Promise<RescuedText[]> {
    const items = await this.store.wipeVault(this.scopeOfAccount(a), vaultID);
    if (items.length) this.pushRescue('revoked', items);
    return items;
  }

  /** The account is (back) on this device: its scope may persist again. */
  allowAccount(a: AccountLike): void {
    this.store.allowScope(this.scopeOfAccount(a));
  }

  /** Boot: rows of accounts that left the device are swept. */
  async sweep(): Promise<void> {
    const known = new Set(this.accounts.list.filter((a) => a.user_id).map((a) => this.scopeOfAccount(a)));
    try {
      await this.store.sweepOrphans(known);
      await this.refreshAllDirty();
    } catch (e) {
      console.warn('offline: sweep failed', e);
    }
  }

  private pushRescue(reason: Rescue['reason'], items: RescuedText[]): void {
    this.rescues = [...this.rescues, { id: ++this.rescueSeq, reason, items }];
  }

  dismissRescue(id: number): void {
    this.rescues = this.rescues.filter((r) => r.id !== id);
  }
}

// ---- export helpers ---------------------------------------------------------------

/** One markdown file with every rescued text, headed by its origin. */
export function bundleMarkdown(items: RescuedText[]): string {
  if (items.length === 1) return items[0].text;
  return items
    .map((i) => `<!-- lumi: livro ${i.vaultID}, nota ${i.noteID} -->\n# ${i.title || i.noteID}\n\n${i.text}\n`)
    .join('\n---\n\n');
}

export function exportFilename(items: RescuedText[], now = new Date()): string {
  if (items.length === 1) return `${items[0].noteID.replace(/[^\w.-]+/g, '_')}.local.md`;
  return `lumi-pendentes-${now.toISOString().slice(0, 10)}.md`;
}

/** Hand a text file to the browser (no network, blob: URL). */
export function downloadText(filename: string, text: string): void {
  if (typeof document === 'undefined') return;
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const offline = new OfflineCoordinator();
