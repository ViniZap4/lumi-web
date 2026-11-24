import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  parseCanvas, serializeCanvas, commitCanvas, patchNodes, addNode, addEdge, removeItems, patchEdge,
  canvasColor, newCanvasId, detectCanvasStyle, type CanvasData,
} from './canvas.ts';
import {
  zoomAt, toScreen, toWorld, fitRect, boundsOf, wheel, nearestSide, autoSides, edgeGeometry, cubicAt,
  hitNode, readingOrder, clampZoom, MIN_ZOOM, MAX_ZOOM, type Viewport,
} from './canvas-view.ts';
import { CanvasKeys } from './canvas-keys.ts';
import { applyTextEdits, diffRange, editCost } from '../text-diff.ts';
import { memoryLiveText } from '../live-text.ts';

const dir = new URL('../../test/fixtures/canvas/', import.meta.url);
const read = (f: string) => readFileSync(new URL(f, dir), 'utf8');
const obsidian = read('obsidian.canvas');
const pretty = read('pretty.canvas');

function ok(text: string) {
  const p = parseCanvas(text);
  if (!p.ok) throw new Error(p.error);
  return p;
}

describe('canvas parse / serialize', () => {
  it('round-trips Obsidian files byte for byte', () => {
    const p = ok(obsidian);
    expect(p.style).toEqual({ layout: 'compact', indent: '\t', trailingNewline: false });
    expect(serializeCanvas(p.data, p.style)).toBe(obsidian);
    expect(p.nodes.map((n) => n.type)).toEqual(['group', 'text', 'file', 'link', 'text']);
    expect(p.edges).toHaveLength(3);
    expect(p.issues).toEqual([]);
  });

  it('round-trips pretty JSON (2 spaces, key order, extra keys, trailing newline)', () => {
    const p = ok(pretty);
    expect(p.style).toEqual({ layout: 'pretty', indent: '  ', trailingNewline: true });
    expect(serializeCanvas(p.data, p.style)).toBe(pretty);
    expect(Object.keys(p.data.top)).toEqual(['edges', 'nodes', 'metadata']);
    // Edges to nodes missing from this file are reported, not dropped from disk.
    expect(p.edges.map((e) => e.id)).toEqual(['f5a6b7c8d9e0f1a2']);
    expect(p.issues.filter((i) => i.includes('dangling'))).toHaveLength(2);
  });

  it('is tolerant: empty, {}, missing keys, bad nodes, invalid JSON', () => {
    expect(ok('').nodes).toEqual([]);
    expect(ok('{}').nodes).toEqual([]);
    const p = ok('{"nodes":[{"id":"a","type":"text","text":"x"},{"type":"text"},{"id":"b","type":"weird"},{"id":"a","type":"text","x":0,"y":0,"width":1,"height":1}],"edges":"nope"}');
    expect(p.nodes.map((n) => [n.id, n.x, n.width, n.height])).toEqual([['a', 0, 250, 60]]);
    expect(p.issues.join('|')).toMatch(/not an array.*geometry.*without id.*unknown type.*duplicate/);
    expect(parseCanvas('{"nodes": [').ok).toBe(false);
    expect(parseCanvas('[]').ok).toBe(false);
  });

  it('keeps unknown node keys and colors through edits', () => {
    const edits = commitCanvas(obsidian, patchNodes({ e4f5a6b7c8d9e0f1: { x: 100 } }));
    const next = applyTextEdits(obsidian, edits);
    expect(next).toContain('{"id":"e4f5a6b7c8d9e0f1","type":"text","text":"Unknown keys survive","x":100,"y":80,"width":250,"height":60,"styleAttributes":{"shape":"pill"}}');
  });

  it('validates colors without passing CSS through', () => {
    expect(canvasColor('3')).toEqual({ preset: 3 });
    expect(canvasColor('#a1B2c3')).toEqual({ hex: '#a1B2c3' });
    expect(canvasColor('red; background:url(x)')).toBeNull();
    expect(canvasColor('7')).toBeNull();
  });

  it('generates 16-hex ids', () => {
    expect(newCanvasId()).toMatch(/^[0-9a-f]{16}$/);
  });

  it('guesses a style for unknown layouts', () => {
    expect(detectCanvasStyle('{"nodes":[],"edges":[]}').layout).toBe('compact');
    expect(detectCanvasStyle('{\n    "nodes": [\n      {\n').indent).toBe('    ');
  });
});

