// Yjs side of the offline replica (lazy editor chunk).
//
// `ReplicaPersistence` binds ONE EditorSession's Y.Doc to its row in
// the offline store (lib/offline-store.ts):
//
//   - writes are debounced (WRITE_DEBOUNCE_MS) and flushed on
//     pagehide / tab hidden / session destroy; every write is a
//     merge-on-write of the full state, so concurrent tabs converge;
//   - it tracks which Yjs clients authored edits here (`localClients`)
//     and the last server state vector known to contain them (`ackSV`);
//   - `unsent` = some local client's clock in the doc is ahead of the
//     acknowledged server vector. This is the persisted "Pendente".
//
// Persistence for a note starts only once the session has been
// through a first SyncStep2 (or was itself restored from a replica):
// the protocol forbids building a replica out of anything but server
// state.

import * as Y from 'yjs';
import {
  maxSV,
  type LineageStamp,
  type MergeResult,
  type OfflineStore,
  type ReplicaKey,
  type ReplicaRecord,
  type RescuedText,
} from './offline-store.ts';
import type { StateVector } from './lineage.ts';

export const WRITE_DEBOUNCE_MS = 250;
export const ORIGIN_REPLICA_RESTORE = 'lumi:replica-restore';

export function svToRecord(sv: StateVector): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of sv) out[String(k)] = v;
  return out;
}

export function recordToSV(r: Record<string, number>): StateVector {
  const out: StateVector = new Map();
  for (const [k, v] of Object.entries(r)) out.set(Number(k), v);
  return out;
}

export function decodeSV(bytes: Uint8Array): StateVector {
  return Y.decodeStateVector(bytes);
}

/** base64 (REST `vector_clock`) → state vector. */
export function decodeSVBase64(b64: string): StateVector {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return Y.decodeStateVector(bytes);
}

/** True when some local client's clock in `sv` is ahead of `ack`. */
export function hasUnsent(sv: StateVector, localClients: Iterable<number>, ack: Record<string, number>): boolean {
  for (const c of localClients) {
    const clock = sv.get(c) ?? 0;
    if (clock > (ack[String(c)] ?? 0)) return true;
  }
  return false;
}

/** The merge used inside the store's write transaction. */
export function mergeReplica(
  ours: Uint8Array,
  stored: ReplicaRecord | null,
  localClients: number[],
  ackSV: Record<string, number>,
): MergeResult {
  const state = stored ? Y.mergeUpdates([stored.state, ours]) : ours;
  const sv = Y.decodeStateVector(Y.encodeStateVectorFromUpdate(state));
  // Text of the merged state (cheap for note-sized docs).
  const tmp = new Y.Doc();
  try {
    Y.applyUpdate(tmp, state);
    return { state, text: tmp.getText('content').toString(), dirty: hasUnsent(sv, localClients, ackSV) };
  } finally {
    tmp.destroy();
  }
}

/** Text held by a stored replica state. */
export function replicaText(state: Uint8Array): string {
  const tmp = new Y.Doc();
  try {
    Y.applyUpdate(tmp, state);
    return tmp.getText('content').toString();
  } finally {
    tmp.destroy();
  }
}

export interface ReplicaPersistenceOptions {
  store: OfflineStore;
  key: ReplicaKey;
  doc: Y.Doc;
  /** Stored row this session was restored from (null = fresh join). */
  initial: ReplicaRecord | null;
  lineage: LineageStamp;
  /** Transaction origin of remote updates (the provider). */
  isRemote: (origin: unknown) => boolean;
  /** Called whenever `unsent` changes. */
  onUnsent?: (unsent: boolean) => void;
  title?: () => string | null;
  /** Window-like target for pagehide/visibilitychange (tests: null). */
  win?: Pick<Window, 'addEventListener' | 'removeEventListener'> | null;
  debounceMs?: number;
}

export class ReplicaPersistence {
  readonly key: ReplicaKey;
  /** Writing to the store is active (after first sync, or restored). */
  active = false;
  unsent = false;
  lineage: LineageStamp;
  readonly localClients = new Set<number>();
  ackSV: Record<string, number> = {};

  private o: ReplicaPersistenceOptions;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private dirtySinceWrite = false;
  private killed = false;
  private detach: (() => void) | null = null;
  private writing: Promise<unknown> = Promise.resolve();

  private readonly onUpdate = (_u: Uint8Array, origin: unknown) => {
    if (this.killed || origin === ORIGIN_REPLICA_RESTORE) return;
    if (!this.o.isRemote(origin)) {
      this.localClients.add(this.o.doc.clientID);
      this.recomputeUnsent();
    }
    if (!this.active) return;
    this.dirtySinceWrite = true;
    this.schedule();
  };

