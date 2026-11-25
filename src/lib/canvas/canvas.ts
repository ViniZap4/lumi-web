// JSON Canvas 1.0 (jsoncanvas.org): types, tolerant parser, validator,
// style-preserving serializer and pure edit ops (SPEC-PARTE2 §6).
//
// Persistence model: the canvas file is a Y.Text holding the JSON.
// A change = parse the CURRENT text → apply an op → serialize in the
// file's own style (Obsidian's one-object-per-line with tabs, or
// pretty JSON with its indent) → minimal prefix/suffix diff → one
// ranged edit (commitCanvas). Unknown keys on nodes, edges and the top
// level are kept, in their original order.

import { diffEdits, type TextEdit } from '../text-diff.ts';
import { healMissingCommas, locateJsonError, type JsonErrorAt } from './canvas-recover.ts';

export type CanvasSide = 'top' | 'right' | 'bottom' | 'left';
export type CanvasEnd = 'none' | 'arrow';
/** Preset `"1"`..`"6"` (red, orange, yellow, green, cyan, purple) or `#rrggbb`. */
export type CanvasColor = string;

interface NodeBase {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color?: CanvasColor;
  [k: string]: unknown;
}
export interface TextNode extends NodeBase {
  type: 'text';
  text: string;
}
export interface FileNode extends NodeBase {
  type: 'file';
  file: string;
  subpath?: string;
}
export interface LinkNode extends NodeBase {
  type: 'link';
  url: string;
}
export interface GroupNode extends NodeBase {
  type: 'group';
  label?: string;
  background?: string;
  backgroundStyle?: 'cover' | 'ratio' | 'repeat';
}
export type CanvasNode = TextNode | FileNode | LinkNode | GroupNode;
export type CanvasNodeType = CanvasNode['type'];

export interface CanvasEdge {
  id: string;
  fromNode: string;
  fromSide?: CanvasSide;
  fromEnd?: CanvasEnd;
  toNode: string;
  toSide?: CanvasSide;
  toEnd?: CanvasEnd;
  color?: CanvasColor;
  label?: string;
  [k: string]: unknown;
}

type Json = Record<string, unknown>;

/** A vault note offered by the file-node picker. */
export interface CanvasNoteRef {
  path: string;
  title?: string;
}

/** The file as parsed: raw objects kept as-is (unknown keys included). */
export interface CanvasData {
  /** Top-level object (its `nodes`/`edges` are replaced on serialize). */
  top: Json;
  /** Raw node entries in file order (= z order, first is bottom). */
  nodes: unknown[];
  edges: unknown[];
}

export interface CanvasStyle {
  /** `compact`: Obsidian (one object per line); `pretty`: JSON.stringify(indent). */
  layout: 'compact' | 'pretty';
  indent: string;
  trailingNewline: boolean;
}

export type CanvasParse =
  | { ok: true; data: CanvasData; nodes: CanvasNode[]; edges: CanvasEdge[]; issues: string[]; style: CanvasStyle }
  /** `error` is pt-BR; `at` is where the JSON breaks (absent when it is
   *  valid JSON but not an object). */
  | { ok: false; error: string; at?: JsonErrorAt };

const SIDES: readonly string[] = ['top', 'right', 'bottom', 'left'];
const TYPES: readonly string[] = ['text', 'file', 'link', 'group'];
export const DEFAULT_STYLE: CanvasStyle = { layout: 'compact', indent: '\t', trailingNewline: false };
/** The empty canvas every client and the server create: multi-line, so
 *  concurrent first cards land as whole lines (no trailing newline).
 *  Equal to serializeCanvas of an empty canvas in DEFAULT_STYLE. */
export const EMPTY_CANVAS = '{\n\t"nodes":[],\n\t"edges":[]\n}';