describe('canvas commit = one minimal ranged edit', () => {
  it('moving a node only touches its numbers', () => {
    const edits = commitCanvas(obsidian, patchNodes({ b1c2d3e4f5a6b7c8: { x: -370, y: -190 } }));
    expect(edits).toHaveLength(1);
    // "x":-380,"y":-200 → "x":-370,"y":-190: one hunk from the first to the last changed digit.
    expect(edits[0].insert).toBe('70,"y":-19');
    expect(editCost(edits)).toBe(20);
    const p = ok(applyTextEdits(obsidian, edits));
    expect(p.nodes[1]).toMatchObject({ x: -370, y: -190 });
  });

  it('pretty files stay pretty', () => {
    const edits = commitCanvas(pretty, patchNodes({ b1c2d3e4f5a6b7c8: { width: 320 } }));
    expect(edits).toEqual([diffRange(pretty, pretty.replace('"width": 300', '"width": 320'))]);
  });

  it('adds, connects, recolors and removes', () => {
    const lt = memoryLiveText(obsidian);
    const commit = (op: (d: CanvasData) => CanvasData) => lt.apply(commitCanvas(lt.read(), op));
    commit(addNode({ id: 'n1', type: 'text', text: 'New', x: 500.4, y: 10, width: 250, height: 60 }));
    commit(addEdge({ id: 'e1', fromNode: 'n1', fromSide: 'left', toNode: 'c2d3e4f5a6b7c8d9', toSide: 'right' }));
    commit(patchNodes({ n1: { color: '2' } }));
    commit(patchEdge('e1', { label: 'link' }));
    let p = ok(lt.read());
    expect(p.nodes.at(-1)).toMatchObject({ id: 'n1', x: 500, color: '2' });
    expect(p.edges.at(-1)).toMatchObject({ id: 'e1', label: 'link' });
    expect(serializeCanvas(p.data, p.style)).toBe(lt.read());
    commit(removeItems(['c2d3e4f5a6b7c8d9']));
    p = ok(lt.read());
    expect(p.nodes.some((n) => n.id === 'c2d3e4f5a6b7c8d9')).toBe(false);
    expect(p.edges.map((e) => e.id)).toEqual(['a6b7c8d9e0f1a2b3']);
    // Groups are inserted at the bottom of the z order.
    commit(addNode({ id: 'g', type: 'group', x: 0, y: 0, width: 10, height: 10 }));
    expect(ok(lt.read()).nodes[0].id).toBe('g');
  });

  it('an empty file becomes an Obsidian-style canvas', () => {
    const edits = commitCanvas('', addNode({ id: 'a', type: 'text', text: 'hi', x: 0, y: 0, width: 250, height: 60 }));
    expect(applyTextEdits('', edits)).toBe('{\n\t"nodes":[\n\t\t{"id":"a","type":"text","text":"hi","x":0,"y":0,"width":250,"height":60}\n\t],\n\t"edges":[]\n}');
  });

  it('invalid JSON is never overwritten', () => {
    expect(commitCanvas('{"nodes": [', patchNodes({}))).toEqual([]);
  });

  it('no-op returns no edit', () => {
    expect(commitCanvas(obsidian, patchNodes({ b1c2d3e4f5a6b7c8: { x: -380 } }))).toEqual([]);
  });
});

describe('text diff', () => {
  it('prefix/suffix with surrogate safety', () => {
    expect(diffRange('abc', 'abc')).toBeNull();
    expect(diffRange('hello world', 'hello brave world')).toEqual({ from: 6, to: 6, insert: 'brave ' });
    expect(diffRange('aaa', 'aa')).toEqual({ from: 2, to: 3, insert: '' });
    // 😀 = 😀, 😁 = 😁: share the high surrogate.
    const e = diffRange('x😀y', 'x😁y')!;
    expect(e).toEqual({ from: 1, to: 3, insert: '😁' });
    expect(diffRange('ab', 'b', 10)).toEqual({ from: 10, to: 11, insert: '' });
  });
});

