import { describe, it, expect } from 'vitest';
import { GChord, CHORD_MS } from './shortcuts.ts';

const k = (key: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean }> = {}) =>
  ({ key, ctrlKey: false, metaKey: false, altKey: false, ...mods });

describe('GChord', () => {
  it('g1–g9 open books, gb opens the picker, gg stays "top"', () => {
    let t = 0;
    const c = new GChord(() => t);
    for (let n = 1; n <= 9; n++) {
      expect(c.feed(k('g'), false)).toEqual({ kind: 'pending' });
      t += 100;
      expect(c.feed(k(String(n)), false)).toEqual({ kind: 'book', n });
    }
    c.feed(k('g'), false);
    expect(c.feed(k('b'), false)).toEqual({ kind: 'picker' });
    c.feed(k('g'), false);
    expect(c.feed(k('g'), false)).toEqual({ kind: 'top' });
  });

  it('expires after the chord window and ignores g0 / modifiers', () => {
    let t = 0;
    const c = new GChord(() => t);
    c.feed(k('g'), false);
    t += CHORD_MS + 1;
    expect(c.feed(k('1'), false)).toBeNull();
    c.feed(k('g'), false);
    expect(c.feed(k('0'), false)).toBeNull();
    c.feed(k('g'), false);
    expect(c.feed(k('1', { ctrlKey: true }), false)).toBeNull();
    expect(c.feed(k('1'), false)).toBeNull();
  });

  it('⌃⌘1–9 switch books on macOS only', () => {
    const c = new GChord(() => 0);
    expect(c.feed(k('3', { ctrlKey: true, metaKey: true }), true)).toEqual({ kind: 'book', n: 3 });
    expect(c.feed(k('3', { ctrlKey: true, metaKey: true }), false)).toBeNull();
    expect(c.feed(k('3', { metaKey: true }), true)).toBeNull();
  });
});
