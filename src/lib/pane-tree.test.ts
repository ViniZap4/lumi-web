import { describe, it, expect } from 'vitest';
import {
  single, splitPane, closePane, onlyPane, equalize, setNote, resizeSplit, nudgePane, neighbor, cycle,
  leaves, rects, parsePaneState, pruneNotes, MAX_PANES, MIN_SIZE, type PaneState,
} from './pane-tree.ts';

const ids = (s: PaneState | null) => (s ? leaves(s.root).map((l) => l.note) : []);

/** a | (b / c) */
function three(): PaneState {
  let s = single('a', 'A');
  s = splitPane(s, 'A', 'row', 'b', 'B')!;
  s = splitPane(s, 'B', 'col', 'c', 'C')!;
  return s;
}

describe('pane tree — split / close / only / equalize', () => {
  it('vsplit puts the new pane right and focuses it', () => {
    const s = splitPane(single('a', 'A'), 'A', 'row', 'b', 'B')!;
    expect(ids(s)).toEqual(['a', 'b']);
    expect(s.active).toBe('B');
    expect(s.root.kind === 'split' && s.root.dir).toBe('row');
    expect(s.root.kind === 'split' && s.root.sizes).toEqual([0.5, 0.5]);
  });

  it('splitting in the same direction adds a sibling sharing the old space', () => {
    let s = splitPane(single('a', 'A'), 'A', 'row', 'b', 'B')!;
    s = splitPane(s, 'A', 'row', 'x', 'X')!;
    expect(ids(s)).toEqual(['a', 'x', 'b']);
    expect(s.root.kind === 'split' && s.root.sizes).toEqual([0.25, 0.25, 0.5]);
  });

  it('a split in the other direction nests', () => {
    const s = three();
    expect(ids(s)).toEqual(['a', 'b', 'c']);
    const r = rects(s.root);
    expect(r.get('C')).toEqual({ x: 0.5, y: 0.5, w: 0.5, h: 0.5 });
  });

  it('close gives the space to the neighbour, collapses one-child splits, and is null for the last pane', () => {
    const s = three();
    const c = closePane(s, 'C')!;
    expect(ids(c)).toEqual(['a', 'b']);
    expect(c.active).toBe('B');
    expect(c.root.kind === 'split' && c.root.children.every((x) => x.kind === 'leaf')).toBe(true);
    const a = closePane(c, 'A')!;
    expect(a.root.kind).toBe('leaf');
    expect(a.active).toBe('B');
    expect(closePane(a, 'B')).toBeNull();
  });

  it('closing a pane that is not focused keeps the focus', () => {
    const s = { ...three(), active: 'A' };
    expect(closePane(s, 'C')!.active).toBe('A');
  });

  it('only keeps one; equalize evens every split', () => {
    const s = three();
    expect(ids(onlyPane(s, 'B'))).toEqual(['b']);
    const r = resizeSplit(s, s.root.id, 0, 0.8);
    expect(r.root.kind === 'split' && r.root.sizes[0]).toBeCloseTo(0.8);
    const e = equalize(r);
    expect(e.root.kind === 'split' && e.root.sizes).toEqual([0.5, 0.5]);
  });

  it('caps the pane count', () => {
    let s = single('n0', 'P0');
    for (let i = 1; i < MAX_PANES; i++) s = splitPane(s, s.active, i % 2 ? 'row' : 'col', 'n' + i)!;
    expect(leaves(s.root)).toHaveLength(MAX_PANES);
    expect(splitPane(s, s.active, 'row', 'x')).toBeNull();
  });

  it('setNote changes one pane and clears its view override', () => {
    const s = setNote(three(), 'B', 'z');
    expect(ids(s)).toEqual(['a', 'z', 'c']);
  });
});

describe('pane tree — resize', () => {
  it('clamps dividers to the minimum size', () => {
    const s = splitPane(single('a', 'A'), 'A', 'row', 'b', 'B')!;
    const r = resizeSplit(s, s.root.id, 0, 0.99);
    expect(r.root.kind === 'split' && r.root.sizes[1]).toBeCloseTo(MIN_SIZE);
    const l = resizeSplit(s, s.root.id, 0, -1);
    expect(l.root.kind === 'split' && l.root.sizes[0]).toBeCloseTo(MIN_SIZE);
  });

  it('nudge grows a pane along the axis of its enclosing split (Ctrl-w > / +)', () => {
    const s = three();
    const wider = nudgePane(s, 'A', 'row', 0.1);
    expect(wider.root.kind === 'split' && wider.root.sizes[0]).toBeCloseTo(0.6);
    // The last pane of a split pulls the divider before it.
    const taller = nudgePane(s, 'C', 'col', 0.1);
    const right = taller.root.kind === 'split' ? taller.root.children[1] : null;
    expect(right?.kind === 'split' && right.sizes[1]).toBeCloseTo(0.6);
    // No split in that direction: unchanged.
    expect(nudgePane(single('a', 'A'), 'A', 'row', 0.1).root.kind).toBe('leaf');
  });
});

describe('pane tree — navigation', () => {
  it('h/j/k/l follow the geometry', () => {
    const s = three();
    expect(neighbor(s, 'A', 'l')).toBe('B'); // upper-right wins ties by overlap order
    expect(neighbor(s, 'B', 'j')).toBe('C');
    expect(neighbor(s, 'C', 'k')).toBe('B');
    expect(neighbor(s, 'C', 'h')).toBe('A');
    expect(neighbor(s, 'A', 'h')).toBeNull();
    expect(neighbor(s, 'B', 'l')).toBeNull();
  });

  it('w cycles in reading order with wrap', () => {
    const s = three();
    expect(cycle(s, 'A')).toBe('B');
    expect(cycle(s, 'C')).toBe('A');
    expect(cycle(s, 'A', -1)).toBe('C');
  });
});

describe('pane tree — persistence', () => {
  it('round-trips through JSON', () => {
    const s = three();
    const back = parsePaneState(JSON.parse(JSON.stringify(s)));
    expect(back).toEqual(s);
  });

  it('rejects malformed or hostile input', () => {
    expect(parsePaneState(null)).toBeNull();
    expect(parsePaneState({ root: { kind: 'leaf', id: 'A' } })).toBeNull();
    expect(parsePaneState({ root: { kind: 'leaf', id: 'A', note: 'x\u0000y' } })).toBeNull();
    expect(parsePaneState({ root: { kind: 'split', id: 'S', dir: 'diagonal', children: [], sizes: [] } })).toBeNull();
    // duplicate ids
    expect(parsePaneState({ root: { kind: 'split', id: 'S', dir: 'row', sizes: [0.5, 0.5], children: [{ kind: 'leaf', id: 'A', note: 'a' }, { kind: 'leaf', id: 'A', note: 'b' }] } })).toBeNull();
  });

  it('normalises bad sizes and falls back to the first leaf for an unknown active id', () => {
    const s = parsePaneState({ active: 'nope', root: { kind: 'split', id: 'S', dir: 'row', sizes: [5, 'x'], children: [{ kind: 'leaf', id: 'A', note: 'a' }, { kind: 'leaf', id: 'B', note: 'b' }] } })!;
    expect(s.active).toBe('A');
    expect(s.root.kind === 'split' && s.root.sizes).toEqual([0.5, 0.5]);
  });

  it('prunes panes whose note is gone', () => {
    const s = three();
    expect(ids(pruneNotes(s, (n) => n !== 'b'))).toEqual(['a', 'c']);
    expect(pruneNotes(s, () => false)).toBeNull();
  });
});
