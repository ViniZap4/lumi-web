// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { ZenController, HIDE_DELAY_MS, ZEN_STORAGE_KEY, inHotCorner, type ZenStorage } from './zen.svelte.ts';

function memStorage(init: Record<string, string> = {}): ZenStorage & { data: Record<string, string> } {
  const data = { ...init };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = v; },
    removeItem: (k) => { delete data[k]; },
  };
}

/** Manual clock for the hide timer. */
function timers() {
  let next = 1;
  const pending = new Map<number, { fn: () => void; at: number }>();
  let now = 0;
  return {
    setTimer: (fn: () => void, ms: number) => { const id = next++; pending.set(id, { fn, at: now + ms }); return id; },
    clearTimer: (h: unknown) => { pending.delete(h as number); },
    advance(ms: number) {
      now += ms;
      for (const [id, t] of [...pending]) if (t.at <= now) { pending.delete(id); t.fn(); }
    },
    get size() { return pending.size; },
  };
}

let root: HTMLElement;
beforeEach(() => { root = document.createElement('div'); });

describe('ZenController', () => {
  it('starts off without storage and reflects nothing', () => {
    const z = new ZenController({ storage: null, root });
    expect(z.on).toBe(false);
    expect(root.hasAttribute('data-zen')).toBe(false);
  });

  it('restores the per-device setting', () => {
    const z = new ZenController({ storage: memStorage({ [ZEN_STORAGE_KEY]: '1' }), root });
    expect(z.on).toBe(true);
    expect(root.hasAttribute('data-zen')).toBe(true);
    expect(root.hasAttribute('data-zen-reveal')).toBe(false);
  });

  it('toggle persists and clears', () => {
    const s = memStorage();
    const z = new ZenController({ storage: s, root });
    z.toggle();
    expect(s.data[ZEN_STORAGE_KEY]).toBe('1');
    expect(root.hasAttribute('data-zen')).toBe(true);
    z.toggle();
    expect(ZEN_STORAGE_KEY in s.data).toBe(false);
    expect(root.hasAttribute('data-zen')).toBe(false);
  });

  it('survives throwing storage', () => {
    const bad: ZenStorage = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
      removeItem: () => { throw new Error('blocked'); },
    };
    const z = new ZenController({ storage: bad, root });
    expect(z.on).toBe(false);
    expect(() => z.toggle()).not.toThrow();
    expect(z.on).toBe(true);
  });

  it('the pointer in the corner reveals; leaving hides after the delay', () => {
    const t = timers();
    const z = new ZenController({ storage: null, root, ...t });
    z.set(true);
    z.pointer(true);
    expect(z.revealed).toBe(true);
    expect(root.hasAttribute('data-zen-reveal')).toBe(true);
    z.pointer(false);
    t.advance(HIDE_DELAY_MS - 1);
    expect(z.revealed).toBe(true);
    t.advance(1);
    expect(z.revealed).toBe(false);
    expect(root.hasAttribute('data-zen-reveal')).toBe(false);
  });

  it('coming back before the delay keeps the chrome', () => {
    const t = timers();
    const z = new ZenController({ storage: null, root, ...t });
    z.set(true);
    z.pointer(true);
    z.pointer(false);
    t.advance(300);
    z.pointer(true);
    t.advance(HIDE_DELAY_MS * 2);
    expect(z.revealed).toBe(true);
    expect(t.size).toBe(0);
  });

  it('repeated moves outside do not restart the hide timer', () => {
    const t = timers();
    const z = new ZenController({ storage: null, root, ...t });
    z.set(true);
    z.pointer(true);
    z.pointer(false);
    t.advance(400);
    z.pointer(false);
    t.advance(200);
    expect(z.revealed).toBe(false);
  });

  it('the pointer does nothing while zen is off', () => {
    const z = new ZenController({ storage: null, root });
    z.pointer(true);
    expect(z.revealed).toBe(false);
    expect(root.hasAttribute('data-zen-reveal')).toBe(false);
  });

  it('toggling off clears the reveal and its timer', () => {
    const t = timers();
    const z = new ZenController({ storage: null, root, ...t });
    z.set(true);
    z.pointer(true);
    z.pointer(false);
    z.set(false);
    expect(z.revealed).toBe(false);
    expect(t.size).toBe(0);
    expect(root.hasAttribute('data-zen-reveal')).toBe(false);
  });

  it('leaving the window counts as leaving the corner', () => {
    const t = timers();
    const z = new ZenController({ storage: null, root, ...t });
    z.set(true);
    z.pointer(true);
    z.pointerLeftWindow();
    t.advance(HIDE_DELAY_MS);
    expect(z.revealed).toBe(false);
  });
});

describe('inHotCorner', () => {
  it('is the 72×40 top-left region', () => {
    expect(inHotCorner(0, 0)).toBe(true);
    expect(inHotCorner(72, 40)).toBe(true);
    expect(inHotCorner(73, 10)).toBe(false);
    expect(inHotCorner(10, 41)).toBe(false);
  });
});
