// Offline persistence for server-bound books (web).
//
// One IndexedDB database, `lumi-offline`, separate from the `lumi`
// database that holds accounts/tokens (storage.ts) so it can be wiped
// wholesale without touching credentials, and so its schema can move
// independently. Object stores:
//
//   - `replicas`  — one row per (server origin, user id, vault, note):
//                   the note's Y.Doc as a full lib0-v1 update, plus the
//                   bookkeeping needed for pending/lineage/eviction.
//   - `cache`     — last-known lists for offline navigation: the
//                   account's vault DTOs (`vaults`) and each book's
//                   note summaries (`notes:<vault>`). Always shown as
//                   stale.
//   - `conflicts` — recoverable copies of local text that could not be
//                   merged (lineage mismatch, note deleted on the
//                   server). Kept until the user discards them or the
//                   account is signed out.
//
// Why not y-indexeddb: it opens one IndexedDB *database per document*
// with no room for our metadata (lineage stamp, unsent tracking,
// account scope, LRU timestamps), so per-account wipes would need
// `indexedDB.databases()` (not universally available) and eviction
// would be blind. It also starts persisting the moment it is attached,
// while the protocol wants persistence only after the first SyncStep2.
// A single database with a merge-on-write row is ~200 lines and keeps
// every invariant in one transaction.
//
// Scoping (accounts never mix): every row carries `scope` =
// `<normalised server origin>|<user id>`. The user id, not the
// username, so a username re-registered by someone else after an
// erasure never sees the previous owner's replicas.
//
// SECURITY / LGPD: IndexedDB is per-origin PLAINTEXT on disk. Any
// script running in this origin (XSS) and anyone with the browser
// profile can read note text stored here. Defences: strict CSP
// (`script-src 'self'`), no runtime-loaded code, and wiping: sign-out,
// `session.ended` and `vault.revoked` delete the affected rows; scopes
// whose account is no longer on this device are swept at boot. Tokens
// are NOT stored here (they stay sealed in storage.ts as before).
//
// This module deliberately has no Yjs dependency (it is imported by
// the eagerly-loaded notes/books stores). CRDT merging happens inside
// the write transaction through a caller-supplied `merge` callback,
// supplied by lib/replica.ts from the lazily-loaded editor chunk.

export const OFFLINE_DB = 'lumi-offline';
const OFFLINE_DB_VERSION = 1;

/** Total bytes of replica state kept before LRU eviction kicks in. */
export const DEFAULT_MAX_BYTES = 50 * 1024 * 1024;
/** Maximum number of replicas kept. */
export const DEFAULT_MAX_REPLICAS = 400;
/** Dirty replicas of an account that left the device are kept this
 *  long (so signing in again can still push them), then swept. */
export const ORPHAN_DIRTY_RETENTION_MS = 14 * 24 * 3600 * 1000;

export interface ReplicaKey {
  /** Normalised server URL of the book's account. */
  origin: string;
  /** Server-side user id of the account (not the username). */
  userID: string;
  vaultID: string;
  noteID: string;
}

/**
 * What identifies the CRDT lineage a replica belongs to. Every field is
 * optional: lib/lineage.ts decides with whatever the server exposes.
 */
export interface LineageStamp {
  /** Server CRDT epoch/generation, when the server exposes one. */
  epoch?: string | null;
  /** Note `created_at` from the REST metadata (fallback heuristic). */
  createdAt?: string | null;
}

export interface ReplicaRecord {
  id: string;
  scope: string;
  vaultID: string;
  noteID: string;
  /** Full Y.Doc state (Y.encodeStateAsUpdate, lib0 v1). */
  state: Uint8Array;
  /** Plain text of `content` at the last write (preview/export without
   *  loading Yjs). */
  text: string;
  /** Yjs clientIDs that authored edits in this replica on this device. */
  localClients: number[];
  /** Highest server state vector confirmed for this note (clientID →
   *  clock). Local edits are unsent while a local client's clock in
   *  `state` exceeds the clock here. */
  ackSV: Record<string, number>;
  /** Cached `unsent` verdict (derived from state/localClients/ackSV). */
  dirty: boolean;
  lineage: LineageStamp;
  bytes: number;
  createdAt: number;
  updatedAt: number;
  lastOpenedAt: number;
}

