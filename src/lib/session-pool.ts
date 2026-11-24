// Shared live sessions for panes (SPEC-PARTE2 §3: "Each pane has its
// own live session. Two panes on the same note share one session/doc").
//
// Reference counted per (vault, note). A session that stopped, hit a
// lineage conflict or was destroyed is never handed out again: the next
// `acquire` builds a fresh one. `release(s, { defer })` keeps the last
// reference alive for a short grace so a pane hand-off (close a split,
// promote a pane) can pick the session up without reconnecting.

export interface PooledSession {
  vaultID: string;
  noteID: string;
  destroy(): void;
  readonly isDestroyed: boolean;
  stopped?: boolean;
  lineageConflict?: unknown;
}

export const RELEASE_GRACE_MS = 1500;

export class SessionPool<S extends PooledSession> {
  private refs = new Map<S, number>();
  private timers = new Map<S, ReturnType<typeof setTimeout>>();

  constructor(private grace = RELEASE_GRACE_MS) {}

  private key(v: string, n: string): string {
    return v + '\u0000' + n;
  }

  private usable(s: S): boolean {
    return !s.isDestroyed && !s.stopped && !s.lineageConflict;
  }

  /** A live session for the note, if any (no reference taken). */
  peek(vaultID: string, noteID: string): S | null {
    const k = this.key(vaultID, noteID);
    for (const s of this.refs.keys()) if (this.key(s.vaultID, s.noteID) === k && this.usable(s)) return s;
    return null;
  }

  /** Take a reference on the live session, building one when needed. */
  acquire(vaultID: string, noteID: string, create: () => S): S {
    let s = this.peek(vaultID, noteID);
    if (!s) {
      s = create();
      this.refs.set(s, 0);
    }
    const t = this.timers.get(s);
    if (t) {
      clearTimeout(t);
      this.timers.delete(s);
    }
    this.refs.set(s, (this.refs.get(s) ?? 0) + 1);
    return s;
  }

  /** Register a session built elsewhere with one reference. */
  adopt(s: S): S {
    this.refs.set(s, (this.refs.get(s) ?? 0) + 1);
    return s;
  }

  refCount(s: S): number {
    return this.refs.get(s) ?? 0;
  }

  /** Drop a reference; the last one destroys the session (after the
   *  grace when `defer`). Unknown sessions are destroyed directly. */
  release(s: S | null | undefined, o: { defer?: boolean } = {}): void {
    if (!s) return;
    const n = this.refs.get(s);
    if (n == null) {
      s.destroy();
      return;
    }
    if (n > 1) {
      this.refs.set(s, n - 1);
      return;
    }
    this.refs.set(s, 0);
    const kill = () => {
      this.timers.delete(s);
      if ((this.refs.get(s) ?? 0) > 0) return;
      this.refs.delete(s);
      s.destroy();
    };
    if (o.defer && this.usable(s)) this.timers.set(s, setTimeout(kill, this.grace));
    else kill();
  }

  /** Destroy everything (logout / view teardown in tests). */
  clear(): void {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    for (const s of this.refs.keys()) {
      try { s.destroy(); } catch { /* ignore */ }
    }
    this.refs.clear();
  }
}
