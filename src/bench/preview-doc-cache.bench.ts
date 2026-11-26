// @vitest-environment jsdom
// Reader / split preview re-render after a one-block edit (WP0.5,
// docs/phase3/research/03 §a.2): the shared 800-entry LRU (before)
// vs the per-document cache with incremental lexing (after).
// Run: npx vitest bench --run src/bench/preview-doc-cache.bench.ts
import { bench, describe } from 'vitest';
import { renderBlocks, createDocRenderCache } from '../lib/markdown.ts';
import { blockDenseNote, midParagraph } from './corpus.ts';

for (const kb of [10, 100, 300]) {
  const base = blockDenseNote(kb * 1024);
  const at = midParagraph(base);
  // Two versions that differ by one character in one paragraph; the
  // preview alternates between them like typing would.
  const a = base.slice(0, at) + 'x' + base.slice(at);
  const b = base.slice(0, at) + 'y' + base.slice(at);
  const cache = createDocRenderCache();
  renderBlocks(a, { cache });
  let flip = false;

  describe(`preview one-block edit, ${kb} KB block-dense`, () => {
    bench('before: shared LRU (no document cache)', () => {
      flip = !flip;
      renderBlocks(flip ? a : b);
    }, { iterations: kb >= 100 ? 5 : 20 });
    bench('after: per-document cache + incremental lex', () => {
      flip = !flip;
      renderBlocks(flip ? a : b, { cache });
    });
  });
}
