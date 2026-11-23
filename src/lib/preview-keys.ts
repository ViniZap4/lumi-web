// Keyboard reader for the split preview (Source + rendered preview).
//
// When the preview pane has focus it reads like the note reader / less:
// j/k (counts), d/u and Ctrl-d/Ctrl-u half pages, Space/b page, gg/G,
// (Ctrl-f stays the browser's find),
// heading jumps ({ } and [[ ]]), / find with n/N, f hint mode (links,
// checkboxes, copy buttons), Enter on a focused link, y copy, and
// q / Esc / e / i back to the editor. Ctrl-h/j/k/l and Ctrl-w are pane
// keys (lib/pane-nav.ts) and handled before this keymap.
//
// Pure and DOM-free; SourceSplit runs the actions.

import type { KeyLike } from './pane-nav.ts';

export type PreviewAction =
  | { kind: 'scroll'; unit: 'line' | 'half' | 'page'; n: number }
  | { kind: 'top' }
  | { kind: 'bottom' }
  | { kind: 'heading'; dir: 1 | -1; n: number }
  | { kind: 'find' }
  | { kind: 'findNext'; dir: 1 | -1 }
  | { kind: 'hints' }
  | { kind: 'open' }
  | { kind: 'yank' }
  /** q / Esc / e / i: back to the editor. */
  | { kind: 'back' }
  | { kind: 'help' }
  | { kind: 'command' }
  | { kind: 'pending' };

export const PREVIEW_CHORD_MS = 800;
const MAX_COUNT = 9999;

export class PreviewKeymap {
  private prefix: 'g' | '[' | ']' | null = null;
  private prefixAt = 0;
  private count: number | null = null;

  constructor(private now: () => number = Date.now) {}

  get pending(): string | null {
    if (this.prefix && this.now() - this.prefixAt >= PREVIEW_CHORD_MS) this.prefix = null;
    const c = this.count != null ? String(this.count) : '';
    const p = this.prefix ?? '';
    return c || p ? c + p : null;
  }

  reset(): void {
    this.prefix = null;
    this.count = null;
  }

  /** null = not bound (the browser keeps it: Tab, Cmd-c, …). */
  feed(e: KeyLike): PreviewAction | null {
    if (e.metaKey || e.altKey) {
      this.reset();
      return null;
    }
    if (e.ctrlKey) {
      this.reset();
      switch (e.key.toLowerCase()) {
        case 'd': return { kind: 'scroll', unit: 'half', n: 1 };
        case 'u': return { kind: 'scroll', unit: 'half', n: -1 };
        default: return null;
      }
    }
    switch (e.key) {
      case 'ArrowDown': return { kind: 'scroll', unit: 'line', n: this.takeCount() };
      case 'ArrowUp': return { kind: 'scroll', unit: 'line', n: -this.takeCount() };
      case 'PageDown': this.reset(); return { kind: 'scroll', unit: 'page', n: 1 };
      case 'PageUp': this.reset(); return { kind: 'scroll', unit: 'page', n: -1 };
      case 'Home': this.reset(); return { kind: 'top' };
      case 'End': this.reset(); return { kind: 'bottom' };
      case 'Enter': this.reset(); return { kind: 'open' };
      case 'Escape': this.reset(); return { kind: 'back' };
    }
    const ch = e.key;
    if (ch.length !== 1) return null;

    if (this.prefix) {
      const p = this.prefix;
      const armed = this.now() - this.prefixAt < PREVIEW_CHORD_MS;
      this.prefix = null;
      if (armed) {
        if (p === 'g' && ch === 'g') { this.count = null; return { kind: 'top' }; }
        if (p === '[' && ch === '[') return { kind: 'heading', dir: -1, n: this.takeCount() };
        if (p === ']' && ch === ']') return { kind: 'heading', dir: 1, n: this.takeCount() };
      }
      // Unknown second key: treat it on its own.
    }

    if (/^[0-9]$/.test(ch) && (ch !== '0' || this.count != null)) {
      this.count = Math.min(MAX_COUNT, (this.count ?? 0) * 10 + Number(ch));
      return { kind: 'pending' };
    }

    switch (ch) {
      case 'g':
      case '[':
      case ']':
        this.prefix = ch;
        this.prefixAt = this.now();
        return { kind: 'pending' };
      case 'j': return { kind: 'scroll', unit: 'line', n: this.takeCount() };
      case 'k': return { kind: 'scroll', unit: 'line', n: -this.takeCount() };
      case 'd': return { kind: 'scroll', unit: 'half', n: this.takeCount() };
      case 'u': return { kind: 'scroll', unit: 'half', n: -this.takeCount() };
      case ' ': return { kind: 'scroll', unit: 'page', n: e.shiftKey ? -1 : 1 };
      case 'b': this.count = null; return { kind: 'scroll', unit: 'page', n: -1 };
      case 'G': this.count = null; return { kind: 'bottom' };
      case '}': return { kind: 'heading', dir: 1, n: this.takeCount() };
      case '{': return { kind: 'heading', dir: -1, n: this.takeCount() };
      case '/': this.count = null; return { kind: 'find' };
      case 'n': this.count = null; return { kind: 'findNext', dir: 1 };
      case 'N': this.count = null; return { kind: 'findNext', dir: -1 };
      case 'f':
      case 'F': this.count = null; return { kind: 'hints' };
      case 'y': this.count = null; return { kind: 'yank' };
      case 'q':
      case 'e':
      case 'i': this.count = null; return { kind: 'back' };
      case '?': this.count = null; return { kind: 'help' };
      case ':': this.count = null; return { kind: 'command' };
    }
    this.count = null;
    return null;
  }

