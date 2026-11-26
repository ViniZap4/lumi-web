// @vitest-environment jsdom
// The per-document render cache (DocRenderCache) must always produce
// exactly what a cold render does, while lexing incrementally and
// re-rendering only the edited block.
import { describe, it, expect } from 'vitest';
import { renderBlocks, createDocRenderCache, renderStats } from './markdown.ts';
import { blockDenseNote } from '../bench/corpus.ts';

const BASE = [
  '# Title', '', 'Para **bold** with a [link](https://x.test) and #tag.', 'second line', '',
  '- [ ] a', '- [x] b', '  - nested', '', '1. one', '2. two', '', '> [!note] Callout', '> body', '',
  '| a | b |', '|---|---|', '| 1 | 2 |', '', '```js', 'let x = 1;', '', 'more code', '```', '',
  'Setext', '---', '', '<div>html</div>', '', 'Footnote ref[^1].', '', '[^1]: the note', '',
  '    indented code', '', '==mark== end', '',
].join('\n');

const SNIPPETS = ['x', ' ', '\n', '\n\n', '`', '```', '```\n', '~~~', '|', '| a |', '|---|', '- [ ] ', '- ', '> ', '**', '*', '# ', '---', '===', '<div>', '<!--', '-->', '    ', '1. ', '[^1]', '[r]: https://r.test', '[r]', '\t'];

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

function edit(src: string, r: () => number): string {
  const at = Math.floor(r() * (src.length + 1));
  if (r() < 0.4 && src.length) {
    const to = Math.min(src.length, at + 1 + Math.floor(r() * 8));
    return src.slice(0, at) + src.slice(to);
  }
  return src.slice(0, at) + SNIPPETS[Math.floor(r() * SNIPPETS.length)] + src.slice(at);
}

const strip = (bs: ReturnType<typeof renderBlocks>) => bs.map((b) => ({ key: b.key, line: b.line, endLine: b.endLine, html: b.html }));

describe('DocRenderCache equals a cold render', () => {
  for (const seed of Array.from({ length: 30 }, (_, i) => i + 1)) {
    it(`random edits, seed ${seed}`, () => {
      const r = rng(seed);
      const cache = createDocRenderCache();
      let src = BASE;
      for (let step = 0; step < 120; step++) {
        src = edit(src, r);
        const got = strip(renderBlocks(src, { cache }));
        const want = strip(renderBlocks(src));
        if (JSON.stringify(got) !== JSON.stringify(want)) expect({ step, src, got }).toEqual({ step, src, got: want });
      }
      // Full lexes are expected once a `]:` (reference definition) shows up.
      expect(cache.stats.incremental + cache.stats.full).toBeGreaterThan(0);
    });
  }
});

describe('DocRenderCache on a large note', () => {
  it('a one-block edit lexes incrementally and parses one block', () => {
    const src = blockDenseNote(100 * 1024);
    const cache = createDocRenderCache();
    renderBlocks(src, { cache });
    const at = src.indexOf('## Item 400');
    const next = src.slice(0, at) + '## Item 400 edited' + src.slice(at + '## Item 400'.length);
    const before = renderStats().parsed;
    const fullBefore = cache.stats.full;
    const blocks = renderBlocks(next, { cache });
    expect(renderStats().parsed - before).toBe(1);
    expect(cache.stats.full).toBe(fullBefore);
    expect(strip(blocks)).toEqual(strip(renderBlocks(next)));
  }, 60_000); // two cold renders of 100 KB under jsdom
  it('the cache holds only the current note\'s blocks', () => {
    const cache = createDocRenderCache();
    renderBlocks(blockDenseNote(20 * 1024), { cache });
    const n = cache.html.size;
    renderBlocks('# other\n\njust one paragraph', { cache });
    expect(cache.html.size).toBeLessThan(5);
    expect(n).toBeGreaterThan(100);
  });
});
