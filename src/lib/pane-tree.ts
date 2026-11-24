// Pane tree: the note area as a tree of splits (SPEC-PARTE2 §3).
//
// A leaf holds one note (shown by the note view its kind picks, see
// lib/note-views.ts); a split lays its children side by side (`row`,
// vim `:vsplit`) or stacked (`col`, `:split`) with fractional sizes
// that always sum to 1. Every operation is pure: it returns a new
// state and never mutates its input, so the view can keep the state in
// a `$state.raw` and persist it as JSON (per book, per device).
//
// New panes open to the right / below and take focus (vim with
// `splitright splitbelow`, the Obsidian / VS Code habit). Closing a
// pane gives its space to the neighbour that grew from it.

export type SplitDir = 'row' | 'col';

export interface PaneLeaf {
  kind: 'leaf';
  id: string;
  /** Note id shown in this pane. */
  note: string;
  /** Note view override (`markdown`, `kanban`, …); null = the default
   *  for the note's kind (lib/note-views.ts). */
  view?: string | null;
}

export interface PaneSplit {
  kind: 'split';
  id: string;
  dir: SplitDir;
  children: PaneNode[];
  /** Fractions of the split's extent, one per child, summing to 1. */
  sizes: number[];
}

export type PaneNode = PaneLeaf | PaneSplit;