export interface ConflictCopy {
  id: string;
  scope: string;
  vaultID: string;
  noteID: string;
  title?: string | null;
  text: string;
  reason: 'lineage' | 'deleted' | 'revoked';
  at: number;
}

export interface RescuedText {
  vaultID: string;
  noteID: string;
  title?: string | null;
  text: string;
}

/** Result of the write-time merge (computed by lib/replica.ts). */
export interface MergeResult {
  state: Uint8Array;
  text: string;
  dirty: boolean;
}

export interface ReplicaWrite {
  /** Merge the stored row (null = none) with the caller's state. Runs
   *  synchronously inside the IndexedDB transaction. */
  merge: (stored: ReplicaRecord | null, localClients: number[], ackSV: Record<string, number>) => MergeResult;
  localClients: number[];
  ackSV?: Record<string, number>;
  lineage?: LineageStamp;
}

/** A live writer (open editor) that must stop persisting when its
 *  scope is wiped. */
export interface AttachedReplica {
  /** Stop persisting; return the current text if it holds unsent edits. */
  kill(): RescuedText | null;
}

// ---- keys --------------------------------------------------------------------

export function scopeKey(origin: string, userID: string): string {
  return `${encodeURIComponent(origin)}|${encodeURIComponent(userID)}`;
}

export function replicaID(k: ReplicaKey): string {
  return `${scopeKey(k.origin, k.userID)}|${encodeURIComponent(k.vaultID)}|${encodeURIComponent(k.noteID)}`;
}

function cacheID(scope: string, name: string): string {
  return `${scope}|${name}`;
}

/** Max-merge two state vectors (plain records). */
export function maxSV(a: Record<string, number>, b: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = { ...a };
  for (const [k, v] of Object.entries(b)) if ((out[k] ?? 0) < v) out[k] = v;
  return out;
}

// ---- IndexedDB plumbing --------------------------------------------------------

type StoreName = 'replicas' | 'cache' | 'conflicts';

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('transaction aborted'));
  });
}

export interface CacheEntry<T> {
  at: number;
  value: T;
}

export interface OfflineStoreOptions {
  maxBytes?: number;
  maxReplicas?: number;
  now?: () => number;
}

export class OfflineStore {
  private dbp: Promise<IDBDatabase> | null;
  private attached = new Map<string, Set<AttachedReplica>>();
  readonly maxBytes: number;
  readonly maxReplicas: number;
  private now: () => number;
  /** Scopes wiped in this page: writes for them are refused (a late
   *  debounced save must not resurrect a wiped replica). Cleared when
   *  the account signs in again (`allowScope`). */
  private wiped = new Set<string>();
  private listeners = new Set<(scope: string, vaultID: string | null) => void>();

  constructor(factory: IDBFactory | null, opts: OfflineStoreOptions = {}, name = OFFLINE_DB) {
    this.maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
    this.maxReplicas = opts.maxReplicas ?? DEFAULT_MAX_REPLICAS;
    this.now = opts.now ?? Date.now;
    this.dbp = factory ? open(factory, name) : null;
    // A failed open (private mode, disabled storage) degrades to "no
    // offline persistence", never to an error in the UI.
    this.dbp?.catch(() => {
      this.dbp = null;
    });
  }

  /** False when IndexedDB is unavailable: nothing is persisted. */
  get available(): boolean {
    return this.dbp != null;
  }

  private async db(): Promise<IDBDatabase | null> {
    if (!this.dbp) return null;
    try {
      return await this.dbp;
    } catch {
      return null;
    }
  }

  allowScope(scope: string): void {
    this.wiped.delete(scope);
  }

