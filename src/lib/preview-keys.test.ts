// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { PreviewKeymap, PREVIEW_CHORD_MS, headingTarget, findOffsets, findRanges, nextMatchIndex } from './preview-keys.ts';

const k = (key: string, extra: Partial<KeyboardEvent> = {}) => ({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...extra });

describe('PreviewKeymap (split preview reader)', () => {
  it('j/k scroll, with counts', () => {
    const m = new PreviewKeymap();
    expect(m.feed(k('j'))).toEqual({ kind: 'scroll', unit: 'line', n: 1 });
    expect(m.feed(k('k'))).toEqual({ kind: 'scroll', unit: 'line', n: -1 });
    expect(m.feed(k('5'))).toEqual({ kind: 'pending' });
    expect(m.pending).toBe('5');
    expect(m.feed(k('j'))).toEqual({ kind: 'scroll', unit: 'line', n: 5 });
    expect(m.feed(k('ArrowDown'))).toEqual({ kind: 'scroll', unit: 'line', n: 1 });
  });
  it('d/u and Ctrl-d/Ctrl-u half pages; space / b page', () => {
    const m = new PreviewKeymap();
    expect(m.feed(k('d'))).toEqual({ kind: 'scroll', unit: 'half', n: 1 });
    expect(m.feed(k('u'))).toEqual({ kind: 'scroll', unit: 'half', n: -1 });
    expect(m.feed(k('d', { ctrlKey: true }))).toEqual({ kind: 'scroll', unit: 'half', n: 1 });
    expect(m.feed(k('u', { ctrlKey: true }))).toEqual({ kind: 'scroll', unit: 'half', n: -1 });
    expect(m.feed(k(' '))).toEqual({ kind: 'scroll', unit: 'page', n: 1 });
    expect(m.feed(k(' ', { shiftKey: true }))).toEqual({ kind: 'scroll', unit: 'page', n: -1 });
    expect(m.feed(k('b'))).toEqual({ kind: 'scroll', unit: 'page', n: -1 });
  });
  it('gg / G', () => {
    const m = new PreviewKeymap();
    expect(m.feed(k('g'))).toEqual({ kind: 'pending' });
    expect(m.pending).toBe('g');
    expect(m.feed(k('g'))).toEqual({ kind: 'top' });
    expect(m.feed(k('G'))).toEqual({ kind: 'bottom' });
  });
  it('heading jumps: } { and ]] [[ (with counts)', () => {
    const m = new PreviewKeymap();
    expect(m.feed(k('}'))).toEqual({ kind: 'heading', dir: 1, n: 1 });
    expect(m.feed(k('{'))).toEqual({ kind: 'heading', dir: -1, n: 1 });
    m.feed(k(']'));
    expect(m.feed(k(']'))).toEqual({ kind: 'heading', dir: 1, n: 1 });
    m.feed(k('2'));
    m.feed(k('['));
    expect(m.feed(k('['))).toEqual({ kind: 'heading', dir: -1, n: 2 });
  });
  it('a chord prefix expires', () => {
    let t = 0;
    const m = new PreviewKeymap(() => t);
    m.feed(k('g'));
    t = PREVIEW_CHORD_MS + 5;
    expect(m.feed(k('g'))).toEqual({ kind: 'pending' }); // a fresh g
  });
  it('/ find, n N, f hints, y copy, Enter open', () => {
    const m = new PreviewKeymap();
    expect(m.feed(k('/'))).toEqual({ kind: 'find' });
    expect(m.feed(k('n'))).toEqual({ kind: 'findNext', dir: 1 });
    expect(m.feed(k('N'))).toEqual({ kind: 'findNext', dir: -1 });
    expect(m.feed(k('f'))).toEqual({ kind: 'hints' });
    expect(m.feed(k('F'))).toEqual({ kind: 'hints' });
    expect(m.feed(k('y'))).toEqual({ kind: 'yank' });
    expect(m.feed(k('Enter'))).toEqual({ kind: 'open' });
  });
  it('q / Esc / e / i go back to the editor', () => {
    const m = new PreviewKeymap();
    for (const key of ['q', 'Escape', 'e', 'i']) expect(m.feed(k(key))).toEqual({ kind: 'back' });
  });
  it('browser / app keys pass through', () => {
    const m = new PreviewKeymap();
    expect(m.feed(k('c', { metaKey: true }))).toBeNull();
    expect(m.feed(k('f', { ctrlKey: true }))).toBeNull(); // browser find
    expect(m.feed(k('Tab'))).toBeNull();
    expect(m.feed(k('x'))).toBeNull();
  });
});

describe('headingTarget', () => {
  const tops = [0, 300, 900, 1500];
  it('next heading below the top of the view', () => {
    expect(headingTarget(tops, 0, 1)).toBe(300);
    expect(headingTarget(tops, 300, 1)).toBe(900);
    expect(headingTarget(tops, 302, 1)).toBe(900); // within slack = here
    expect(headingTarget(tops, 0, 1, 2)).toBe(900);
    expect(headingTarget(tops, 1500, 1)).toBeNull();
    expect(headingTarget(tops, 0, 1, 99)).toBe(1500);
  });
  it('previous heading above it', () => {
    expect(headingTarget(tops, 900, -1)).toBe(300);
    expect(headingTarget(tops, 1000, -1)).toBe(900);
    expect(headingTarget(tops, 1000, -1, 2)).toBe(300);
    expect(headingTarget(tops, 0, -1)).toBeNull();
    expect(headingTarget([], 0, 1)).toBeNull();
  });
});

describe('find', () => {
  it('findOffsets is smartcase', () => {
    expect(findOffsets('Foo foo FOO', 'foo')).toEqual([0, 4, 8]);
    expect(findOffsets('Foo foo FOO', 'Foo')).toEqual([0]);
    expect(findOffsets('aaaa', 'aa')).toEqual([0, 2]);
    expect(findOffsets('abc', '')).toEqual([]);
  });
  it('nextMatchIndex wraps both ways', () => {
    expect(nextMatchIndex(3, -1, 1)).toBe(0);
    expect(nextMatchIndex(3, -1, -1)).toBe(2);
    expect(nextMatchIndex(3, 2, 1)).toBe(0);
    expect(nextMatchIndex(3, 0, -1)).toBe(2);
    expect(nextMatchIndex(0, 0, 1)).toBe(-1);
  });
  it('findRanges spans inline elements and skips buttons', () => {
    const root = document.createElement('div');
    root.innerHTML = '<p>hello <strong>wor</strong>ld</p><button>world</button><p>World again</p>';
    const r = findRanges(root, 'world');
    expect(r.map((x) => x.toString())).toEqual(['world', 'World']);
  });
});
