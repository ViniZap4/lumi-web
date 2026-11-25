import { describe, it, expect } from 'vitest';
import { applyTextEdits, assertDisjoint, diffEdits, diffRange, editCost } from './text-diff.ts';

describe('diffEdits (multi-hunk ranged edits)', () => {
  it('two distant line changes become two small edits, not one span', () => {
    const lines = Array.from({ length: 8 }, (_, i) => `{"id":"n${i}","x":${i * 10}}`);
    const a = lines.join('\n') + '\n';
    const b = a.replace('"x":0}', '"x":5}').replace('"x":70}', '"x":75}');
    const e = diffEdits(a, b);
    expect(e).toHaveLength(2);
    expect(applyTextEdits(a, e)).toBe(b);
    expect(editCost(e)).toBeLessThan(editCost([diffRange(a, b)!]));
    // Nothing between the two changes is touched.
    expect(e.every((x) => x.to - x.from <= 2)).toBe(true);
  });

  it('equal texts → no edits; single-line change → the prefix/suffix edit', () => {
    expect(diffEdits('abc', 'abc')).toEqual([]);
    expect(diffEdits('a\nb\nc\n', 'a\nB\nc\n')).toEqual([diffRange('a\nb\nc\n', 'a\nB\nc\n')]);
  });

  it('random texts: edits are disjoint and reproduce the target exactly', () => {
    let seed = 7;
    const r = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const alpha = ['a\n', 'b\n', 'c\n', 'dd', 'e\n', '\n', 'x', '{"y":1}\n', '😀\n'];
    for (let t = 0; t < 3000; t++) {
      const mk = () => Array.from({ length: Math.floor(r() * 14) }, () => alpha[Math.floor(r() * alpha.length)]).join('');
      const a = mk();
      const b = r() < 0.5 ? mk() : a.split('\n').map((l) => (r() < 0.2 ? l + 'Z' : l)).filter(() => r() > 0.1).join('\n');
      const e = diffEdits(a, b, r() < 0.2 ? 1 : 400);
      assertDisjoint(e);
      expect(applyTextEdits(a, e)).toBe(b);
    }
  });
});