  /** Notified after replica rows of (scope, vault) change (vault null =
   *  the whole scope). */
  subscribe(fn: (scope: string, vaultID: string | null) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(scope: string, vaultID: string | null): void {
    for (const fn of this.listeners) {
      try {
        fn(scope, vaultID);
      } catch {
        // listener errors never break a write
      }
    }
  }

  isAttached(k: ReplicaKey): boolean {
    return this.attached.has(replicaID(k));
  }

  // ---- replicas ----------------------------------------------------------------

  async loadReplica(k: ReplicaKey, touch = true): Promise<ReplicaRecord | null> {
    const db = await this.db();
    if (!db) return null;
    const id = replicaID(k);
    const tx = db.transaction('replicas', 'readwrite');
    const os = tx.objectStore('replicas');
    const rec = (await req(os.get(id))) as ReplicaRecord | undefined;
    if (rec && touch) os.put({ ...rec, lastOpenedAt: this.now() });
    await done(tx);
    return rec ?? null;
  }

  /** Merge-on-write: the stored row and the caller's state are merged
   *  by `w.merge` in the same transaction, so two tabs writing the same
   *  note never drop each other's edits. Returns the written row. */
  async saveReplica(k: ReplicaKey, w: ReplicaWrite): Promise<ReplicaRecord | null> {
    const scope = scopeKey(k.origin, k.userID);
    if (this.wiped.has(scope)) return null;
    const db = await this.db();
    if (!db) return null;
    const id = replicaID(k);
    const tx = db.transaction('replicas', 'readwrite');
    const os = tx.objectStore('replicas');
    let written: ReplicaRecord | null = null;
    const get = os.get(id);
    get.onsuccess = () => {
      const stored = (get.result as ReplicaRecord | undefined) ?? null;
      const localClients = Array.from(new Set([...(stored?.localClients ?? []), ...w.localClients]));
      const ackSV = maxSV(stored?.ackSV ?? {}, w.ackSV ?? {});
      const m = w.merge(stored, localClients, ackSV);
      const t = this.now();
      written = {
        id,
        scope,
        vaultID: k.vaultID,
        noteID: k.noteID,
        state: m.state,
        text: m.text,
        localClients,
        ackSV,
        dirty: m.dirty,
        lineage: { ...(stored?.lineage ?? {}), ...stripNull(w.lineage ?? {}) },
        bytes: m.state.byteLength + m.text.length * 2,
        createdAt: stored?.createdAt ?? t,
        updatedAt: t,
        lastOpenedAt: t,
      };
      os.put(written);
    };
    await done(tx);
    this.emit(scope, k.vaultID);
    return written;
  }

  async deleteReplica(k: ReplicaKey): Promise<void> {
    const db = await this.db();
    if (!db) return;
    const tx = db.transaction('replicas', 'readwrite');
    tx.objectStore('replicas').delete(replicaID(k));
    await done(tx);
    this.emit(scopeKey(k.origin, k.userID), k.vaultID);
  }

  async listReplicas(scope?: string, vaultID?: string): Promise<ReplicaRecord[]> {
    const db = await this.db();
    if (!db) return [];
    const all = (await req(db.transaction('replicas').objectStore('replicas').getAll())) as ReplicaRecord[];
    return all.filter((r) => (scope == null || r.scope === scope) && (vaultID == null || r.vaultID === vaultID));
  }

  async dirtyReplicas(scope: string, vaultID?: string): Promise<ReplicaRecord[]> {
    return (await this.listReplicas(scope, vaultID)).filter((r) => r.dirty);
  }

  /**
   * LRU eviction: drop CLEAN replicas, least recently opened first,
   * until both caps hold. Never drops a dirty replica or one that is
   * open right now (`attached`). Returns the evicted ids.
   */
  async evict(): Promise<string[]> {
    const db = await this.db();
    if (!db) return [];
    const all = await this.listReplicas();
    let bytes = all.reduce((s, r) => s + r.bytes, 0);
    let count = all.length;
    if (bytes <= this.maxBytes && count <= this.maxReplicas) return [];
    const victims = all
      .filter((r) => !r.dirty && !this.attached.has(r.id))
      .sort((a, b) => a.lastOpenedAt - b.lastOpenedAt);
    const out: string[] = [];
    for (const v of victims) {
      if (bytes <= this.maxBytes && count <= this.maxReplicas) break;
      out.push(v.id);
      bytes -= v.bytes;
      count--;
    }
    if (!out.length) return out;
    const tx = db.transaction('replicas', 'readwrite');
    const os = tx.objectStore('replicas');
    // Re-check inside the transaction: a concurrent write may have made
    // a victim dirty since we listed it.
    for (const id of out) {
      const g = os.get(id);
      g.onsuccess = () => {
        const r = g.result as ReplicaRecord | undefined;
        if (r && !r.dirty) os.delete(id);
      };
    }
    await done(tx);
    return out;
  }

  // ---- live writers --------------------------------------------------------------

  attach(k: ReplicaKey, a: AttachedReplica): () => void {
    const id = replicaID(k);
    let set = this.attached.get(id);
    if (!set) this.attached.set(id, (set = new Set()));
    set.add(a);
    return () => {
      const s = this.attached.get(id);
      s?.delete(a);
      if (s && s.size === 0) this.attached.delete(id);
    };
  }

  private killAttached(match: (id: string) => boolean): RescuedText[] {
    const out: RescuedText[] = [];
    for (const [id, set] of [...this.attached]) {
      if (!match(id)) continue;
      for (const a of set) {
        const r = a.kill();
        if (r) out.push(r);
      }
      this.attached.delete(id);
    }
    return out;
  }

  // ---- wipes -----------------------------------------------------------------------

  /**
   * Remove everything of one account (sign-out, session.ended). Returns
   * the text of every replica that still had unsent edits — the caller
   * offers it for export; it is NOT written anywhere.
   */
  async wipeScope(scope: string): Promise<RescuedText[]> {
    this.wiped.add(scope);
    const rescued = this.killAttached((id) => id.startsWith(scope + '|'));
    const db = await this.db();
    if (!db) return rescued;
    const reps = await this.listReplicas(scope);
    for (const r of reps) {
      if (r.dirty && !rescued.some((x) => x.vaultID === r.vaultID && x.noteID === r.noteID)) {
        rescued.push({ vaultID: r.vaultID, noteID: r.noteID, text: r.text });
      }
    }
    const conflicts = await this.listConflicts(scope);
    for (const c of conflicts) rescued.push({ vaultID: c.vaultID, noteID: c.noteID, title: c.title, text: c.text });
    await this.deleteWhere(db, (row: { scope?: string; id: string }) => row.scope === scope || row.id.startsWith(scope + '|'));
    this.emit(scope, null);
    return rescued;
  }

  /** Remove one book of one account (vault.revoked). */
  async wipeVault(scope: string, vaultID: string): Promise<RescuedText[]> {
    const prefix = `${scope}|${encodeURIComponent(vaultID)}|`;
    const rescued = this.killAttached((id) => id.startsWith(prefix));
    const db = await this.db();
    if (!db) return rescued;
    for (const r of await this.dirtyReplicas(scope, vaultID)) {
      if (!rescued.some((x) => x.noteID === r.noteID)) rescued.push({ vaultID, noteID: r.noteID, text: r.text });
    }
    for (const c of await this.listConflicts(scope, vaultID)) {
      rescued.push({ vaultID, noteID: c.noteID, title: c.title, text: c.text });
    }
    const notesCache = cacheID(scope, `notes:${vaultID}`);
    await this.deleteWhere(
      db,
      (row: { scope?: string; vaultID?: string; id: string }) =>
        (row.scope === scope && row.vaultID === vaultID) || row.id === notesCache,
    );
    this.emit(scope, vaultID);
    return rescued;
  }

  /**
   * Boot sweep: drop rows of accounts no longer on this device. Clean
   * replicas and caches go at once; dirty replicas and conflict copies
   * are kept for ORPHAN_DIRTY_RETENTION_MS so signing in again with the
   * same account can still push them.
   */
  async sweepOrphans(knownScopes: Set<string>): Promise<number> {
    const db = await this.db();
    if (!db) return 0;
    const cutoff = this.now() - ORPHAN_DIRTY_RETENTION_MS;
    return this.deleteWhere(db, (row: any) => {
      const scope: string = row.scope ?? String(row.id).split('|').slice(0, 2).join('|');
      if (knownScopes.has(scope)) return false;
      if (row.dirty === true) return (row.updatedAt ?? 0) < cutoff;
      if (row.reason) return (row.at ?? 0) < cutoff; // conflict copy
      return true;
    });
  }

  /** Drop everything (tests, "erase this device"). */
  async wipeAll(): Promise<void> {
    this.killAttached(() => true);
    const db = await this.db();
    if (!db) return;
    await this.deleteWhere(db, () => true);
  }

  private async deleteWhere(db: IDBDatabase, pred: (row: any) => boolean): Promise<number> {
    const stores: StoreName[] = ['replicas', 'cache', 'conflicts'];
    const tx = db.transaction(stores, 'readwrite');
    let n = 0;
    for (const s of stores) {
      const os = tx.objectStore(s);
      const cur = os.openCursor();
      cur.onsuccess = () => {
        const c = cur.result;
        if (!c) return;
        if (pred(c.value)) {
          c.delete();
          n++;
        }
        c.continue();
      };
    }
    await done(tx);
    return n;
  }

  // ---- caches ------------------------------------------------------------------------

  async putCache<T>(scope: string, name: string, value: T): Promise<void> {
    if (this.wiped.has(scope)) return;
    const db = await this.db();
    if (!db) return;
    const tx = db.transaction('cache', 'readwrite');
    tx.objectStore('cache').put({ id: cacheID(scope, name), scope, at: this.now(), value });
    await done(tx);
  }

  async getCache<T>(scope: string, name: string): Promise<CacheEntry<T> | null> {
    const db = await this.db();
    if (!db) return null;
    const row = (await req(db.transaction('cache').objectStore('cache').get(cacheID(scope, name)))) as
      | { at: number; value: T }
      | undefined;
    return row ? { at: row.at, value: row.value } : null;
  }

  // ---- conflicts ------------------------------------------------------------------------

  async addConflict(c: Omit<ConflictCopy, 'id' | 'at'> & { at?: number }): Promise<ConflictCopy | null> {
    const db = await this.db();
    if (!db) return null;
    const at = c.at ?? this.now();
    const row: ConflictCopy = {
      ...c,
      at,
      id: `${c.scope}|${encodeURIComponent(c.vaultID)}|${encodeURIComponent(c.noteID)}|${at}|${Math.random().toString(36).slice(2, 8)}`,
    };
    const tx = db.transaction('conflicts', 'readwrite');
    tx.objectStore('conflicts').put(row);
    await done(tx);
    return row;
  }

  async listConflicts(scope: string, vaultID?: string, noteID?: string): Promise<ConflictCopy[]> {
    const db = await this.db();
    if (!db) return [];
    const all = (await req(db.transaction('conflicts').objectStore('conflicts').getAll())) as ConflictCopy[];
    return all
      .filter((c) => c.scope === scope && (vaultID == null || c.vaultID === vaultID) && (noteID == null || c.noteID === noteID))
      .sort((a, b) => b.at - a.at);
  }

  async deleteConflict(id: string): Promise<void> {
    const db = await this.db();
    if (!db) return;
    const tx = db.transaction('conflicts', 'readwrite');
    tx.objectStore('conflicts').delete(id);
    await done(tx);
  }
}

function stripNull(s: LineageStamp): LineageStamp {
  const out: LineageStamp = {};
  if (s.epoch) out.epoch = s.epoch;
  if (s.createdAt) out.createdAt = s.createdAt;
  return out;
}

function open(factory: IDBFactory, name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = factory.open(name, OFFLINE_DB_VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      for (const s of ['replicas', 'cache', 'conflicts'] as StoreName[]) {
        if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' });
      }
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.onblocked = () => reject(new Error('indexeddb blocked'));
  });
}

function defaultFactory(): IDBFactory | null {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB ? indexedDB : null;
  } catch {
    return null;
  }
}

/** The app-wide store. Tests construct their own with fake-indexeddb. */
export const offlineStore = new OfflineStore(defaultFactory());
