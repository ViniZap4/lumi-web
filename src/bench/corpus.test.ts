// The bench corpora must never drift silently: a changed generator
// changes every baseline. If this fails on purpose, regenerate
// src/bench/baseline.json in the same commit and update the hashes.
import { describe, it, expect } from 'vitest';
import { corpus, kanbanCorpus, canvasCorpus, KB } from './corpus.ts';
import { parseKanban } from '../lib/kanban/kanban.ts';
import { parseCanvas } from '../lib/canvas/canvas.ts';

function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, '0');
}

describe('bench corpora', () => {
  it('are deterministic and close to the requested size', () => {
    for (const kind of ['prose', 'dense'] as const) {
      const a = corpus(kind, 20 * KB);
      expect(a.length).toBeGreaterThanOrEqual(20 * KB);
      expect(a.length).toBeLessThan(21 * KB);
    }
  });

  it('keep their recorded bytes', () => {
    expect({
      prose20: fnv1a(corpus('prose', 20 * KB)),
      dense20: fnv1a(corpus('dense', 20 * KB)),
      kanban: fnv1a(kanbanCorpus(8, 60)),
      canvas: fnv1a(canvasCorpus(100, 120)),
    }).toMatchInlineSnapshot(`
      {
        "canvas": "114b83e3",
        "dense20": "922eeddc",
        "kanban": "e9bc1a2a",
        "prose20": "47f87eb1",
      }
    `);
  });

  it('parse as the structured formats they imitate', () => {
    const b = parseKanban(kanbanCorpus(8, 60));
    expect(b.lanes).toHaveLength(8);
    expect(b.lanes.reduce((n, l) => n + l.cards.length, 0)).toBe(480);
    const c = parseCanvas(canvasCorpus(100, 120));
    expect(c.ok && c.nodes.length).toBe(100);
  });
});