  private readonly onHide = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') return;
    void this.flush();
  };

  constructor(o: ReplicaPersistenceOptions) {
    this.o = o;
    this.key = o.key;
    this.lineage = { ...(o.initial?.lineage ?? {}), ...stripEmpty(o.lineage) };
    if (o.initial) {
      for (const c of o.initial.localClients) this.localClients.add(c);
      this.ackSV = { ...o.initial.ackSV };
      Y.applyUpdate(o.doc, o.initial.state, ORIGIN_REPLICA_RESTORE);
      this.active = true;
      this.recomputeUnsent();
    }
    o.doc.on('update', this.onUpdate);
    this.detach = o.store.attach(o.key, { kill: () => this.kill() });
    const win = o.win === undefined ? (typeof window !== 'undefined' ? window : null) : o.win;
    if (win) {
      win.addEventListener('pagehide', this.onHide);
      win.addEventListener('visibilitychange', this.onHide);
    }
  }

  get restored(): boolean {
    return this.o.initial != null;
  }

  /** First SyncStep2 of a fresh session: from now on the doc is a
   *  valid replica and gets persisted. */
  activate(): void {
    if (this.active || this.killed) return;
    this.active = true;
    this.dirtySinceWrite = true;
    void this.flush();
  }

  /** The server holds at least `sv` (from GET /snapshot). */
  acknowledge(sv: StateVector): void {
    if (this.killed) return;
    this.ackSV = maxSV(this.ackSV, svToRecord(sv));
    this.recomputeUnsent();
    if (this.active) {
      this.dirtySinceWrite = true;
      void this.flush();
    }
  }

  /** Server metadata learnt after the session started (e.g. an epoch
   *  the server began exposing). */
  updateLineage(s: LineageStamp): void {
    this.lineage = { ...this.lineage, ...stripEmpty(s) };
  }

  /** Does the server vector `sv` cover every local edit? */
  coveredBy(sv: StateVector): boolean {
    return !hasUnsent(Y.decodeStateVector(Y.encodeStateVector(this.o.doc)), this.localClients, svToRecord(sv));
  }

  private recomputeUnsent(): void {
    const sv = Y.decodeStateVector(Y.encodeStateVector(this.o.doc));
    const next = hasUnsent(sv, this.localClients, this.ackSV);
    if (next !== this.unsent) {
      this.unsent = next;
      this.o.onUnsent?.(next);
    }
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.o.debounceMs ?? WRITE_DEBOUNCE_MS);
  }

  /** Write now (state encoded synchronously, so it is safe to call
   *  right before the doc is destroyed). */
  flush(): Promise<unknown> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.active || this.killed || !this.dirtySinceWrite) return this.writing;
    this.dirtySinceWrite = false;
    const ours = Y.encodeStateAsUpdate(this.o.doc);
    const localClients = [...this.localClients];
    const ackSV = { ...this.ackSV };
    const lineage = { ...this.lineage };
    const store = this.o.store;
    const key = this.key;
    this.writing = this.writing
      .then(() =>
        store.saveReplica(key, {
          localClients,
          ackSV,
          lineage,
          merge: (stored, lc, ack) => mergeReplica(ours, stored, lc, ack),
        }),
      )
      .then(() => store.evict())
      .catch((e) => {
        console.warn('offline replica: write failed', e);
      });
    return this.writing;
  }

  /** Drop the stored row (lineage mismatch handled, note deleted). */
  async discardStored(): Promise<void> {
    this.kill();
    await this.writing;
    await this.o.store.deleteReplica(this.key);
  }

  /** Stop persisting for good (scope wiped / session destroyed). Returns
   *  the text if it holds unsent edits. */
  kill(): RescuedText | null {
    if (this.killed) return null;
    this.killed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.o.doc.off('update', this.onUpdate);
    this.detach?.();
    this.detach = null;
    const win = this.o.win === undefined ? (typeof window !== 'undefined' ? window : null) : this.o.win;
    if (win) {
      win.removeEventListener('pagehide', this.onHide);
      win.removeEventListener('visibilitychange', this.onHide);
    }
    if (!this.unsent) return null;
    let text = '';
    try {
      text = this.o.doc.getText('content').toString();
    } catch {
      // doc already destroyed
    }
    return { vaultID: this.key.vaultID, noteID: this.key.noteID, title: this.o.title?.() ?? null, text };
  }

  get isKilled(): boolean {
    return this.killed;
  }

  /** Flush and detach (normal session end). */
  async close(): Promise<void> {
    const p = this.flush();
    if (!this.killed) {
      this.killed = true;
      if (this.timer) clearTimeout(this.timer);
      this.o.doc.off('update', this.onUpdate);
      this.detach?.();
      this.detach = null;
      const win = this.o.win === undefined ? (typeof window !== 'undefined' ? window : null) : this.o.win;
      if (win) {
        win.removeEventListener('pagehide', this.onHide);
        win.removeEventListener('visibilitychange', this.onHide);
      }
    }
    await p;
  }
}

function stripEmpty(s: LineageStamp): LineageStamp {
  const out: LineageStamp = {};
  if (s.epoch) out.epoch = s.epoch;
  if (s.createdAt) out.createdAt = s.createdAt;
  return out;
}
