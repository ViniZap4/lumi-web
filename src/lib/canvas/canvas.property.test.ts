// Property tests for the JSON Canvas reader and committer (Phase 3
// quality harness, docs/phase3/research/09 Q6): the parser never throws,
// files written in either layout round-trip byte for byte, a no-op
// commit writes nothing, a commit lands exactly the serialized result as
// minimal disjoint edits, and comma healing only ever adds commas.
//
// FC_RUNS raises the run count (nightly); the default keeps `npm test` fast.
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  parseCanvas,
  serializeCanvas,
  commitCanvas,
  patchNodes,
  addNode,
  removeItems,
  type CanvasData,
  type CanvasStyle,
  type CanvasNode,
} from './canvas.ts';
import { healMissingCommas } from './canvas-recover.ts';
import { applyTextEdits, assertDisjoint } from '../text-diff.ts';

const RUNS = Number((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.FC_RUNS || 200);
const TIMEOUT = Math.max(5_000, RUNS * 10);

const id = fc.stringMatching(/^[0-9a-f]{4,16}$/);
const coord = fc.integer({ min: -5000, max: 5000 });
const size = fc.integer({ min: 1, max: 2000 });
const text = fc.string({ unit: 'grapheme', maxLength: 40 });

const nodeArb: fc.Arbitrary<Record<string, unknown>> = fc
  .tuple(
    id,
    fc.constantFrom('text', 'file', 'link', 'group'),
    coord,
    coord,
    size,
    size,
    text,
    fc.option(fc.constantFrom('1', '4', '#3366ff'), { nil: undefined }),
  )
  .map(([nid, type, x, y, width, height, t, color]) => {
    const n: Record<string, unknown> = { id: nid, type, x, y, width, height };
    if (type === 'text') n.text = t;
    if (type === 'file') n.file = `notes/${t.replace(/[\\/]/g, '')}.md`;
    if (type === 'link') n.url = `https://example.com/${encodeURIComponent(t)}`;
    if (type === 'group') n.label = t;
    if (color) n.color = color;
    return n;
  });

const canvasArb = fc
  .tuple(fc.uniqueArray(nodeArb, { selector: (n) => n.id as string, maxLength: 8 }), fc.nat(6), fc.boolean())
  .map(([nodes, nEdges, extraKey]) => {
    const edges = [];
    for (let i = 0; i < Math.min(nEdges, nodes.length); i++) {
      edges.push({ id: `e${i}`, fromNode: nodes[i].id, fromSide: 'right', toNode: nodes[(i + 1) % nodes.length].id, toSide: 'left' });
    }
    const top: Record<string, unknown> = { nodes, edges };
    if (extraKey) top['x-lumi'] = { kept: true };
    return { top, nodes, edges } as CanvasData;
  });

const styleArb: fc.Arbitrary<CanvasStyle> = fc.record({
  layout: fc.constantFrom('compact' as const, 'pretty' as const),
  indent: fc.constantFrom('\t', '  ', '    '),
  trailingNewline: fc.boolean(),
});

function parsed(t: string) {
  const p = parseCanvas(t);
  if (!p.ok) throw new Error(p.error);
  return p;
}

describe('canvas properties', () => {
  it('parseCanvas never throws, for any text', () => {
    fc.assert(
      fc.property(fc.oneof(fc.string({ maxLength: 200 }), fc.json(), canvasArb.map((d) => serializeCanvas(d))), (t) => {
        const p = parseCanvas(t);
        expect(typeof p.ok).toBe('boolean');
      }),
      { numRuns: RUNS },
    );
  });

  it('a written canvas round-trips byte for byte in its own style', () => {
    fc.assert(
      fc.property(canvasArb, styleArb, (data, style) => {
        const t = serializeCanvas(data, style);
        const p = parsed(t);
        expect(serializeCanvas(p.data, p.style)).toBe(t);
        expect(p.nodes.length).toBe(data.nodes.length);
        expect(p.edges.length).toBe(data.edges.length);
      }),
      { numRuns: RUNS },
    );
  }, TIMEOUT);

  it('a no-op commit writes nothing', () => {
    fc.assert(
      fc.property(canvasArb, styleArb, (data, style) => {
        const t = serializeCanvas(data, style);
        expect(commitCanvas(t, (d) => d)).toEqual([]);
      }),
      { numRuns: RUNS },
    );
  }, TIMEOUT);

  it('a commit is disjoint edits that land exactly the serialized result', () => {
    const op = fc.oneof(
      fc.tuple(coord, coord).map(([dx, dy]) => (d: CanvasData) => {
        const first = d.nodes[0] as CanvasNode | undefined;
        return first ? patchNodes({ [first.id]: { x: first.x + dx, y: first.y + dy } })(d) : d;
      }),
      nodeArb.map((n) => (d: CanvasData) => (d.nodes.some((x) => (x as CanvasNode).id === n.id) ? d : addNode(n as CanvasNode)(d))),
      fc.nat(8).map((i) => (d: CanvasData) => {
        const n = d.nodes[i] as CanvasNode | undefined;
        return n ? removeItems([n.id])(d) : d;
      }),
    );
    fc.assert(
      fc.property(canvasArb, styleArb, op, (data, style, f) => {
        const t = serializeCanvas(data, style);
        const p = parsed(t);
        const want = serializeCanvas(f(p.data), p.style);
        const edits = commitCanvas(t, f);
        assertDisjoint(edits);
        expect(applyTextEdits(t, edits)).toBe(want);
        // Minimal: never more characters than a whole rewrite would touch.
        const cost = edits.reduce((n, e) => n + (e.to - e.from) + e.insert.length, 0);
        expect(cost).toBeLessThanOrEqual(t.length + want.length);
      }),
      { numRuns: RUNS },
    );
  }, TIMEOUT);

  it('healMissingCommas only inserts commas after a closing brace, never on valid JSON', () => {
    const glued = canvasArb.map((d) => serializeCanvas(d).replace(/\},\n/g, '}\n'));
    fc.assert(
      fc.property(fc.oneof(fc.string({ maxLength: 120 }), glued, fc.json()), (s) => {
        const healed = healMissingCommas(s);
        let valid = true;
        try {
          JSON.parse(s);
        } catch {
          valid = false;
        }
        if (valid) expect(healed).toBeNull();
        if (healed == null) return;
        expect(healed.length).toBeGreaterThan(s.length);
        let i = 0;
        for (let j = 0; j < healed.length; j++) {
          if (i < s.length && s[i] === healed[j]) {
            i++;
            continue;
          }
          expect(healed[j]).toBe(',');
          expect(healed[j - 1]).toBe('}');
        }
        expect(i).toBe(s.length);
      }),
      { numRuns: RUNS },
    );
  }, TIMEOUT);
});
