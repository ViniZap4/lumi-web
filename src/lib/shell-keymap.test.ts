import { describe, it, expect } from 'vitest';
import { ShellKeymap, CHORD_TIMEOUT_MS, type ShellAction, type ShellContext } from './shell-keymap.ts';

function keymap() {
  let t = 1000;
  const km = new ShellKeymap(() => t);
  const feed = (key: string, ctx: ShellContext = 'explorer', mods: Partial<KeyboardEvent> = {}): ShellAction | null =>
    km.feed({ key, ctrlKey: false, metaKey: false, altKey: false, ...mods } as KeyboardEvent, ctx, false);
  const seq = (keys: string, ctx: ShellContext = 'explorer') => Array.from(keys).map((k) => feed(k, ctx));
  return { km, feed, seq, advance: (ms: number) => (t += ms) };
}

describe('ShellKeymap', () => {
  it('j/k move, counts multiply, 0 only extends a count', () => {
    const { feed, seq, km } = keymap();
    expect(feed('j')).toEqual({ kind: 'move', n: 1 });
    expect(feed('k')).toEqual({ kind: 'move', n: -1 });
    expect(seq('5j').at(-1)).toEqual({ kind: 'move', n: 5 });
    expect(seq('12k').at(-1)).toEqual({ kind: 'move', n: -12 });
    expect(feed('0')).toBeNull();
    feed('1');
    feed('0');
    expect(km.pending).toBe('10');
    expect(feed('ArrowDown')).toEqual({ kind: 'move', n: 10 });
    expect(km.pending).toBeNull();
  });

  it('g/z chords; pending shows the prefix; unknown second key falls through', () => {
    const { feed, km, advance } = keymap();
    expect(feed('g')).toEqual({ kind: 'pending' });
    expect(km.pending).toBe('g');
    expect(km.chord).toBe('g');
    expect(feed('g')).toEqual({ kind: 'top' });
    expect(feed('g')).toEqual({ kind: 'pending' });
    expect(feed('h')).toEqual({ kind: 'home' });
    feed('g');
    expect(feed('3')).toEqual({ kind: 'book', n: 3 });
    feed('g');
    expect(feed('b')).toEqual({ kind: 'picker' });
    feed('z');
    expect(feed('p')).toEqual({ kind: 'togglePreview' });
    feed('z');
    expect(feed('h')).toEqual({ kind: 'home' });
    feed('g');
    expect(feed('j')).toEqual({ kind: 'move', n: 1 });
    feed('g');
    advance(CHORD_TIMEOUT_MS + 1);
    expect(km.pending).toBeNull();
    expect(feed('g')).toEqual({ kind: 'pending' });
  });

  it('explorer file keys', () => {
    const { feed } = keymap();
    const kinds = ['a', 'r', 'd', 'y', 'p', '.', '/', 'n', 'N', 'R', 'H', 'L', '~', '-', '?', ':', ' ', '[', ']', 'i', 'e', 'q', 'G', 'l', 'h', ','].map(
      (k) => feed(k)?.kind,
    );
    expect(kinds).toEqual([
      'create', 'rename', 'delete', 'yank', 'paste', 'toggleHidden', 'filter', 'nextMatch', 'prevMatch', 'refresh',
      'historyBack', 'historyForward', 'home', 'parent', 'help', 'command', 'palette', 'prevBook', 'nextBook',
      'edit', 'edit', 'clearOrBack', 'bottom', 'open', 'parent', 'settings',
    ]);
  });

  it('reader keys: d/u half page, f/b page, q closes, r renames, a creates (in the explorer)', () => {
    const { feed } = keymap();
    expect(feed('d', 'reader')).toEqual({ kind: 'halfPage', dir: 1 });
    expect(feed('u', 'reader')).toEqual({ kind: 'halfPage', dir: -1 });
    expect(feed('f', 'reader')).toEqual({ kind: 'page', dir: 1 });
    expect(feed('b', 'reader')).toEqual({ kind: 'page', dir: -1 });
    expect(feed('q', 'reader')).toEqual({ kind: 'close' });
    expect(feed('a', 'reader')).toEqual({ kind: 'create' });
    expect(feed('r', 'reader')).toEqual({ kind: 'rename' });
  });

  it('ctrl keys, special keys, and modifiers', () => {
    const { feed, km } = keymap();
    expect(feed('d', 'explorer', { ctrlKey: true })).toEqual({ kind: 'halfPage', dir: 1 });
    expect(feed('u', 'explorer', { ctrlKey: true })).toEqual({ kind: 'halfPage', dir: -1 });
    expect(feed('f', 'explorer', { ctrlKey: true })).toBeNull();
    expect(feed('k', 'explorer', { metaKey: true })).toBeNull();
    expect(feed('Enter')).toEqual({ kind: 'open' });
    expect(feed('Escape')).toEqual({ kind: 'clearOrBack' });
    expect(feed('Backspace')).toEqual({ kind: 'parent' });
    expect(km.feed({ key: '2', ctrlKey: true, metaKey: true, altKey: false } as KeyboardEvent, 'explorer', true)).toEqual({ kind: 'book', n: 2 });
  });
});

describe('part 2 reader keys', () => {
  const k = (key: string) => ({ key, ctrlKey: false, metaKey: false, altKey: false });
  it('- opens the floating explorer in the reader (still "up" in the explorer); K previews; gf follows', () => {
    const m = new ShellKeymap();
    expect(m.feed(k('-'), 'reader')).toEqual({ kind: 'floatExplorer' });
    expect(m.feed(k('-'), 'explorer')).toEqual({ kind: 'parent' });
    expect(m.feed(k('K'), 'reader')).toEqual({ kind: 'hover' });
    expect(m.feed(k('g'), 'reader')).toEqual({ kind: 'pending' });
    expect(m.feed(k('f'), 'reader')).toEqual({ kind: 'follow' });
  });
});
