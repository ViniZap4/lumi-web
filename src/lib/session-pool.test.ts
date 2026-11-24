import { describe, it, expect, vi } from 'vitest';
import { SessionPool } from './session-pool.ts';

class S {
  isDestroyed = false;
  stopped = false;
  lineageConflict: unknown = null;
  constructor(public vaultID: string, public noteID: string) {}
  destroy() { this.isDestroyed = true; }
}

describe('session pool (panes on one note share one session)', () => {
  it('shares a live session and destroys it with the last reference', () => {
    const pool = new SessionPool<S>();
    const make = vi.fn(() => new S('v', 'n'));
    const a = pool.acquire('v', 'n', make);
    const b = pool.acquire('v', 'n', make);
    expect(a).toBe(b);
    expect(make).toHaveBeenCalledTimes(1);
    pool.release(a);
    expect(a.isDestroyed).toBe(false);
    pool.release(b);
    expect(a.isDestroyed).toBe(true);
  });

  it('never hands out a stopped or conflicted session', () => {
    const pool = new SessionPool<S>();
    const a = pool.acquire('v', 'n', () => new S('v', 'n'));
    a.lineageConflict = { reason: 'x' };
    const b = pool.acquire('v', 'n', () => new S('v', 'n'));
    expect(b).not.toBe(a);
  });

  it('a deferred release survives a hand-off within the grace', () => {
    vi.useFakeTimers();
    const pool = new SessionPool<S>(1000);
    const a = pool.acquire('v', 'n', () => new S('v', 'n'));
    pool.release(a, { defer: true });
    vi.advanceTimersByTime(500);
    const again = pool.acquire('v', 'n', () => new S('v', 'n'));
    expect(again).toBe(a);
    vi.advanceTimersByTime(2000);
    expect(a.isDestroyed).toBe(false);
    pool.release(again, { defer: true });
    vi.advanceTimersByTime(1000);
    expect(a.isDestroyed).toBe(true);
    vi.useRealTimers();
  });
});
