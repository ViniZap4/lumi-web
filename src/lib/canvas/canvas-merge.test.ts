// Concurrent canvas edits through real Y.Docs: which merges keep the
// JSON valid. Each test syncs two replicas, lets both write against
// their CURRENT text (commitCanvas → yLiveText, as the view does), then
// exchanges the updates like the server would.

import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { yLiveText } from '../live-text-y.ts';
import { addNode, commitCanvas, parseCanvas, patchNodes, serializeCanvas, type CanvasOp, type TextNode } from './canvas.ts';
import { splitJsonDocuments } from './canvas-recover.ts';

function pair(initial: string): [Y.Doc, Y.Doc] {
  const a = new Y.Doc();
  const b = new Y.Doc();
  if (initial) a.getText('content').insert(0, initial);
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  return [a, b];
}
function exchange(a: Y.Doc, b: Y.Doc): void {
  const ua = Y.encodeStateAsUpdate(a, Y.encodeStateVector(b));
  const ub = Y.encodeStateAsUpdate(b, Y.encodeStateVector(a));
  Y.applyUpdate(b, ua);
  Y.applyUpdate(a, ub);
}
function commit(d: Y.Doc, op: CanvasOp): void {
  const lt = yLiveText(d.getText('content'));
  lt.apply(commitCanvas(lt.read(), op));
}
const text = (d: Y.Doc) => d.getText('content').toString();
const card = (id: string, x = 0, y = 0): TextNode => ({ id, type: 'text', text: id, x, y, width: 200, height: 60 });

function obsidian(n: number): string {
  const nodes = Array.from({ length: n }, (_, i) => card(`n${i + 1}`, i * 300, 0));
  return serializeCanvas({ top: { nodes, edges: [] }, nodes, edges: [] });
}

describe('concurrent canvas commits (CRDT merge)', () => {
  it('a multi-node move and a concurrent edit of a node in between stay valid JSON', () => {
    // Before: commitCanvas sent ONE prefix/suffix edit spanning n1..n5,
    // which deleted and re-inserted n2..n4. B's concurrent edit of n3
    // landed inside the deleted span and survived as an orphan
    // fragment next to A's re-inserted copy of n3 → invalid JSON.
    const [a, b] = pair(obsidian(5));
    commit(a, patchNodes({ n1: { x: 40, y: 40 }, n5: { x: 1240, y: 40 } }));
    commit(b, patchNodes({ n3: { text: 'edited on B' } }));
    exchange(a, b);
    expect(text(a)).toBe(text(b));
    const p = parseCanvas(text(a));
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const byId = Object.fromEntries(p.nodes.map((n) => [n.id, n]));
    expect(byId.n1).toMatchObject({ x: 40, y: 40 });
    expect(byId.n5).toMatchObject({ x: 1240, y: 40 });
    expect((byId.n3 as TextNode).text).toBe('edited on B');
    expect(p.nodes).toHaveLength(5);
  });

  it('first writes on an EMPTY text from two replicas concatenate two documents ({…}{…})', () => {
    // An empty Y.Text parses as an empty canvas, so each replica's
    // first commit inserts a whole document at index 0. Concurrent
    // inserts at the same index are both kept: the file becomes two
    // concatenated JSON objects. Detected and repairable (one is kept).
    const [a, b] = pair('');
    commit(a, addNode(card('fromA')));
    commit(b, addNode(card('fromB')));
    exchange(a, b);
    const merged = text(a);
    expect(parseCanvas(merged).ok).toBe(false);
    const docs = splitJsonDocuments(merged);
    expect(docs).not.toBeNull();
    expect(docs!.map((d) => parseCanvas(d.text).ok)).toEqual([true, true]);
  });

  it('two replicas adding the first card to the old single-line empty canvas cannot merge validly (restore path)', () => {
    // `{"nodes":[],"edges":[]}\n` (servers before the multi-line empty
    // canvas) is single-line, so the first commit also restyles it:
    // both replicas replace the same span and both inserts survive.
    const [a, b] = pair('{"nodes":[],"edges":[]}\n');
    commit(a, addNode(card('fromA')));
    commit(b, addNode(card('fromB')));
    exchange(a, b);
    expect(parseCanvas(text(a)).ok).toBe(false);
  });

  it('concurrent first cards on the multi-line empty canvas: tolerated on read, healed by the next commit', () => {
    // The server's empty canvas is multi-line, so each first card is
    // inserted as whole lines inside `[` … `]`. Merged, the two objects
    // sit on adjacent lines with NO comma between them.
    const EMPTY = '{\n\t"nodes":[],\n\t"edges":[]\n}';
    const [a, b] = pair(EMPTY);
    commit(a, addNode(card('fromA')));
    commit(b, addNode(card('fromB')));
    exchange(a, b);
    const merged = text(a);
    expect(() => JSON.parse(merged)).toThrow();
    expect(merged).toMatch(/\}\s*\n\s*\{/);
    // Read: both cards, no error (no banner).
    const p = parseCanvas(merged);
    expect(p.ok).toBe(true);
    if (p.ok) expect(p.nodes.map((n) => n.id).sort()).toEqual(['fromA', 'fromB']);
    // Nothing was written by reading.
    expect(text(a)).toBe(merged);
    // A later commit from either side re-serialises valid JSON, and the
    // merge with the other replica stays valid.
    for (const side of ['a', 'b'] as const) {
      const [x, y] = pair(merged);
      commit(side === 'a' ? x : y, patchNodes({ fromA: { x: 500 } }));
      exchange(x, y);
      expect(text(x)).toBe(text(y));
      expect(() => JSON.parse(text(x))).not.toThrow();
      const q = parseCanvas(text(x));
      expect(q.ok && q.nodes.find((n) => n.id === 'fromA')?.x).toBe(500);
      // Commas only between elements: no trailing comma before `]`.
      expect(text(x)).not.toMatch(/,\s*\]/);
    }
  });

  it('appending cards concurrently to a non-empty canvas stays valid', () => {
    const [a, b] = pair(obsidian(2));
    commit(a, addNode(card('fromA')));
    commit(b, addNode(card('fromB')));
    exchange(a, b);
    const p = parseCanvas(text(a));
    expect(p.ok).toBe(true);
    if (p.ok) expect(p.nodes.map((n) => n.id).sort()).toEqual(['fromA', 'fromB', 'n1', 'n2']);
  });
});