export interface PaneState {
  root: PaneNode;
  /** Focused leaf id. */
  active: string;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Hard cap on open panes (each one may hold a live editor session). */
export const MAX_PANES = 8;
/** Smallest share a pane can be resized to. */
export const MIN_SIZE = 0.12;
const MAX_DEPTH = 8;

let seq = 0;
/** Fresh pane id (unique within a page session). */
export function newPaneId(prefix = 'p'): string {
  seq += 1;
  return `${prefix}${Date.now().toString(36)}${seq.toString(36)}`;
}

export function single(note: string, id: string = newPaneId()): PaneState {
  return { root: { kind: 'leaf', id, note }, active: id };
}

// ---- queries ---------------------------------------------------------------

export function leaves(n: PaneNode): PaneLeaf[] {
  if (n.kind === 'leaf') return [n];
  return n.children.flatMap(leaves);
}

export function findLeaf(n: PaneNode, id: string): PaneLeaf | null {
  return leaves(n).find((l) => l.id === id) ?? null;
}

export function activeLeaf(s: PaneState): PaneLeaf {
  return findLeaf(s.root, s.active) ?? leaves(s.root)[0];
}

export function paneCount(s: PaneState | null): number {
  return s ? leaves(s.root).length : 0;
}

/** Path of split nodes from the root down to (excluding) node `id`. */
function pathTo(n: PaneNode, id: string, acc: PaneSplit[] = []): PaneSplit[] | null {
  if (n.id === id) return acc;
  if (n.kind === 'leaf') return null;
  for (const c of n.children) {
    const p = pathTo(c, id, [...acc, n]);
    if (p) return p;
  }
  return null;
}

/** Normalised rectangles (0..1) of every leaf. */
export function rects(root: PaneNode): Map<string, Rect> {
  const out = new Map<string, Rect>();
  const walk = (n: PaneNode, r: Rect) => {
    if (n.kind === 'leaf') {
      out.set(n.id, r);
      return;
    }
    let off = 0;
    n.children.forEach((c, i) => {
      const s = n.sizes[i] ?? 1 / n.children.length;
      const cr = n.dir === 'row' ? { x: r.x + off * r.w, y: r.y, w: s * r.w, h: r.h } : { x: r.x, y: r.y + off * r.h, w: r.w, h: s * r.h };
      off += s;
      walk(c, cr);
    });
  };
  walk(root, { x: 0, y: 0, w: 1, h: 1 });
  return out;
}

/**
 * The pane `dir` of `from` (vim window motion): the nearest leaf whose
 * edge touches ours on that side and that overlaps us on the other
 * axis; ties go to the most overlap. `w`/`p` are handled by the view.
 */
export function neighbor(s: PaneState, from: string, dir: 'h' | 'j' | 'k' | 'l'): string | null {
  const rs = rects(s.root);
  const a = rs.get(from);
  if (!a) return null;
  const eps = 1e-6;
  let best: { id: string; dist: number; overlap: number } | null = null;
  for (const [id, b] of rs) {
    if (id === from) continue;
    let dist: number;
    let overlap: number;
    if (dir === 'h' || dir === 'l') {
      dist = dir === 'h' ? a.x - (b.x + b.w) : b.x - (a.x + a.w);
      overlap = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    } else {
      dist = dir === 'k' ? a.y - (b.y + b.h) : b.y - (a.y + a.h);
      overlap = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    }
    if (dist < -eps || overlap <= eps) continue;
    if (!best || dist < best.dist - eps || (Math.abs(dist - best.dist) <= eps && overlap > best.overlap)) best = { id, dist, overlap };
  }
  return best?.id ?? null;
}

/** Leaf `step` places after `from` in reading order (wrapping). */
export function cycle(s: PaneState, from: string, step = 1): string {
  const ls = leaves(s.root);
  const i = Math.max(0, ls.findIndex((l) => l.id === from));
  return ls[(i + step + ls.length * 8) % ls.length].id;
}

// ---- edits ------------------------------------------------------------------

function mapNode(n: PaneNode, id: string, f: (n: PaneNode) => PaneNode): PaneNode {
  if (n.id === id) return f(n);
  if (n.kind === 'leaf') return n;
  let changed = false;
  const children = n.children.map((c) => {
    const m = mapNode(c, id, f);
    if (m !== c) changed = true;
    return m;
  });
  return changed ? { ...n, children } : n;
}

function normalize(sizes: number[]): number[] {
  const sum = sizes.reduce((a, b) => a + b, 0);
  if (!(sum > 0)) return sizes.map(() => 1 / sizes.length);
  return sizes.map((s) => s / sum);
}

/**
 * Split leaf `at` in `dir` with a new pane showing `note` (right of /
 * below it). Inside a split of the same direction the new pane becomes
 * a sibling and the two share the old pane's space. Returns null when
 * the pane cap is reached or `at` is unknown.
 */
export function splitPane(s: PaneState, at: string, dir: SplitDir, note: string, id: string = newPaneId()): PaneState | null {
  if (!findLeaf(s.root, at) || paneCount(s) >= MAX_PANES) return null;
  const path = pathTo(s.root, at) ?? [];
  if (path.length >= MAX_DEPTH) return null;
  const parent = path[path.length - 1];
  const fresh: PaneLeaf = { kind: 'leaf', id, note };
  if (parent && parent.dir === dir) {
    const i = parent.children.findIndex((c) => c.id === at);
    const half = parent.sizes[i] / 2;
    const children = [...parent.children.slice(0, i + 1), fresh, ...parent.children.slice(i + 1)];
    const sizes = [...parent.sizes.slice(0, i), half, half, ...parent.sizes.slice(i + 1)];
    return { root: mapNode(s.root, parent.id, () => ({ ...parent, children, sizes })), active: id };
  }
  const root = mapNode(s.root, at, (leaf) => ({ kind: 'split', id: newPaneId('s'), dir, children: [leaf, fresh], sizes: [0.5, 0.5] }));
  return { root, active: id };
}

/**
 * Close leaf `id`. Its space goes to the previous sibling (or the next
 * one when it was first), which also takes focus when the closed pane
 * was focused. A split left with one child collapses into it. null when
 * `id` was the last pane.
 */
export function closePane(s: PaneState, id: string): PaneState | null {
  if (!findLeaf(s.root, id)) return s;
  if (s.root.kind === 'leaf') return null;
  const path = pathTo(s.root, id)!;
  const parent = path[path.length - 1];
  const i = parent.children.findIndex((c) => c.id === id);
  const j = i > 0 ? i - 1 : 1;
  const sizes = [...parent.sizes];
  sizes[j] += sizes[i];
  sizes.splice(i, 1);
  const children = parent.children.filter((_, k) => k !== i);
  const heir = parent.children[j];
  const replacement: PaneNode = children.length === 1 ? children[0] : { ...parent, children, sizes: normalize(sizes) };
  const root = mapNode(s.root, parent.id, () => replacement);
  let active = s.active;
  if (active === id) {
    const ls = leaves(heir);
    active = (i > 0 ? ls[ls.length - 1] : ls[0]).id;
  }
  return { root: flatten(root), active };
}

/** Merge a split's same-direction child splits into it (keeps sizes). */
function flatten(n: PaneNode): PaneNode {
  if (n.kind === 'leaf') return n;
  const children: PaneNode[] = [];
  const sizes: number[] = [];
  n.children.forEach((c0, i) => {
    const c = flatten(c0);
    if (c.kind === 'split' && c.dir === n.dir) {
      c.children.forEach((cc, k) => {
        children.push(cc);
        sizes.push(n.sizes[i] * c.sizes[k]);
      });
    } else {
      children.push(c);
      sizes.push(n.sizes[i]);
    }
  });
  if (children.length === 1) return children[0];
  return { ...n, children, sizes: normalize(sizes) };
}

/** `Ctrl-w o`: keep only leaf `id`. */
export function onlyPane(s: PaneState, id: string): PaneState {
  const l = findLeaf(s.root, id);
  return l ? { root: l, active: id } : s;
}

/** `Ctrl-w =`: every split shares its space equally. */
export function equalize(s: PaneState): PaneState {
  const eq = (n: PaneNode): PaneNode => (n.kind === 'leaf' ? n : { ...n, children: n.children.map(eq), sizes: n.children.map(() => 1 / n.children.length) });
  return { ...s, root: eq(s.root) };
}

export function setNote(s: PaneState, id: string, note: string): PaneState {
  return { ...s, root: mapNode(s.root, id, (n) => (n.kind === 'leaf' ? { ...n, note, view: null } : n)) };
}

export function setView(s: PaneState, id: string, view: string | null): PaneState {
  return { ...s, root: mapNode(s.root, id, (n) => (n.kind === 'leaf' ? { ...n, view } : n)) };
}

export function focus(s: PaneState, id: string): PaneState {
  return findLeaf(s.root, id) && s.active !== id ? { ...s, active: id } : s;
}

/**
 * Move the divider after child `index` of split `splitId` to `at`
 * (0..1 along the split, measured from its start). Both neighbours
 * keep at least MIN_SIZE.
 */
export function resizeSplit(s: PaneState, splitId: string, index: number, at: number): PaneState {
  return {
    ...s,
    root: mapNode(s.root, splitId, (n) => {
      if (n.kind !== 'split' || index < 0 || index >= n.children.length - 1) return n;
      const before = n.sizes.slice(0, index).reduce((a, b) => a + b, 0);
      const pair = n.sizes[index] + n.sizes[index + 1];
      const min = Math.min(MIN_SIZE, pair / 2);
      const left = Math.min(pair - min, Math.max(min, at - before));
      const sizes = [...n.sizes];
      sizes[index] = left;
      sizes[index + 1] = pair - left;
      return { ...n, sizes };
    }),
  };
}

/**
 * Grow (delta > 0) or shrink leaf `id` along `axis` (vim `Ctrl-w > <`
 * for rows, `+ -` for columns) by moving the nearest divider of the
 * closest enclosing split in that direction.
 */
export function nudgePane(s: PaneState, id: string, axis: SplitDir, delta: number): PaneState {
  const path = pathTo(s.root, id);
  if (!path) return s;
  let child: string = id;
  for (let k = path.length - 1; k >= 0; k--) {
    const sp = path[k];
    if (sp.dir === axis) {
      const i = sp.children.findIndex((c) => c.id === child);
      const before = sp.sizes.slice(0, i).reduce((a, b) => a + b, 0);
      // Grow by pushing the divider after us; the last child pulls the
      // one before it instead.
      if (i < sp.children.length - 1) return resizeSplit(s, sp.id, i, before + sp.sizes[i] + delta);
      return resizeSplit(s, sp.id, i - 1, before - delta);
    }
    child = sp.id;
  }
  return s;
}

/** Close every leaf whose note no longer exists. null when none is left. */
export function pruneNotes(s: PaneState, exists: (note: string) => boolean): PaneState | null {
  let cur: PaneState | null = s;
  for (const l of leaves(s.root)) {
    if (!cur) break;
    if (!exists(l.note)) cur = closePane(cur, l.id);
  }
  return cur;
}

// ---- persistence ---------------------------------------------------------------

const ID_RE = /^[A-Za-z0-9_.:-]{1,64}$/;
const NOTE_RE = /^[^\u0000-\u001f\u007f]{1,256}$/;

function parseNode(v: unknown, depth: number, ids: Set<string>): PaneNode | null {
  if (!v || typeof v !== 'object' || depth > MAX_DEPTH) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.id !== 'string' || !ID_RE.test(o.id) || ids.has(o.id)) return null;
  ids.add(o.id);
  if (o.kind === 'leaf') {
    if (typeof o.note !== 'string' || !NOTE_RE.test(o.note)) return null;
    const view = typeof o.view === 'string' && ID_RE.test(o.view) ? o.view : null;
    return view ? { kind: 'leaf', id: o.id, note: o.note, view } : { kind: 'leaf', id: o.id, note: o.note };
  }
  if (o.kind !== 'split' || (o.dir !== 'row' && o.dir !== 'col') || !Array.isArray(o.children) || o.children.length < 2) return null;
  const children: PaneNode[] = [];
  for (const c of o.children) {
    const n = parseNode(c, depth + 1, ids);
    if (!n) return null;
    children.push(n);
  }
  const raw = Array.isArray(o.sizes) && o.sizes.length === children.length && o.sizes.every((x) => typeof x === 'number' && x > 0 && x < 1.0001)
    ? (o.sizes as number[])
    : children.map(() => 1);
  return { kind: 'split', id: o.id, dir: o.dir, children, sizes: normalize(raw) };
}

/** Validate a persisted state (untrusted JSON from storage). */
export function parsePaneState(v: unknown): PaneState | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const root = parseNode(o.root, 0, new Set());
  if (!root) return null;
  const all = leaves(root);
  if (all.length > MAX_PANES) return null;
  const active = typeof o.active === 'string' && all.some((l) => l.id === o.active) ? o.active : all[0].id;
  return { root: flatten(root), active };
}
