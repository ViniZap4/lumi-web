// Drop a note on a pane's edge to split there (SPEC-PARTE2 §3, "opening
// in a split from the explorer by mouse"). Pure geometry: which edge of
// the pane rect the pointer is over, and the split that edge means.

import type { SplitDir } from './pane-tree.ts';

export type DropSide = 'left' | 'right' | 'top' | 'bottom';

export interface DropTarget {
  side: DropSide;
  /** row = side by side (left/right), col = stacked (top/bottom). */
  dir: SplitDir;
  /** The new pane goes before (left of / above) the target pane. */
  before: boolean;
}

export const DROP_EDGE = 0.32;

/** The edge of `r` nearest to (x, y) when the point lies within `edge`
 *  (fraction of the pane's width/height) of it; null in the middle or
 *  outside the rect. */
export function dropSide(r: { left: number; top: number; width: number; height: number }, x: number, y: number, edge = DROP_EDGE): DropTarget | null {
  if (r.width <= 0 || r.height <= 0) return null;
  const fx = (x - r.left) / r.width;
  const fy = (y - r.top) / r.height;
  if (fx < 0 || fx > 1 || fy < 0 || fy > 1) return null;
  const cands: [DropSide, number][] = [
    ['left', fx],
    ['right', 1 - fx],
    ['top', fy],
    ['bottom', 1 - fy],
  ];
  cands.sort((a, b) => a[1] - b[1]);
  const [side, d] = cands[0];
  if (d > edge) return null;
  return { side, dir: side === 'left' || side === 'right' ? 'row' : 'col', before: side === 'left' || side === 'top' };
}

/** Drag payload type of explorer note rows (MillerColumn). */
export const NOTE_DRAG_TYPE = 'text/x-lumi-key';

/** Note id from a row key (`n:<id>`); null for folders. */
export function noteIdOfKey(key: string): string | null {
  return key.startsWith('n:') ? key.slice(2) : null;
}
