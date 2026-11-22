// @vitest-environment jsdom
// (jsdom so .svelte.ts runes compile for the client: under the node
// environment vitest uses the SSR transform and $derived never updates.)
//
// Column derivation from note paths + the yazi navigation grammar
// (h/l column walk, H/L history, gg/G, home, filter, reveal).

import { describe, it, expect } from 'vitest';
import { buildTree, normalizePath, breadcrumb, filterEntries, nearestExisting } from './notetree.ts';
import { MillerNav, HISTORY_CAP } from './miller.svelte.ts';
import type { NoteSummary } from './types.ts';

const note = (id: string, path: string, title = id): NoteSummary => ({
  id, vault_id: 'v', path, title, created_at: '', updated_at: '',
});

// Same shape as the TUI's yazi_nav_test vault:
//   alpha/ { nested/ { deep }, inner }, beta/ { b1 }, one, two
const VAULT = [
  note('two', 'two.md', 'Two'),
  note('inner', 'alpha/inner.md', 'Inner'),
  note('deep', 'alpha/nested/deep.md', 'Deep'),
  note('b1', 'beta/b1.md', 'B1'),
  note('one', 'one.md', 'One'),
];

const names = (es: readonly { name: string }[]) => es.map((e) => e.name);

describe('notetree', () => {
  it('derives folders from paths: folders first, then notes, natural order', () => {
    const t = buildTree(VAULT);
    expect(names(t.folders.get('')!)).toEqual(['alpha', 'beta', 'One', 'Two']);
    expect(names(t.folders.get('alpha')!)).toEqual(['nested', 'Inner']);
    expect(names(t.folders.get('alpha/nested')!)).toEqual(['Deep']);
    expect(t.folders.get('alpha')!.find((e) => e.name === 'nested')).toMatchObject({ kind: 'folder', count: 1 });
    expect(t.folders.get('')!.find((e) => e.name === 'alpha')).toMatchObject({ count: 2 });
    expect(t.noteDir.get('deep')).toBe('alpha/nested');
    expect(t.noteCount).toBe(5);
  });

  it('creates intermediate folders that hold no notes directly', () => {
    const t = buildTree([note('x', 'a/b/c/x.md')]);
    expect(names(t.folders.get('')!)).toEqual(['a']);
    expect(names(t.folders.get('a')!)).toEqual(['b']);
    expect(names(t.folders.get('a/b')!)).toEqual(['c']);
    expect(names(t.folders.get('a/b/c')!)).toEqual(['x']);
  });

  it('natural sort, case-insensitive', () => {
    const t = buildTree([note('a', 'n10.md', 'note 10'), note('b', 'n2.md', 'Note 2'), note('c', 'n1.md', 'note 1')]);
    expect(names(t.folders.get('')!)).toEqual(['note 1', 'Note 2', 'note 10']);
  });

  it('normalises hostile / sloppy paths and falls back to the file name', () => {
    expect(normalizePath('./a//b\\c.md')).toBe('a/b/c.md');
    expect(normalizePath('/../../etc/x.md')).toBe('etc/x.md');
    const t = buildTree([note('x', '../x.md', ''), note('y', '', 'Y')]);
    expect(names(t.folders.get('')!)).toEqual(['x', 'Y']);
  });

  it('ignores duplicate ids', () => {
    const t = buildTree([note('a', 'a.md'), note('a', 'b/a.md')]);
    expect(t.noteCount).toBe(1);
    expect(t.folders.has('b')).toBe(false);
  });

  it('breadcrumb, filter, nearestExisting', () => {
    expect(breadcrumb('a/b')).toEqual([{ name: '/', path: '' }, { name: 'a', path: 'a' }, { name: 'b', path: 'a/b' }]);
    const t = buildTree(VAULT);
    expect(names(filterEntries(t.folders.get('')!, 'O'))).toEqual(['One', 'Two']);
    expect(names(filterEntries(t.folders.get('')!, 'b1'))).toEqual([]);
    expect(nearestExisting(t, 'alpha/gone/deeper')).toBe('alpha');
  });

  it('builds 10k notes quickly', () => {
    const many = Array.from({ length: 10_000 }, (_, i) => note(`n${i}`, `d${i % 50}/s${i % 7}/n${i}.md`, `Note ${i}`));
    const t0 = performance.now();
    const t = buildTree(many);
    const ms = performance.now() - t0;
    expect(t.noteCount).toBe(10_000);
    expect(t.folders.get('')!).toHaveLength(50);
    expect(ms).toBeLessThan(500);
  });
});