function isObj(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function num(v: unknown, d: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : d;
}

/** Color usable in CSS (preset or hex), else null. Never passes arbitrary CSS through. */
export function canvasColor(c: unknown): { preset: number } | { hex: string } | null {
  if (typeof c !== 'string') return null;
  if (/^[1-6]$/.test(c)) return { preset: Number(c) };
  if (/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(c)) return { hex: c };
  return null;
}

/** A renderable node from a raw entry (defaults filled), or an issue. */
export function validateNode(raw: unknown): { node: CanvasNode | null; issue?: string } {
  if (!isObj(raw)) return { node: null, issue: 'node is not an object' };
  const id = raw.id;
  if (typeof id !== 'string' || !id) return { node: null, issue: 'node without id' };
  const type = raw.type;
  if (typeof type !== 'string' || !TYPES.includes(type)) return { node: null, issue: `node ${id}: unknown type ${String(type)}` };
  const node = {
    ...raw,
    id,
    type,
    x: num(raw.x, 0),
    y: num(raw.y, 0),
    width: Math.max(1, num(raw.width, 250)),
    height: Math.max(1, num(raw.height, 60)),
  } as CanvasNode;
  let issue: string | undefined;
  if (['x', 'y', 'width', 'height'].some((k) => typeof raw[k] !== 'number')) issue = `node ${id}: missing/invalid geometry`;
  if (type === 'text' && typeof raw.text !== 'string') (node as TextNode).text = '';
  if (type === 'file' && typeof raw.file !== 'string') {
    (node as FileNode).file = '';
    issue = `node ${id}: file node without file`;
  }
  if (type === 'link' && typeof raw.url !== 'string') {
    (node as LinkNode).url = '';
    issue = `node ${id}: link node without url`;
  }
  return { node, issue };
}

export function validateEdge(raw: unknown, ids: Set<string>): { edge: CanvasEdge | null; issue?: string } {
  if (!isObj(raw)) return { edge: null, issue: 'edge is not an object' };
  const { id, fromNode, toNode } = raw;
  if (typeof id !== 'string' || !id) return { edge: null, issue: 'edge without id' };
  if (typeof fromNode !== 'string' || typeof toNode !== 'string') return { edge: null, issue: `edge ${id}: missing endpoints` };
  if (!ids.has(fromNode) || !ids.has(toNode)) return { edge: null, issue: `edge ${id}: dangling endpoint` };
  const edge = { ...raw } as CanvasEdge;
  if (raw.fromSide !== undefined && !SIDES.includes(raw.fromSide as string)) delete edge.fromSide;
  if (raw.toSide !== undefined && !SIDES.includes(raw.toSide as string)) delete edge.toSide;
  return { edge };
}

// ---- serializer ----------------------------------------------------------------

function compactJSON(top: Json, s: CanvasStyle): string {
  const keys = Object.keys(top);
  if (!keys.length) return '{}';
  const lines = keys.map((k) => {
    const v = top[k];
    const head = `${s.indent}${JSON.stringify(k)}:`;
    if (Array.isArray(v)) {
      if (!v.length) return head + '[]';
      return head + '[\n' + v.map((x) => s.indent + s.indent + JSON.stringify(x)).join(',\n') + '\n' + s.indent + ']';
    }
    return head + JSON.stringify(v);
  });
  return '{\n' + lines.join(',\n') + '\n}';
}

function topWith(data: CanvasData): Json {
  const top: Json = {};
  for (const k of Object.keys(data.top)) top[k] = k === 'nodes' ? data.nodes : k === 'edges' ? data.edges : data.top[k];
  if (!('nodes' in top)) top.nodes = data.nodes;
  if (!('edges' in top)) top.edges = data.edges;
  return top;
}

export function serializeCanvas(data: CanvasData, style: CanvasStyle = DEFAULT_STYLE): string {
  const top = topWith(data);
  const body = style.layout === 'pretty' ? JSON.stringify(top, null, style.indent) : compactJSON(top, style);
  return body + (style.trailingNewline ? '\n' : '');
}

/** The style that reproduces `text` exactly, or the closest guess. */
export function detectCanvasStyle(text: string, top?: Json): CanvasStyle {
  const trailingNewline = /\n$/.test(text);
  const im = /\n([ \t]+)\S/.exec(text);
  const indent = im ? (im[1].startsWith('\t') ? '\t' : im[1].replace(/\t/g, '')) : '\t';
  if (top) {
    for (const layout of ['compact', 'pretty'] as const) {
      const s: CanvasStyle = { layout, indent, trailingNewline };
      const data = { top, nodes: (top.nodes as unknown[]) ?? [], edges: (top.edges as unknown[]) ?? [] };
      if (Array.isArray(top.nodes) && Array.isArray(top.edges) && serializeCanvas(data, s) === text) return s;
      const plain = layout === 'pretty' ? JSON.stringify(top, null, indent) : compactJSON(top, s);
      if (plain + (trailingNewline ? '\n' : '') === text) return s;
    }
  }
  // Guess: an object opening and holding a key on the same line → compact.
  const t = text.trim();
  const layout = !t || !t.includes('\n') || /\[\s*\n[ \t]*\{"/.test(text) ? 'compact' : 'pretty';
  return { layout, indent, trailingNewline };
}

// ---- parser --------------------------------------------------------------------

export function parseCanvas(text: string): CanvasParse {
  let top: Json;
  if (!text.trim()) top = {};
  else {
    let v: unknown;
    let parseError = '';
    try {
      v = JSON.parse(text);
    } catch (e) {
      parseError = (e as Error).message;
      // Concurrent first cards: objects in an array with no comma
      // between them. Read them as if the comma were there (no banner);
      // the next local commit writes valid JSON (diffEdits).
      const healed = healMissingCommas(text);
      if (healed != null) {
        try {
          v = JSON.parse(healed);
        } catch {
          v = undefined;
        }
      }
    }
    if (v === undefined) {
      const at = locateJsonError(text);
      if (!at) return { ok: false, error: `JSON inválido: ${parseError}` };
      return { ok: false, error: `${at.message} (linha ${at.line}, coluna ${at.column})`, at };
    }
    if (!isObj(v)) return { ok: false, error: 'um canvas precisa ser um objeto JSON ({ … })' };
    top = v;
  }
  const issues: string[] = [];
  const rawNodes = Array.isArray(top.nodes) ? top.nodes : [];
  const rawEdges = Array.isArray(top.edges) ? top.edges : [];
  if (top.nodes !== undefined && !Array.isArray(top.nodes)) issues.push('"nodes" is not an array');
  if (top.edges !== undefined && !Array.isArray(top.edges)) issues.push('"edges" is not an array');
  const nodes: CanvasNode[] = [];
  const ids = new Set<string>();
  for (const r of rawNodes) {
    const { node, issue } = validateNode(r);
    if (issue) issues.push(issue);
    if (node && !ids.has(node.id)) {
      ids.add(node.id);
      nodes.push(node);
    } else if (node) issues.push(`duplicate node id ${node.id}`);
  }
  const edges: CanvasEdge[] = [];
  for (const r of rawEdges) {
    const { edge, issue } = validateEdge(r, ids);
    if (issue) issues.push(issue);
    if (edge) edges.push(edge);
  }
  return {
    ok: true,
    data: { top, nodes: rawNodes.slice(), edges: rawEdges.slice() },
    nodes,
    edges,
    issues,
    style: detectCanvasStyle(text, top),
  };
}

// ---- ops -------------------------------------------------------------------------

export type CanvasOp = (d: CanvasData) => CanvasData;

/** 16 hex chars, as Obsidian generates. */
export function newCanvasId(rand: () => number = Math.random): string {
  let s = '';
  for (let i = 0; i < 16; i++) s += Math.floor(rand() * 16).toString(16);
  return s;
}

function idOf(x: unknown): string | null {
  return isObj(x) && typeof x.id === 'string' ? x.id : null;
}

/** Patch nodes by id (keys keep their position; new keys append; `undefined` deletes). */
export function patchNodes(patches: Record<string, Record<string, unknown>>): CanvasOp {
  return (d) => ({
    ...d,
    nodes: d.nodes.map((n) => {
      const id = idOf(n);
      const p = id ? patches[id] : undefined;
      if (!p || !isObj(n)) return n;
      const out: Json = { ...n };
      for (const [k, v] of Object.entries(p)) {
        if (v === undefined) delete out[k];
        else out[k] = typeof v === 'number' && ['x', 'y', 'width', 'height'].includes(k) ? Math.round(v) : v;
      }
      return out;
    }),
  });
}

export function patchEdge(id: string, patch: Record<string, unknown>): CanvasOp {
  return (d) => ({
    ...d,
    edges: d.edges.map((e) => {
      if (idOf(e) !== id || !isObj(e)) return e;
      const out: Json = { ...e };
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) delete out[k];
        else out[k] = v;
      }
      return out;
    }),
  });
}

/** Append a node (top of z order); groups go to the bottom so they stay behind. */
export function addNode(node: CanvasNode): CanvasOp {
  const n = { ...node, x: Math.round(node.x), y: Math.round(node.y), width: Math.round(node.width), height: Math.round(node.height) };
  return (d) => ({ ...d, nodes: node.type === 'group' ? [n, ...d.nodes] : [...d.nodes, n] });
}

export function addEdge(edge: CanvasEdge): CanvasOp {
  return (d) => ({ ...d, edges: [...d.edges, edge] });
}

/** Remove nodes and every edge touching them, plus the given edges. */
export function removeItems(nodeIDs: readonly string[], edgeIDs: readonly string[] = []): CanvasOp {
  const ns = new Set(nodeIDs);
  const es = new Set(edgeIDs);
  return (d) => ({
    ...d,
    nodes: d.nodes.filter((n) => !ns.has(idOf(n) ?? '')),
    edges: d.edges.filter((e) => {
      if (es.has(idOf(e) ?? '')) return false;
      if (!isObj(e)) return true;
      return !ns.has(e.fromNode as string) && !ns.has(e.toNode as string);
    }),
  });
}

/**
 * Apply `op` to the CURRENT text and return the minimal edits (or []
 * when nothing changes / the text does not parse). The file keeps its
 * style. One edit per changed run of lines (text-diff `diffEdits`): a
 * multi-node move never rewrites the nodes between the moved ones, so a
 * concurrent edit of those survives the merge intact (with a single
 * prefix/suffix edit it was left as an orphan fragment next to the
 * re-inserted copy: invalid JSON, canvas-merge.test.ts).
 */
export function commitCanvas(current: string, op: CanvasOp): TextEdit[] {
  const p = parseCanvas(current);
  if (!p.ok) return [];
  const next = serializeCanvas(op(p.data), current.trim() ? p.style : DEFAULT_STYLE);
  return diffEdits(current, next);
}
