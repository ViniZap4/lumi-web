// Canvas viewport + geometry math (pure; ported 1:1 by native clients).
//
// Viewport maps world → screen as `screen = world * zoom + (x, y)`.

import type { CanvasEdge, CanvasNode, CanvasSide } from './canvas.ts';

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}
export interface Point {
  x: number;
  y: number;
}
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 4;
export const ZOOM_STEP = 1.2;

export function clampZoom(z: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

export function toScreen(v: Viewport, p: Point): Point {
  return { x: p.x * v.zoom + v.x, y: p.y * v.zoom + v.y };
}
export function toWorld(v: Viewport, p: Point): Point {
  return { x: (p.x - v.x) / v.zoom, y: (p.y - v.y) / v.zoom };
}

/** Zoom by `factor` keeping the screen point (sx, sy) fixed. */
export function zoomAt(v: Viewport, sx: number, sy: number, factor: number): Viewport {
  const zoom = clampZoom(v.zoom * factor);
  const k = zoom / v.zoom;
  return { zoom, x: sx - (sx - v.x) * k, y: sy - (sy - v.y) * k };
}

export function panBy(v: Viewport, dx: number, dy: number): Viewport {
  return { ...v, x: v.x + dx, y: v.y + dy };
}

/** Wheel → viewport. Ctrl/Cmd+wheel (and trackpad pinch, which arrives as ctrl+wheel) zooms; otherwise pans. */
export function wheel(v: Viewport, e: { deltaX: number; deltaY: number; deltaMode?: number; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean }, at: Point): Viewport {
  const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
  const dx = e.deltaX * unit;
  const dy = e.deltaY * unit;
  if (e.ctrlKey || e.metaKey) return zoomAt(v, at.x, at.y, Math.exp(-dy * 0.01));
  if (e.shiftKey && !dx) return panBy(v, -dy, 0);
  return panBy(v, -dx, -dy);
}

export function boundsOf(rects: readonly Rect[]): Rect | null {
  if (!rects.length) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const r of rects) {
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.width);
    y1 = Math.max(y1, r.y + r.height);
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** Viewport that fits `r` into a w×h screen with padding (never zooms past maxZoom). */
export function fitRect(r: Rect | null, w: number, h: number, pad = 48, maxZoom = 1): Viewport {
  if (!r || w <= 0 || h <= 0) return { x: w / 2, y: h / 2, zoom: 1 };
  const zoom = clampZoom(Math.min(maxZoom, (w - 2 * pad) / Math.max(1, r.width), (h - 2 * pad) / Math.max(1, r.height)));
  return { zoom, x: w / 2 - (r.x + r.width / 2) * zoom, y: h / 2 - (r.y + r.height / 2) * zoom };
}

export function sidePoint(n: Rect, side: CanvasSide): Point {
  switch (side) {
    case 'top':
      return { x: n.x + n.width / 2, y: n.y };
    case 'bottom':
      return { x: n.x + n.width / 2, y: n.y + n.height };
    case 'left':
      return { x: n.x, y: n.y + n.height / 2 };
    case 'right':
      return { x: n.x + n.width, y: n.y + n.height / 2 };
  }
}

const NORMAL: Record<CanvasSide, Point> = {
  top: { x: 0, y: -1 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

/** Side of `n` closest to point `p` (by distance to the side midpoints). */
export function nearestSide(n: Rect, p: Point): CanvasSide {
  let best: CanvasSide = 'top';
  let bd = Infinity;
  for (const s of ['top', 'right', 'bottom', 'left'] as const) {
    const q = sidePoint(n, s);
    const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
    if (d < bd) [best, bd] = [s, d];
  }
  return best;
}

/** Sides facing each other, for edges that omit them. */
export function autoSides(a: Rect, b: Rect): [CanvasSide, CanvasSide] {
  const dx = b.x + b.width / 2 - (a.x + a.width / 2);
  const dy = b.y + b.height / 2 - (a.y + a.height / 2);
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? ['right', 'left'] : ['left', 'right'];
  return dy >= 0 ? ['bottom', 'top'] : ['top', 'bottom'];
}

export interface EdgeGeometry {
  d: string;
  from: Point;
  to: Point;
  c1: Point;
  c2: Point;
  /** Point at t = 0.5 (label anchor). */
  mid: Point;
  /** Direction at the end (radians), for the arrow head. */
  endAngle: number;
  startAngle: number;
}

export function cubicAt(p0: Point, c1: Point, c2: Point, p1: Point, t: number): Point {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p1.x,
    y: u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p1.y,
  };
}

/** Curved edge between two side points; control arms follow the side normals. */
export function curve(from: Point, fromSide: CanvasSide, to: Point, toSide: CanvasSide | null): EdgeGeometry {
  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  const arm = Math.min(220, Math.max(36, dist * 0.42));
  const n0 = NORMAL[fromSide];
  const c1 = { x: from.x + n0.x * arm, y: from.y + n0.y * arm };
  const n1 = toSide ? NORMAL[toSide] : { x: (from.x - to.x) / (dist || 1), y: (from.y - to.y) / (dist || 1) };
  const c2 = { x: to.x + n1.x * arm, y: to.y + n1.y * arm };
  const r = (v: number) => Math.round(v * 10) / 10;
  return {
    d: `M ${r(from.x)} ${r(from.y)} C ${r(c1.x)} ${r(c1.y)}, ${r(c2.x)} ${r(c2.y)}, ${r(to.x)} ${r(to.y)}`,
    from,
    to,
    c1,
    c2,
    mid: cubicAt(from, c1, c2, to, 0.5),
    endAngle: Math.atan2(to.y - c2.y, to.x - c2.x),
    startAngle: Math.atan2(from.y - c1.y, from.x - c1.x),
  };
}

export function edgeGeometry(e: CanvasEdge, a: CanvasNode, b: CanvasNode): EdgeGeometry {
  const [fa, tb] = autoSides(a, b);
  const fs = e.fromSide ?? fa;
  const ts = e.toSide ?? tb;
  return curve(sidePoint(a, fs), fs, sidePoint(b, ts), ts);
}

/** Arrow head polygon points at `p` pointing along `angle`. */
export function arrowHead(p: Point, angle: number, size = 10): string {
  const a1 = angle + Math.PI - 0.45;
  const a2 = angle + Math.PI + 0.45;
  const f = (v: number) => Math.round(v * 10) / 10;
  return `${f(p.x)},${f(p.y)} ${f(p.x + Math.cos(a1) * size)},${f(p.y + Math.sin(a1) * size)} ${f(p.x + Math.cos(a2) * size)},${f(p.y + Math.sin(a2) * size)}`;
}

export function contains(outer: Rect, inner: Rect): boolean {
  return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;
}

export function hitNode(nodes: readonly CanvasNode[], p: Point): CanvasNode | null {
  // Topmost first; groups only when nothing else is hit.
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i];
    if (n.type !== 'group' && p.x >= n.x && p.y >= n.y && p.x <= n.x + n.width && p.y <= n.y + n.height) return n;
  }
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i];
    if (n.type === 'group' && p.x >= n.x && p.y >= n.y && p.x <= n.x + n.width && p.y <= n.y + n.height) return n;
  }
  return null;
}

/** Reading order (top-to-bottom, then left-to-right) for Tab cycling; groups last. */
export function readingOrder(nodes: readonly CanvasNode[]): CanvasNode[] {
  return [...nodes].sort((a, b) => {
    if ((a.type === 'group') !== (b.type === 'group')) return a.type === 'group' ? 1 : -1;
    const row = Math.round(a.y / 40) - Math.round(b.y / 40);
    return row || a.x - b.x || a.y - b.y;
  });
}

export function snap(v: number, grid = 20): number {
  return Math.round(v / grid) * grid;
}