describe('pan / zoom math', () => {
  const v: Viewport = { x: 100, y: 50, zoom: 1 };

  it('world <-> screen are inverse', () => {
    const w = { x: 37, y: -12 };
    const z = { x: -3, y: 9, zoom: 1.7 };
    const back = toWorld(z, toScreen(z, w));
    expect(back.x).toBeCloseTo(37);
    expect(back.y).toBeCloseTo(-12);
  });

  it('zoomAt keeps the point under the cursor fixed and clamps', () => {
    const at = { x: 300, y: 200 };
    const before = toWorld(v, at);
    const z = zoomAt(v, at.x, at.y, 2);
    expect(z.zoom).toBe(2);
    const after = toWorld(z, at);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
    expect(zoomAt(v, 0, 0, 1000).zoom).toBe(MAX_ZOOM);
    expect(zoomAt(v, 0, 0, 0.0001).zoom).toBe(MIN_ZOOM);
    expect(clampZoom(1)).toBe(1);
  });

  it('wheel pans, ctrl/cmd+wheel zooms', () => {
    expect(wheel(v, { deltaX: 10, deltaY: 20 }, { x: 0, y: 0 })).toEqual({ x: 90, y: 30, zoom: 1 });
    expect(wheel(v, { deltaX: 0, deltaY: -100, ctrlKey: true }, { x: 0, y: 0 }).zoom).toBeGreaterThan(1);
    expect(wheel(v, { deltaX: 0, deltaY: 100, metaKey: true }, { x: 0, y: 0 }).zoom).toBeLessThan(1);
    expect(wheel(v, { deltaX: 0, deltaY: 3, deltaMode: 1 }, { x: 0, y: 0 }).y).toBe(50 - 48);
  });

  it('fit centers the bounds and caps zoom at 1', () => {
    const b = boundsOf([{ x: 0, y: 0, width: 100, height: 100 }, { x: 300, y: 100, width: 100, height: 100 }])!;
    expect(b).toEqual({ x: 0, y: 0, width: 400, height: 200 });
    const f = fitRect(b, 1000, 600);
    expect(f.zoom).toBe(1);
    expect(toScreen(f, { x: 200, y: 100 })).toEqual({ x: 500, y: 300 });
    const g = fitRect(b, 300, 300, 50);
    expect(g.zoom).toBeCloseTo(0.5);
    expect(fitRect(null, 800, 600)).toEqual({ x: 400, y: 300, zoom: 1 });
  });

  it('edge geometry: sides, curve and midpoint', () => {
    const a = { x: 0, y: 0, width: 100, height: 50 };
    const b = { x: 300, y: 0, width: 100, height: 50 };
    expect(autoSides(a, b)).toEqual(['right', 'left']);
    expect(autoSides(a, { ...b, x: 0, y: 300 })).toEqual(['bottom', 'top']);
    expect(nearestSide(b, { x: 290, y: 30 })).toBe('left');
    const g = edgeGeometry({ id: 'e', fromNode: 'a', toNode: 'b' }, { ...a, id: 'a', type: 'text', text: '' }, { ...b, id: 'b', type: 'text', text: '' });
    expect(g.from).toEqual({ x: 100, y: 25 });
    expect(g.to).toEqual({ x: 300, y: 25 });
    expect(g.mid.x).toBeCloseTo(200);
    expect(g.mid.y).toBeCloseTo(25);
    expect(g.endAngle).toBeCloseTo(0);
    expect(g.d.startsWith('M 100 25 C')).toBe(true);
    expect(cubicAt(g.from, g.c1, g.c2, g.to, 1)).toEqual(g.to);
  });

  it('hit testing prefers nodes over groups; reading order', () => {
    const p = ok(obsidian);
    expect(hitNode(p.nodes, { x: -300, y: -150 })?.id).toBe('b1c2d3e4f5a6b7c8');
    expect(hitNode(p.nodes, { x: 420, y: 240 })?.id).toBe('8a7c1f0e2b3d4c5a');
    expect(hitNode(p.nodes, { x: 9999, y: 0 })).toBeNull();
    expect(readingOrder(p.nodes).map((n) => n.id)).toEqual([
      'b1c2d3e4f5a6b7c8', 'c2d3e4f5a6b7c8d9', 'd3e4f5a6b7c8d9e0', 'e4f5a6b7c8d9e0f1', '8a7c1f0e2b3d4c5a',
    ]);
  });
});

describe('canvas keys', () => {
  const k = new CanvasKeys();
  it('cycles, activates, opens', () => {
    expect(k.feed({ key: 'Tab' }, false)).toEqual({ kind: 'cycle', dir: 1 });
    expect(k.feed({ key: 'Tab', shiftKey: true }, true)).toEqual({ kind: 'cycle', dir: -1 });
    expect(k.feed({ key: 'Enter' }, true)).toEqual({ kind: 'activate' });
    expect(k.feed({ key: 'Enter' }, false)).toBeNull();
    expect(k.feed({ key: 'g' }, true)).toBeNull();
    expect(k.feed({ key: 'f' }, true)).toEqual({ kind: 'openFile', split: false });
    expect(k.feed({ key: 'w', ctrlKey: true }, true)).toBeNull();
    expect(k.feed({ key: 'f' }, true)).toEqual({ kind: 'openFile', split: true });
  });
  it('pans without selection, nudges with it; zoom and fit', () => {
    expect(k.feed({ key: 'l' }, false)).toEqual({ kind: 'pan', dx: -80, dy: 0 });
    expect(k.feed({ key: 'l' }, true)).toEqual({ kind: 'pan', dx: -80, dy: 0 });
    expect(k.feed({ key: 'L' }, true)).toEqual({ kind: 'nudge', dx: 20, dy: 0 });
    expect(k.feed({ key: 'ArrowUp', shiftKey: true }, true)).toEqual({ kind: 'nudge', dx: 0, dy: -20 });
    expect(k.feed({ key: '+' }, false)).toEqual({ kind: 'zoom', factor: 1.2 });
    expect(k.feed({ key: '-' }, false)?.kind).toBe('zoom');
    expect(k.feed({ key: '0' }, false)).toEqual({ kind: 'fit' });
  });
  it('creates, deletes, colors', () => {
    expect(k.feed({ key: 'a' }, false)).toEqual({ kind: 'addText' });
    expect(k.feed({ key: 'f' }, false)).toEqual({ kind: 'addFile' });
    expect(k.feed({ key: 'Backspace' }, true)).toEqual({ kind: 'delete' });
    expect(k.feed({ key: 'd' }, false)).toBeNull();
    expect(k.feed({ key: 'c' }, true)).toBeNull();
    expect(k.feed({ key: '4' }, true)).toEqual({ kind: 'color', color: '4' });
    k.feed({ key: 'c' }, true);
    expect(k.feed({ key: '0' }, true)).toEqual({ kind: 'color', color: null });
    expect(k.feed({ key: 'k', metaKey: true }, true)).toBeNull();
  });
});
