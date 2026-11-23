// Scroll sync between the source editor and the split preview.
//
// The preview's top-level blocks carry the source line they start at
// (`data-line`, lib/markdown.ts). Measuring their offsets gives a
// monotonic table line → y; both directions interpolate linearly
// inside a block, so scrolling through a long paragraph or code block
// moves the other side proportionally instead of in jumps.

export interface Anchor {
  /** 0-based source line (fractional allowed for the end sentinel). */
  line: number;
  /** Offset (px) of the block's top inside the preview scroller. */
  top: number;
}

/** Sort, drop non-monotonic anchors (a block measured above an earlier
 *  one, e.g. floats), and add an end sentinel. */
export function normalizeAnchors(raw: readonly Anchor[], totalLines: number, contentHeight: number): Anchor[] {
  const sorted = [...raw].sort((a, b) => a.line - b.line || a.top - b.top);
  const out: Anchor[] = [{ line: 0, top: 0 }];
  for (const a of sorted) {
    const last = out[out.length - 1];
    if (a.line < last.line || a.top < last.top) continue;
    if (a.line === last.line) {
      last.top = Math.max(last.top, a.top);
      continue;
    }
    out.push({ line: a.line, top: a.top });
  }
  const last = out[out.length - 1];
  const endLine = Math.max(totalLines, last.line + 1);
  out.push({ line: endLine, top: Math.max(contentHeight, last.top) });
  return out;
}

function seg<T>(xs: readonly T[], key: (t: T) => number, v: number): number {
  // Last index i with key(xs[i]) <= v (binary search).
  let lo = 0;
  let hi = xs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (key(xs[mid]) <= v) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Source line (fractional) → preview offset. */
export function lineToOffset(anchors: readonly Anchor[], line: number): number {
  if (anchors.length === 0) return 0;
  if (line <= anchors[0].line) return anchors[0].top;
  const i = seg(anchors, (a) => a.line, line);
  const a = anchors[i];
  const b = anchors[i + 1];
  if (!b) return a.top;
  const f = (line - a.line) / (b.line - a.line || 1);
  return a.top + f * (b.top - a.top);
}

/** Preview offset → source line (fractional). */
export function offsetToLine(anchors: readonly Anchor[], top: number): number {
  if (anchors.length === 0) return 0;
  if (top <= anchors[0].top) return anchors[0].line;
  const i = seg(anchors, (a) => a.top, top);
  const a = anchors[i];
  const b = anchors[i + 1];
  if (!b) return a.line;
  const f = (top - a.top) / (b.top - a.top || 1);
  return a.line + f * (b.line - a.line);
}

/** Measure anchors from rendered blocks (`[data-line]` children). */
export function measureAnchors(container: HTMLElement, scroller: HTMLElement): Anchor[] {
  const base = scroller.getBoundingClientRect().top - scroller.scrollTop;
  const out: Anchor[] = [];
  for (const el of Array.from(container.querySelectorAll<HTMLElement>(':scope > [data-line]'))) {
    const line = Number(el.dataset.line);
    if (!Number.isFinite(line)) continue;
    out.push({ line, top: el.getBoundingClientRect().top - base });
  }
  return out;
}

/**
 * Which side drives the sync. A programmatic scroll of the follower
 * fires its own scroll event; only the side the user last touched
 * (wheel, pointer, key, focus) propagates, so the two never ping-pong.
 */
export class ScrollLeader {
  private leader: 'source' | 'preview' = 'source';
  claim(side: 'source' | 'preview'): void {
    this.leader = side;
  }
  get current(): 'source' | 'preview' {
    return this.leader;
  }
  accepts(side: 'source' | 'preview'): boolean {
    return side === this.leader;
  }
}

/** Trailing debounce (re-render the preview while typing). */
export function debounce<A extends unknown[]>(fn: (...a: A) => void, ms: number): ((...a: A) => void) & { cancel(): void; flush(): void } {
  let t: ReturnType<typeof setTimeout> | null = null;
  let last: A | null = null;
  const d = ((...a: A) => {
    last = a;
    if (t) clearTimeout(t);
    t = setTimeout(() => {
      t = null;
      const args = last!;
      last = null;
      fn(...args);
    }, ms);
  }) as ((...a: A) => void) & { cancel(): void; flush(): void };
  d.cancel = () => {
    if (t) clearTimeout(t);
    t = null;
    last = null;
  };
  d.flush = () => {
    if (!t || !last) return;
    clearTimeout(t);
    t = null;
    const args = last;
    last = null;
    fn(...args);
  };
  return d;
}

/** Split preview re-render delay after the last keystroke. */
export const PREVIEW_DEBOUNCE_MS = 120;
