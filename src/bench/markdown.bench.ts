// @vitest-environment jsdom
//
// Reader / split preview render (lib/markdown.ts). The "one-block edit"
// case is what the split preview pays after each typing pause: one
// block changes, the rest should come from the cache.
// Budget context: docs/PERF-BUDGETS.md (preview re-render <= 10 ms at
// 100 KB after WP 0.5).
import { bench, describe } from 'vitest';
import { renderBlocks, renderMarkdown } from '../lib/markdown.ts';
import { corpus, KB } from './corpus.ts';

const OPTS = { time: 400, warmupTime: 100 };

for (const [kind, size] of [['prose', 10 * KB], ['prose', 100 * KB], ['dense', 100 * KB]] as const) {
  const src = corpus(kind, size);
  const mid = src.indexOf('\n\n', src.length >> 1) + 2;
  let n = 0;
  describe(`markdown ${kind} ${size / KB} KB`, () => {
    bench('renderBlocks after a one-block edit', () => {
      n++;
      renderBlocks(src.slice(0, mid) + `edit ${n} ` + src.slice(mid));
    }, OPTS);
    bench('renderMarkdown, unchanged source', () => {
      renderMarkdown(src);
    }, OPTS);
  });
}