  private takeCount(): number {
    const n = Math.max(1, this.count ?? 1);
    this.count = null;
    return n;
  }
}

/**
 * Scroll target for a heading jump: `tops` are the headings' offsets in
 * the scroller (ascending), `scrollTop` the current position. Jumps `n`
 * headings past the one at the top (a heading within `slack` px of the
 * top counts as "here"). null when there is none that way.
 */
export function headingTarget(tops: readonly number[], scrollTop: number, dir: 1 | -1, n = 1, slack = 4): number | null {
  if (tops.length === 0) return null;
  if (dir > 0) {
    const after = tops.filter((t) => t > scrollTop + slack);
    return after.length ? after[Math.min(after.length, n) - 1] : null;
  }
  const before = tops.filter((t) => t < scrollTop - slack);
  return before.length ? before[Math.max(0, before.length - n)] : null;
}

/** Match offsets of `q` in `text`; smartcase (case-insensitive unless
 *  the query has an uppercase letter), like vim with `smartcase`. */
export function findOffsets(text: string, q: string): number[] {
  if (!q) return [];
  const sensitive = /[A-Z]/.test(q);
  const hay = sensitive ? text : text.toLowerCase();
  const needle = sensitive ? q : q.toLowerCase();
  const out: number[] = [];
  let i = hay.indexOf(needle);
  while (i >= 0 && out.length < 5000) {
    out.push(i);
    i = hay.indexOf(needle, i + Math.max(1, needle.length));
  }
  return out;
}

/** Index of the first match at/after `from` (wrapping), stepping `dir`. */
export function nextMatchIndex(count: number, current: number, dir: 1 | -1): number {
  if (count <= 0) return -1;
  if (current < 0) return dir > 0 ? 0 : count - 1;
  return (current + dir + count) % count;
}

/** DOM ranges for every match of `q` in the text under `root` (matches
 *  may span inline elements: `foo **bar**`). */
export function findRanges(root: Node, q: string): Range[] {
  const doc = root.ownerDocument ?? (root as Document);
  const walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
  const nodes: Text[] = [];
  const starts: number[] = [];
  let text = '';
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n as Text;
    // Skip text inside buttons (Copy / Wrap) and hidden UI.
    if (t.parentElement?.closest('button, [aria-hidden="true"]')) continue;
    nodes.push(t);
    starts.push(text.length);
    text += t.data;
  }
  const at = (off: number, end: boolean): [Text, number] => {
    // Last node whose start <= off (for an end offset, < off).
    let lo = 0;
    let hi = nodes.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (end ? starts[mid] < off : starts[mid] <= off) lo = mid;
      else hi = mid - 1;
    }
    return [nodes[lo], off - starts[lo]];
  };
  const out: Range[] = [];
  if (!nodes.length) return out;
  for (const off of findOffsets(text, q)) {
    const r = doc.createRange();
    const [sn, so] = at(off, false);
    const [en, eo] = at(off + q.length, true);
    r.setStart(sn, so);
    r.setEnd(en, eo);
    out.push(r);
  }
  return out;
}
