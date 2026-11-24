// Read-only previews of structured notes for the floating explorer's
// preview column and the hover card: a fit-to-bounds mini canvas and a
// mini kanban board, instead of the raw JSON / markdown. Pure models;
// the components (CanvasMini / KanbanMini) only draw them.
//
// Cheap on purpose: file nodes are titled cards (their notes are never
// fetched), text is rendered only for small canvases, and big canvases
// (> MINI_DETAIL_LIMIT nodes) become plain boxes.

import { parseCanvas, canvasColor, type CanvasNode, type FileNode, type GroupNode, type LinkNode, type TextNode } from '../canvas/canvas.ts';
import { boundsOf, edgeGeometry } from '../canvas/canvas-view.ts';
import { parseKanban } from '../kanban/kanban.ts';
import { noteViewKind, type NoteViewKind } from '../note-kind.ts';

export const MINI_DETAIL_LIMIT = 500;
/** Text nodes rendered as prose (markdown) at most. */
export const MINI_TEXT_LIMIT = 80;

/** Which preview a note gets (explorer preview column, hover card). */
export function previewKindFor(
  note: { path?: string | null; kind?: string | null } | null | undefined,
  content?: { path?: string | null; kind?: string | null; frontmatter?: Record<string, unknown> | null } | null,
): NoteViewKind {
  return noteViewKind({
    path: content?.path ?? note?.path ?? null,
    kind: content?.kind ?? note?.kind ?? null,
    frontmatter: content?.frontmatter ?? null,
  });
}

export interface MiniCard {
  id: string;
  type: CanvasNode['type'];
  x: number;
  y: number;
  width: number;
  height: number;
  color: string | null;
  /** Group label, file name, link host. */
  label: string;
  /** Text node markdown (only when rendered as prose). */
  text: string | null;
}
export interface MiniEdge {
  id: string;
  d: string;
  color: string | null;
}
export interface MiniCanvas {
  viewBox: string;
  groups: MiniCard[];
  cards: MiniCard[];
  edges: MiniEdge[];
  /** Too many nodes: boxes only (no text, no edges). */
  simplified: boolean;
  nodeCount: number;
  edgeCount: number;
  error: string | null;
}

function cssColor(c: unknown): string | null {
  const v = canvasColor(c);
  if (!v) return null;
  return 'preset' in v ? `var(--canvas-${v.preset})` : v.hex;
}
function baseName(p: string): string {
  return (p.split('/').pop() ?? p).replace(/\.md$/i, '');
}
function host(u: string): string {
  try {
    return new URL(u).host || u;
  } catch {
    return u;
  }
}

export function miniCanvas(text: string): MiniCanvas {
  const p = parseCanvas(text);
  if (!p.ok) return { viewBox: '0 0 1 1', groups: [], cards: [], edges: [], simplified: false, nodeCount: 0, edgeCount: 0, error: p.error };
  const simplified = p.nodes.length > MINI_DETAIL_LIMIT;
  const b = boundsOf(p.nodes);
  const pad = b ? Math.max(20, Math.max(b.width, b.height) * 0.03) : 0;
  const viewBox = b ? `${b.x - pad} ${b.y - pad} ${b.width + 2 * pad} ${b.height + 2 * pad}` : '0 0 1 1';
  let texts = 0;
  const groups: MiniCard[] = [];
  const cards: MiniCard[] = [];
  for (const n of p.nodes) {
    const base = { id: n.id, type: n.type, x: n.x, y: n.y, width: n.width, height: n.height, color: cssColor(n.color) };
    if (n.type === 'group') {
      groups.push({ ...base, label: (n as GroupNode).label ?? '', text: null });
      continue;
    }
    let label = '';
    let t: string | null = null;
    if (n.type === 'file') label = baseName((n as FileNode).file ?? '');
    else if (n.type === 'link') label = host((n as LinkNode).url ?? '');
    else if (n.type === 'text') {
      const s = (n as TextNode).text ?? '';
      if (!simplified && texts < MINI_TEXT_LIMIT) {
        t = s.length > 600 ? s.slice(0, 600) : s;
        texts++;
      } else label = s.split('\n').find((l) => l.trim())?.replace(/^#+\s*/, '').slice(0, 60) ?? '';
    }
    cards.push({ ...base, label, text: t });
  }
  const byId = new Map(p.nodes.map((n) => [n.id, n]));
  const edges: MiniEdge[] = [];
  if (!simplified) {
    for (const e of p.edges) {
      const a = byId.get(e.fromNode);
      const z = byId.get(e.toNode);
      if (a && z) edges.push({ id: e.id, d: edgeGeometry(e, a, z).d, color: cssColor(e.color) });
    }
  }
  return { viewBox, groups, cards, edges, simplified, nodeCount: p.nodes.length, edgeCount: p.edges.length, error: null };
}

export interface MiniLane {
  title: string;
  total: number;
  cards: Array<{ text: string; checked: boolean }>;
}

/** Columns with their first `perLane` cards (plain first line). */
export function miniBoard(text: string, perLane = 4, maxLanes = 8): MiniLane[] {
  const b = parseKanban(text);
  return b.lanes.slice(0, maxLanes).map((l) => ({
    title: l.title,
    total: l.cards.length,
    cards: l.cards.slice(0, perLane).map((c) => ({
      text: (c.text.split('\n')[0] ?? '').replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, a, b2) => b2 ?? a).replace(/[*_`]/g, '').slice(0, 120),
      checked: c.checked,
    })),
  }));
}
