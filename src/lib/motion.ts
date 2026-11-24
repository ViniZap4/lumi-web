// Motion policy + spring tokens (SPEC-PARTE2 §1, "the app should feel
// alive"). One place decides whether the UI animates: off when the OS
// asks for reduced motion or the user turned on "Reduce motion"
// (settings), which also sets `data-motion="reduce"` on <html> so the
// CSS kill-switch in app.css applies to every transition.
//
// Springs: a tiny damped-oscillator solver samples the curve once and
// turns it into a CSS `linear()` easing (the same strings are pasted
// into app.css as --spring-*), so WAAPI and CSS share one feel.
//
// Rule: nothing here is ever awaited on the key path. Every helper is
// fire-and-forget; the DOM state is final immediately and the
// animation only decorates it.

let userReduce = false;

export function setReduceMotion(on: boolean, root: HTMLElement | null = typeof document !== 'undefined' ? document.documentElement : null): void {
  userReduce = on;
  if (!root) return;
  if (on) root.dataset.motion = 'reduce';
  else delete root.dataset.motion;
}

export function prefersReducedMotion(): boolean {
  try {
    return typeof window !== 'undefined' && (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
  } catch {
    return false;
  }
}

export function motionAllowed(): boolean {
  return !userReduce && !prefersReducedMotion();
}

// ---- springs ---------------------------------------------------------------

export interface SpringParams {
  stiffness: number;
  damping: number;
  mass?: number;
}

export interface SpringCurve {
  /** Progress samples (0 → 1, may overshoot), evenly spaced in time. */
  points: number[];
  /** Time until the spring is at rest (ms). */
  ms: number;
}

/** Simulate a unit spring from 0 to 1 (semi-implicit Euler, 1 ms step)
 *  until it rests within `epsilon`; sample `samples` points over that
 *  time. The last point is exactly 1. */
export function springCurve({ stiffness, damping, mass = 1 }: SpringParams, samples = 22, epsilon = 0.004): SpringCurve {
  const dt = 1 / 1000;
  let x = 0;
  let v = 0;
  const trace: number[] = [0];
  let rest = 0;
  for (let t = 1; t <= 2000; t++) {
    const a = (-stiffness * (x - 1) - damping * v) / mass;
    v += a * dt;
    x += v * dt;
    trace.push(x);
    if (Math.abs(1 - x) < epsilon && Math.abs(v) < epsilon * 10) {
      if (!rest) rest = t;
      if (t - rest > 8) break;
    } else rest = 0;
  }
  const ms = rest || trace.length - 1;
  const points: number[] = [];
  for (let i = 0; i < samples; i++) {
    const t = Math.round((i / (samples - 1)) * ms);
    points.push(i === samples - 1 ? 1 : trace[t]);
  }
  return { points, ms };
}

/** CSS `linear()` easing for a spring (≤ `samples` stops). */
export function springLinear(p: SpringParams, samples = 22): string {
  const { points } = springCurve(p, samples);
  return `linear(${points.map((x) => +x.toFixed(3)).join(', ')})`;
}

export interface SpringToken {
  easing: string;
  /** Duration to pair with the easing (ms). */
  ms: number;
  params: SpringParams;
  /** The sampled curve (for JS easings: see springEase). */
  points: readonly number[];
}

function token(params: SpringParams, cap: number): SpringToken {
  const { ms, points } = springCurve(params);
  return { easing: springLinear(params), ms: Math.min(cap, Math.ceil(ms / 10) * 10), params, points };
}

/** t (0..1) → progress along a sampled spring (svelte transitions). */
export function springEase(points: readonly number[], t: number): number {
  if (t <= 0) return 0;
  const x = t * (points.length - 1);
  const i = Math.floor(x);
  if (i >= points.length - 1) return 1;
  return points[i] + (points[i + 1] - points[i]) * (x - i);
}

/**
 * - snappy: the typing path and small UI (≤ 220 ms, barely overshoots);
 * - gentle: panes, views, list entry (critically-ish damped);
 * - bouncy: overlays settling (a visible but small overshoot).
 */
export const SPRING = {
  snappy: token({ stiffness: 820, damping: 50 }, 220),
  gentle: token({ stiffness: 420, damping: 36 }, 300),
  bouncy: token({ stiffness: 620, damping: 30 }, 320),
} as const;

export type SpringName = keyof typeof SPRING;

// ---- helpers ----------------------------------------------------------------

type VTDocument = Document & { startViewTransition?: (cb: () => unknown) => { finished: Promise<void> } };

/**
 * Run a DOM-changing update inside a View Transition when motion is
 * allowed and the browser supports it; otherwise run it directly.
 * `update` may be async (e.g. awaits Svelte's tick()).
 */
export async function withViewTransition(update: () => unknown | Promise<unknown>): Promise<void> {
  const doc = (typeof document !== 'undefined' ? document : null) as VTDocument | null;
  if (!doc?.startViewTransition || !motionAllowed()) {
    await update();
    return;
  }
  try {
    const vt = doc.startViewTransition(() => update());
    await vt.finished.catch(() => {});
  } catch {
    await update();
  }
}

/** Element.animate when motion is allowed (GPU: transform/opacity only).
 *  Defaults to the snappy spring. Returns the Animation (or null). */
export function animate(el: Element | null | undefined, frames: Keyframe[], ms: number = SPRING.snappy.ms, easing: string = SPRING.snappy.easing, delay = 0): Animation | null {
  if (!el || !motionAllowed() || typeof (el as HTMLElement).animate !== 'function') return null;
  try {
    return (el as HTMLElement).animate(frames, { duration: ms, easing, delay, fill: delay ? 'backwards' : 'none' });
  } catch {
    return null;
  }
}

type RectLike = Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>;

/** FLIP: `el` was at `first` before a layout change and is now at its
 *  final place; animate from the old box to the new one. */
export function flip(el: Element | null | undefined, first: RectLike | null | undefined, spring: SpringName = 'gentle'): Animation | null {
  if (!el || !first || !motionAllowed()) return null;
  const last = el.getBoundingClientRect();
  if (!last.width || !last.height) return null;
  const dx = first.left - last.left;
  const dy = first.top - last.top;
  const sx = first.width / last.width;
  const sy = first.height / last.height;
  if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && Math.abs(sx - 1) < 0.01 && Math.abs(sy - 1) < 0.01) return null;
  const s = SPRING[spring];
  return animate(
    el,
    [
      { transformOrigin: 'top left', transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` },
      { transformOrigin: 'top left', transform: 'none' },
    ],
    s.ms,
    s.easing,
  );
}

export interface StaggerOptions {
  /** ms between items (default 18). */
  step?: number;
  /** Total stagger budget (ms); later items share the last slot. ≤ 200. */
  max?: number;
  /** Distance items rise from (px). */
  y?: number;
}

/** Staggered list entry (opacity + a small rise). Fire-and-forget; the
 *  items are interactive at once. Returns the delays used. */
export function stagger(els: ArrayLike<Element>, { step = 18, max = 160, y = 6 }: StaggerOptions = {}): number[] {
  if (!motionAllowed()) return [];
  const cap = Math.min(200, max);
  const s = SPRING.gentle;
  const delays: number[] = [];
  for (let i = 0; i < els.length; i++) {
    const delay = Math.min(cap, i * step);
    delays.push(delay);
    animate(els[i], [{ opacity: 0, transform: `translateY(${y}px)` }, { opacity: 1, transform: 'none' }], s.ms, s.easing, delay);
  }
  return delays;
}

/**
 * Shared-element transition: `fromEl` (e.g. an explorer row) becomes
 * the element marked `[data-vt-target="<name>"]` after `update` (e.g.
 * the opened note's title). With the View Transitions API the source
 * gets `view-transition-name: <name>` for the old snapshot and the
 * target carries the same name (set here) for the new one. Without it,
 * the target FLIPs from the source's box. Reduced motion: plain update.
 */
export async function sharedTransition(name: string, fromEl: Element | null | undefined, update: () => unknown | Promise<unknown>): Promise<void> {
  const doc = (typeof document !== 'undefined' ? document : null) as VTDocument | null;
  const src = fromEl as HTMLElement | null | undefined;
  if (!doc || !src || !motionAllowed()) {
    await update();
    return;
  }
  const first = src.getBoundingClientRect();
  const target = (): HTMLElement | null => doc.querySelector<HTMLElement>(`[data-vt-target="${cssEscape(name)}"]`);
  if (doc.startViewTransition) {
    src.style.setProperty('view-transition-name', name);
    try {
      const vt = doc.startViewTransition(async () => {
        src.style.removeProperty('view-transition-name');
        await update();
        target()?.style.setProperty('view-transition-name', name);
      });
      await vt.finished.catch(() => {});
    } catch {
      await update();
    } finally {
      src.style.removeProperty('view-transition-name');
      target()?.style.removeProperty('view-transition-name');
    }
    return;
  }
  await update();
  const t = target();
  if (t) {
    flip(t, first, 'gentle');
    animate(t, [{ opacity: 0.4 }, { opacity: 1 }], SPRING.gentle.ms, 'ease-out');
  }
}

function cssEscape(s: string): string {
  const css = (globalThis as { CSS?: { escape?: (x: string) => string } }).CSS;
  return css?.escape ? css.escape(s) : s.replace(/["\\]/g, '\\$&');
}

/** Smooth scroll behaviour for scrollTo / scrollIntoView. */
export function scrollBehavior(): ScrollBehavior {
  return motionAllowed() ? 'smooth' : 'auto';
}