describe('MillerNav grammar', () => {
  function nav(list: NoteSummary[] = VAULT) {
    return { n: new MillerNav(() => list) };
  }

  it('starts at the root with parent column empty and cursor on the first row', () => {
    const { n } = nav();
    expect(n.dir).toBe('');
    expect(n.parent).toBeNull();
    expect(n.current?.name).toBe('alpha');
    expect(names(n.previewEntries!)).toEqual(['nested', 'Inner']);
  });

  it('l descends, h ascends and lands on the folder we came from', () => {
    const { n } = nav();
    expect(n.right()).toBeNull(); // into alpha/
    expect(n.dir).toBe('alpha');
    expect(names(n.parentEntries)).toEqual(['alpha', 'beta', 'One', 'Two']);
    expect(n.parentCursor).toBe(0);
    n.right(); // into nested/
    expect(n.dir).toBe('alpha/nested');
    expect(n.left()).toBe(true);
    expect(n.dir).toBe('alpha');
    expect(n.current?.name).toBe('nested');
    n.left();
    expect(n.current?.name).toBe('alpha');
    expect(n.left()).toBe(false); // no-op at root (never escapes the book)
  });

  it('l on a note returns it (caller opens) without navigating', () => {
    const { n } = nav();
    n.bottom(); // G → Two
    const e = n.right();
    expect(e?.note.id).toBe('two');
    expect(n.dir).toBe('');
  });

  it('j/k clamp, gg/G jump to the ends', () => {
    const { n } = nav();
    n.move(-1);
    expect(n.cursor).toBe(0);
    n.move(1);
    n.move(1);
    expect(n.current?.name).toBe('One');
    n.move(99);
    expect(n.current?.name).toBe('Two');
    n.top();
    expect(n.cursor).toBe(0);
  });

  it('each folder remembers its own selection', () => {
    const { n } = nav();
    n.right(); // alpha
    n.move(1); // Inner
    n.left();
    n.move(1); // beta
    n.right();
    n.left();
    n.move(-1); // alpha
    n.right();
    expect(n.current?.name).toBe('Inner');
  });

  it('H/L walk the folder history; a new jump clears forward', () => {
    const { n } = nav();
    n.right(); // alpha
    n.right(); // alpha/nested
    expect(n.historyBack()).toBe(true);
    expect(n.dir).toBe('alpha');
    expect(n.historyBack()).toBe(true);
    expect(n.dir).toBe('');
    expect(n.current?.name).toBe('alpha');
    expect(n.historyBack()).toBe(false);
    expect(n.historyForward()).toBe(true);
    expect(n.dir).toBe('alpha');
    n.home(); // new jump
    expect(n.canForward).toBe(false);
    expect(n.historyBack()).toBe(true);
    expect(n.dir).toBe('alpha');
  });

  it('home at the root adds no history entry', () => {
    const { n } = nav();
    n.home();
    expect(n.canBack).toBe(false);
  });

  it('history is capped', () => {
    const { n } = nav();
    for (let i = 0; i < HISTORY_CAP + 20; i++) {
      n.goTo(i % 2 ? '' : 'alpha');
    }
    let steps = 0;
    while (n.historyBack()) steps++;
    expect(steps).toBe(HISTORY_CAP);
  });

  it('filter narrows only the current column, keeps the selection when visible, clears on navigate', () => {
    const { n } = nav();
    n.move(3); // Two
    n.setFilter('o');
    expect(names(n.entries)).toEqual(['One', 'Two']);
    expect(n.current?.name).toBe('Two');
    n.setFilter('one');
    expect(n.current?.name).toBe('One');
    n.setFilter('zzz');
    expect(n.current).toBeNull();
    n.setFilter('');
    expect(n.current?.name).toBe('Two'); // remembered row is back
    n.top();
    n.right(); // into alpha
    expect(n.dir).toBe('alpha');
    n.setFilter('x');
    n.left();
    expect(n.filter).toBe('');
  });

  it('reveal jumps to a note in another folder', () => {
    const { n } = nav();
    expect(n.reveal('deep')).toBe(true);
    expect(n.dir).toBe('alpha/nested');
    expect(n.current?.name).toBe('Deep');
    expect(n.reveal('nope')).toBe(false);
  });

  it('a folder that no longer exists resolves to its nearest ancestor', () => {
    const n = new MillerNav(() => VAULT.filter((x) => x.id !== 'deep'));
    n.goTo('alpha/nested');
    expect(n.dir).toBe('alpha');
  });
});
