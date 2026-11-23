import { describe, it, expect, vi } from 'vitest';
import { normalizeAnchors, lineToOffset, offsetToLine, ScrollLeader, debounce, PREVIEW_DEBOUNCE_MS } from './scroll-sync.ts';

describe('split preview scroll-sync mapping', () => {
  // Blocks at source lines 0, 4, 10 rendered at 0, 120, 400 px; doc
  // has 20 lines, preview content 800 px.
  const anchors = normalizeAnchors([{ line: 4, top: 120 }, { line: 0, top: 0 }, { line: 10, top: 400 }], 20, 800);

  it('normalizes: sorted, start + end sentinel', () => {
    expect(anchors).toEqual([{ line: 0, top: 0 }, { line: 4, top: 120 }, { line: 10, top: 400 }, { line: 20, top: 800 }]);
  });
  it('maps block starts exactly', () => {
    expect(lineToOffset(anchors, 4)).toBe(120);
    expect(lineToOffset(anchors, 10)).toBe(400);
  });
  it('interpolates inside a block (no jumps)', () => {
    expect(lineToOffset(anchors, 2)).toBe(60);
    expect(lineToOffset(anchors, 7)).toBe(260);
    expect(lineToOffset(anchors, 15)).toBe(600);
  });
  it('is the inverse of offsetToLine', () => {
    for (const l of [0, 1.5, 4, 6.25, 10, 13, 19.5]) expect(offsetToLine(anchors, lineToOffset(anchors, l))).toBeCloseTo(l, 6);
  });
  it('is monotonic', () => {
    let prev = -1;
    for (let l = 0; l <= 20; l += 0.25) {
      const y = lineToOffset(anchors, l);
      expect(y).toBeGreaterThanOrEqual(prev);
      prev = y;
    }
  });
  it('clamps outside the range', () => {
    expect(lineToOffset(anchors, -3)).toBe(0);
    expect(lineToOffset(anchors, 99)).toBe(800);
    expect(offsetToLine(anchors, 5000)).toBe(20);
  });
  it('drops anchors that go backwards (floats, measurement glitches)', () => {
    const a = normalizeAnchors([{ line: 2, top: 100 }, { line: 5, top: 50 }, { line: 8, top: 300 }], 10, 400);
    expect(a.map((x) => x.line)).toEqual([0, 2, 8, 10]);
  });
  it('handles an empty preview', () => {
    const a = normalizeAnchors([], 0, 0);
    expect(lineToOffset(a, 0)).toBe(0);
    expect(offsetToLine(a, 0)).toBe(0);
  });
});

describe('ScrollLeader', () => {
  it('only the side the user touched drives', () => {
    const l = new ScrollLeader();
    expect(l.accepts('source')).toBe(true);
    expect(l.accepts('preview')).toBe(false);
    l.claim('preview');
    expect(l.accepts('preview')).toBe(true);
    expect(l.accepts('source')).toBe(false);
  });
});

describe('debounced re-render', () => {
  it('waits ~100–150 ms after the last change and renders once', () => {
    vi.useFakeTimers();
    try {
      expect(PREVIEW_DEBOUNCE_MS).toBeGreaterThanOrEqual(100);
      expect(PREVIEW_DEBOUNCE_MS).toBeLessThanOrEqual(150);
      const fn = vi.fn();
      const d = debounce(fn, PREVIEW_DEBOUNCE_MS);
      d('a');
      vi.advanceTimersByTime(80);
      d('b');
      vi.advanceTimersByTime(80);
      d('c');
      expect(fn).not.toHaveBeenCalled();
      vi.advanceTimersByTime(PREVIEW_DEBOUNCE_MS);
      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith('c');
      d('d');
      d.cancel();
      vi.advanceTimersByTime(500);
      expect(fn).toHaveBeenCalledTimes(1);
      d('e');
      d.flush();
      expect(fn).toHaveBeenLastCalledWith('e');
    } finally {
      vi.useRealTimers();
    }
  });
});
