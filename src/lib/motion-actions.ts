// Svelte actions + small choreographies on top of the spring engine
// (lib/motion.ts). Every one is fire-and-forget: the DOM is already in
// its final state, the spring only decorates the change.

import { springTo, springIn, cascade, motionAllowed, travel, valueOf, type Channels, type SpringName } from './motion.ts';

/**
 * The list cursor slab: springs to `y` (glide), stretching along its
 * travel with speed (up to +55 %) and settling back to its own height —
 * the cursor feels like it has mass. Interruptible: holding j retargets
 * without queueing.
 */
export function slab(node: HTMLElement, y: number) {
  const render = (el: HTMLElement, v: Channels, vel: Channels) => {
    const stretch = 1 + Math.min(0.55, Math.abs(vel.y) / 2600) * travel();
    // Stretch from the trailing edge: the head leads, the tail follows.
    el.style.transformOrigin = vel.y >= 0 ? '50% 0' : '50% 100%';
    el.style.transform = `translate3d(0, ${v.y.toFixed(2)}px, 0)${stretch > 1.001 ? ` scaleY(${stretch.toFixed(4)})` : ''}`;
  };
  let at = y;
  node.style.transform = `translate3d(0, ${y}px, 0)`;
  return {
    update(next: number) {
      if (next === at) return;
      const from = at;
      at = next;
      if (!motionAllowed()) {
        node.style.transform = `translate3d(0, ${next}px, 0)`;
        return;
      }
      // Long jumps (G, gg, ⌃d) travel at most ~6 rows: the slab
      // arrives from just above / below, never sweeps the whole list.
      const cur = valueOf(node, 'y');
      const start = cur !== 0 || from === 0 ? cur : from;
      const max = 6 * 30;
      const clamped = Math.abs(next - start) > max ? next - Math.sign(next - start) * max : start;
      springTo(node, { y: next }, { spring: 'glide', from: { y: clamped }, absolute: true, render });
    },
  };
}

/** Spring in once on mount (badges, names, toasts, cards). */
export function popIn(node: HTMLElement, opts: { from?: Partial<Channels>; spring?: SpringName; delay?: number } = {}) {
  springIn(node, opts.from ?? { scale: 0.6, opacity: 0 }, { spring: opts.spring ?? 'bouncy', delay: opts.delay });
}

/** A note is being OPENED (not re-mounted by a split or a layout
 *  change): the next reader that renders a new document rises in. */
let riseArmedAt = 0;
export function armRise(): void {
  riseArmedAt = Date.now();
}
export function riseArmed(): boolean {
  return Date.now() - riseArmedAt < 1500;
}

/** Note open: the content rises in by blocks — headings and paragraphs
 *  staggered 24 ms each, at most 240 ms in total (first 10 blocks). */
export function riseBlocks(root: Element | null | undefined): number[] {
  if (!root || !motionAllowed() || !riseArmed()) return [];
  riseArmedAt = 0;
  const blocks = Array.from(root.querySelectorAll<HTMLElement>(':scope > .md-b, :scope > .md-body > .md-b')).filter((b) => {
    const r = b.getBoundingClientRect();
    return r.bottom > 0 && r.top < (typeof window !== 'undefined' ? window.innerHeight : 2000);
  });
  return cascade(blocks, { y: 18, opacity: 0 }, { step: 26, max: 240, limit: 10, spring: 'gentle', delay: 40 });
}

/** A carousel step: the element keeps its momentum and gets pushed by
 *  `dx` more (repeated l / h accumulate), then springs home. */
export function carousel(el: Element | null | undefined, dx: number, spring: SpringName = 'glide'): void {
  if (!el || !motionAllowed()) return;
  springTo(el, { x: 0 }, { add: { x: dx }, spring });
}

/** Current x of an element under the engine (for chained effects). */
export function currentX(el: Element | null | undefined): number {
  return valueOf(el, 'x');
}

/** Where the next overlay should grow from: a trigger the pointer just
 *  used (the explorer button, a link) — kept for 800 ms. */
let origin: { rect: DOMRect; at: number } | null = null;
export function setOrigin(el: Element | null | undefined): void {
  origin = el ? { rect: el.getBoundingClientRect(), at: Date.now() } : null;
}
export function takeOrigin(fallback?: Element | null): DOMRect | null {
  const o = origin && Date.now() - origin.at < 800 ? origin.rect : null;
  origin = null;
  return o ?? fallback?.getBoundingClientRect() ?? null;
}
