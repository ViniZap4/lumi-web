// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { buildToc, activeTocIndex, tocDepths, tocFits } from './toc.ts';
import { renderMarkdown } from './markdown.ts';

describe('toc', () => {
  it('builds the outline from rendered headings, without the anchor glyph', () => {
    const root = document.createElement('div');
    root.innerHTML = renderMarkdown('# Title\n\ntext\n\n## Goals *and* scope\n\n### Deep\n\n##### too deep\n\n## Next');
    const toc = buildToc(root);
    expect(toc.map((t) => [t.level, t.text])).toEqual([
      [1, 'Title'],
      [2, 'Goals and scope'],
      [3, 'Deep'],
      [2, 'Next'],
    ]);
    expect(toc.every((t) => root.querySelector('[id="' + t.id + '"]'))).toBe(true);
  });
  it('is empty without a root or headings', () => {
    expect(buildToc(null)).toEqual([]);
    const root = document.createElement('div');
    root.innerHTML = renderMarkdown('just text');
    expect(buildToc(root)).toEqual([]);
  });
  it('maxLevel limits depth', () => {
    const root = document.createElement('div');
    root.innerHTML = renderMarkdown('# a\n\n## b\n\n### c');
    expect(buildToc(root, 2).map((t) => t.text)).toEqual(['a', 'b']);
  });
  it('active section = last heading at or above the offset', () => {
    expect(activeTocIndex([200, 400], 96)).toBe(-1);
    expect(activeTocIndex([-50, 90, 400], 96)).toBe(1);
    expect(activeTocIndex([-900, -500, -10], 96)).toBe(2);
    expect(activeTocIndex([], 96)).toBe(-1);
  });
  it('indents relative to the shallowest heading, capped', () => {
    expect(tocDepths([
      { id: 'a', text: 'a', level: 2 },
      { id: 'b', text: 'b', level: 3 },
      { id: 'c', text: 'c', level: 6 },
    ])).toEqual([0, 1, 3]);
    expect(tocDepths([])).toEqual([]);
  });
  it('fits only when the gutter holds the rail', () => {
    expect(tocFits(1440, 850)).toBe(true); // (1440-850)/2 = 295 ≥ 252
    expect(tocFits(1280, 850)).toBe(false); // 215
    expect(tocFits(1920, 1900)).toBe(false); // full width: no gutter
  });
});
