// Remote collaborator carets GLIDE to their new position instead of
// jumping (docs/DESIGN-LANGUAGE.md §6.6 / §6.10 #11).
//
// y-codemirror.next redraws a peer's caret as a fresh widget on every
// awareness move. After the redraw we measure each caret (CodeMirror's
// measure phase: reads, then writes), and a caret whose peer moved is
// pushed back to where it was drawn before and springs home on the
// `glide` spring (lib/motion.ts). The name tag is a child of the caret,
// so it travels with it.
//
// Rules:
//  - Only awareness moves glide. Document changes (local typing, remote
//    edits) never animate and never measure synchronously: the typing
//    path stays untouched; positions are re-baselined once the doc is
//    idle for a moment.
//  - ≤ 220 ms: the glide lands on its first pass through the target
//    (after ≥ 100 ms of rise) or at 220 ms, whichever comes first.
//  - Interruptible: a move mid-glide starts from the caret's current
//    visual position and keeps its velocity.
//  - Reduce Motion (OS or Movimento: reduzido): nothing is measured or
//    animated.

import { ViewPlugin, type EditorView, type ViewUpdate } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import { engine, motionAllowed, springTo, stopSpring, valueOf, velocityOf } from './motion.ts';

/** Max glide time; the spring's tail past it snaps (it is < 1 px). */
export const CARET_GLIDE_MS = 220;
/** Longer jumps (another screen, a far line) just appear. */
export const CARET_GLIDE_MAX_PX = 900;
const REBASELINE_MS = 160;

export interface CaretPos {
  key: string;
  /** Layout position relative to the editor content (transform excluded). */
  x: number;
  y: number;
  el: HTMLElement;
}

export interface CaretGlide {
  el: HTMLElement;
  /** Offset to start from (old visual position − new layout position). */
  dx: number;
  dy: number;
  /** Carried velocity (px / s) from a glide that was interrupted. */
  vx: number;
  vy: number;
}

/**
 * Which carets glide, and from where. `prev` holds the last VISUAL
 * position per peer key (layout + any in-flight offset). Ambiguous keys
 * (two carets with the same name and colour) never glide.
 */
export function planGlides(
  prev: ReadonlyMap<string, { x: number; y: number; vx?: number; vy?: number }>,
  next: readonly CaretPos[],
  maxDist = CARET_GLIDE_MAX_PX,
): CaretGlide[] {
  const count = new Map<string, number>();
  for (const c of next) count.set(c.key, (count.get(c.key) ?? 0) + 1);
  const out: CaretGlide[] = [];
  for (const c of next) {
    if (count.get(c.key) !== 1) continue;
    const p = prev.get(c.key);
    if (!p) continue;
    const dx = p.x - c.x;
    const dy = p.y - c.y;
    const d = Math.hypot(dx, dy);
    if (d < 0.5 || d > maxDist) continue;
    out.push({ el: c.el, dx, dy, vx: p.vx ?? 0, vy: p.vy ?? 0 });
  }
  return out;
}

/** Peer identity of a y-codemirror caret widget: name + colour. */
function caretKey(el: HTMLElement): string {
  const name = el.querySelector('.cm-ySelectionInfo')?.textContent ?? '';
  return `${name}\u0000${el.style.borderColor || el.style.backgroundColor}`;
}

interface AwarenessLike {
  doc: { clientID: number };
  on(ev: 'change', fn: (ch: { added: number[]; updated: number[]; removed: number[] }) => void): void;
  off(ev: 'change', fn: (ch: { added: number[]; updated: number[]; removed: number[] }) => void): void;
}

interface Measured {
  carets: CaretPos[];
}

class CaretGlidePlugin {
  /** Last visual position per peer key. */
  private positions = new Map<string, { x: number; y: number; vx: number; vy: number }>();
  /** The doc changed since the last measure: positions are stale. */
  private stale = true;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly onChange: (ch: { added: number[]; updated: number[]; removed: number[] }) => void;

  constructor(
    private readonly view: EditorView,
    private readonly awareness: AwarenessLike | null,
  ) {
    this.onChange = ({ added, updated, removed }) => {
      const me = this.awareness?.doc.clientID;
      if ([...added, ...updated, ...removed].some((id) => id !== me)) this.schedule(true);
    };
    this.awareness?.on('change', this.onChange);
    this.rebaselineSoon();
  }

  update(u: ViewUpdate): void {
    // Typing (and remote edits) shift carets with the text: no glide,
    // no layout read now — re-baseline once the doc is idle.
    if (u.docChanged || u.geometryChanged) this.rebaselineSoon();
  }

  private rebaselineSoon(): void {
    this.stale = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.schedule(false);
    }, REBASELINE_MS);
  }

  private schedule(glide: boolean): void {
    if (!motionAllowed()) {
      this.positions.clear();
      this.stale = true;
      return;
    }
    this.view.requestMeasure<Measured>({
      key: this,
      read: () => this.read(),
      write: (m) => this.write(m, glide),
    });
  }

  private read(): Measured {
    const content = this.view.contentDOM;
    const els = content.querySelectorAll<HTMLElement>('.cm-ySelectionCaret');
    if (!els.length) return { carets: [] };
    const base = content.getBoundingClientRect();
    const carets: CaretPos[] = [];
    for (const el of els) {
      const r = el.getBoundingClientRect();
      carets.push({
        key: caretKey(el),
        x: r.left - base.left - valueOf(el, 'x'),
        // Vertical centre: the arrival grow (scaleY) keeps it fixed.
        y: r.top + r.height / 2 - base.top - valueOf(el, 'y'),
        el,
      });
    }
    return { carets };
  }

  private write(m: Measured, glide: boolean): void {
    if (glide && !this.stale && motionAllowed()) {
      for (const g of planGlides(this.positions, m.carets)) {
        g.el.classList.add('cm-ySelectionCaret-glide');
        const t0 = engine.now();
        let done = false;
        springTo(g.el, { x: 0, y: 0 }, {
          spring: 'glide',
          from: { x: g.dx, y: g.dy },
          absolute: true,
          jump: true,
          velocity: { x: g.vx, y: g.vy },
          // Lands on its first pass through the target (after the rise)
          // or at the 220 ms cap, whichever comes first: never a visible
          // snap, never longer than the budget.
          render: (node, v) => {
            if (!done) {
              const t = engine.now() - t0;
              done = t >= CARET_GLIDE_MS || (t >= 100 && v.x * g.dx + v.y * g.dy <= 0);
              if (done) queueMicrotask(() => stopSpring(node));
            }
            if (done) node.style.removeProperty('transform');
            else node.style.transform = `translate3d(${v.x.toFixed(2)}px, ${v.y.toFixed(2)}px, 0)`;
          },
        });
      }
    }
    const next = new Map<string, { x: number; y: number; vx: number; vy: number }>();
    for (const c of m.carets) {
      // Visual position = layout + the offset still in flight.
      next.set(c.key, { x: c.x + valueOf(c.el, 'x'), y: c.y + valueOf(c.el, 'y'), vx: velocityOf(c.el, 'x'), vy: velocityOf(c.el, 'y') });
    }
    this.positions = next;
    this.stale = false;
  }

  destroy(): void {
    this.awareness?.off('change', this.onChange);
    if (this.timer) clearTimeout(this.timer);
  }
}

/** Gliding remote carets; add AFTER yCollab (its widgets must exist). */
export function remoteCaretGlide(awareness: AwarenessLike | null): Extension {
  if (!awareness) return [];
  return ViewPlugin.define((view) => new CaretGlidePlugin(view, awareness));
}
