// JSON Canvas parse (lib/canvas/canvas.ts) on Obsidian-layout files.
import { bench, describe } from 'vitest';
import { parseCanvas } from '../lib/canvas/canvas.ts';
import { canvasCorpus } from './corpus.ts';

const OPTS = { time: 400, warmupTime: 100 };

for (const [nodes, edges] of [[100, 120], [1000, 1200]] as const) {
  const text = canvasCorpus(nodes, edges);
  describe(`canvas ${nodes} nodes`, () => {
    bench('parseCanvas', () => {
      const p = parseCanvas(text);
      if (!p.ok) throw new Error('corpus must parse');
    }, OPTS);
  });
}
