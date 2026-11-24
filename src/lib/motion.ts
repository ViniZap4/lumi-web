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

/** Settings → "Movimento": completo | suave | reduzido. `soft` keeps
 *  every choreography but with less travel and no overshoot; `reduced`
 *  (also forced by the OS preference) makes every change instant. */
export type MotionLevel = 'full' | 'soft' | 'reduced';

let userLevel: MotionLevel = 'full';

export function setMotionLevel(level: MotionLevel, root: HTMLElement | null = typeof document !== 'undefined' ? document.documentElement : null): void {
  userLevel = level;
  if (!root) return;
  if (level === 'reduced') root.dataset.motion = 'reduce';
  else if (level === 'soft') root.dataset.motion = 'soft';
  else delete root.dataset.motion;
}

/** Back-compat: the old boolean "Reduce motion" setting. */
export function setReduceMotion(on: boolean, root?: HTMLElement | null): void {
  setMotionLevel(on ? 'reduced' : 'full', root === undefined ? (typeof document !== 'undefined' ? document.documentElement : null) : root);
}

export function prefersReducedMotion(): boolean {
  try {
    return typeof window !== 'undefined' && (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
  } catch {
    return false;
  }
}

/** The effective level: the OS preference always wins (→ reduced). */
export function motionLevel(): MotionLevel {
  return prefersReducedMotion() ? 'reduced' : userLevel;
}

export function motionAllowed(): boolean {
  return motionLevel() !== 'reduced';
}

/** Travel multiplier for the current level (full 1, soft 0.45). */
export function travel(): number {
  const l = motionLevel();
  return l === 'full' ? 1 : l === 'soft' ? 0.45 : 0;
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
 * The named springs of the motion language, v2 (docs/DESIGN-LANGUAGE.md
 * §6). v1 was tuned so tight (≤ 220 ms, ≤ 1 % overshoot) that nobody
 * could see it; v2 keeps the 90 %-there time short (≈ 90–160 ms, so
 * nothing feels slow) but lets the tail carry visible physics.
 * The same numbers drive the Mac (SwiftUI .interpolatingSpring) and the
 * TUI (harmonica), and tokens.css carries the sampled `linear()` strings.
 * - snappy (ζ .72, ≈ 3 % overshoot): press, small UI, the typing path's
 *   neighbours;
 * - glide (ζ .67, ≈ 6 %): things that travel — cursor slab, folder
 *   carousel, mode pill, landing cards, pane sizes;
 * - gentle (ζ .87): panes, views, content rising in;
 * - bouncy (ζ .5, ≈ 16 %): things that pop — overlays opening, badges,
 *   toasts, node spawn, names;
 * - soft (ζ .9): large surfaces, veils, ambient.
 */
export const SPRING = {
  snappy: token({ stiffness: 700, damping: 38 }, 360),
  glide: token({ stiffness: 380, damping: 26 }, 520),
  gentle: token({ stiffness: 260, damping: 28 }, 520),
  bouncy: token({ stiffness: 400, damping: 20 }, 720),
  soft: token({ stiffness: 150, damping: 22 }, 720),
} as const;

/** Non-spring durations (ms) of the motion language. */
export const DURATION = {
  /** Press feedback, hover tints. */
  tap: 90,
  /** Fades and colour changes. */
  fade: 140,
  /** Exits: always faster than the matching entrance. */
  exit: 120,
  /** One remote-change flash / ping. */
  flash: 700,
  /** Breathing (sync dot, live presence) period. */
  breath: 2400,
  /** Ambient background drift period (home). */
  ambient: 26000,
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

// ---- spring physics (v2) ------------------------------------------------------
//
// A real damped spring, integrated per frame, so motion is
// INTERRUPTIBLE: retargeting mid-flight keeps the current position and
// velocity (no jump, no queue). One shared rAF loop drives every live
// track; it writes only `transform` and `opacity` (compositor-only) and
// stops when everything rests. Nothing here is awaited: the DOM state is
// final at once and the spring catches up ("keys never wait").

/** One-dimensional damped spring (mass-spring-damper). */
export class Spring {
  x: number;
  v = 0;
  target: number;
  readonly k: number;
  readonly c: number;
  readonly m: number;
  /** Rest thresholds (distance, speed) in the value's own units. */
  restDelta: number;
  restSpeed: number;

  constructor(p: SpringParams, from = 0, to = from, opts: { restDelta?: number; restSpeed?: number } = {}) {
    this.k = p.stiffness;
    this.c = p.damping;
    this.m = p.mass ?? 1;
    this.x = from;
    this.target = to;
    this.restDelta = opts.restDelta ?? 0.01;
    this.restSpeed = opts.restSpeed ?? 0.05;
  }

  /** Retarget mid-flight: position AND velocity carry over. */
  setTarget(t: number): void {
    this.target = t;
  }

  /** Add an impulse (units / s), e.g. carousel momentum. */
  kick(dv: number): void {
    this.v += dv;
  }

  get settled(): boolean {
    return Math.abs(this.target - this.x) < this.restDelta && Math.abs(this.v) < this.restSpeed;
  }

  /** Advance `dt` seconds (fixed ≤ 4 ms sub-steps, semi-implicit Euler:
   *  stable at any frame rate). Returns true once at rest (snapped). */
  step(dt: number): boolean {
    if (this.settled) {
      this.x = this.target;
      this.v = 0;
      return true;
    }
    const n = Math.max(1, Math.ceil(dt / 0.004));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      const a = (-this.k * (this.x - this.target) - this.c * this.v) / this.m;
      this.v += a * h;
      this.x += this.v * h;
    }
    if (this.settled) {
      this.x = this.target;
      this.v = 0;
      return true;
    }
    return false;
  }
}

/** Channels a track can animate (transform parts + opacity). */
export interface Channels {
  x: number;
  y: number;
  scale: number;
  sx: number;
  sy: number;
  rotate: number;
  opacity: number;
}
type Ch = keyof Channels;
const IDENTITY: Channels = { x: 0, y: 0, scale: 1, sx: 1, sy: 1, rotate: 0, opacity: 1 };
const REST: Record<Ch, [number, number]> = {
  x: [0.3, 2],
  y: [0.3, 2],
  rotate: [0.05, 0.5],
  scale: [0.0015, 0.01],
  sx: [0.0015, 0.01],
  sy: [0.0015, 0.01],
  opacity: [0.004, 0.02],
};

export interface SpringOptions {
  spring?: SpringName | SpringParams;
  /** Start values (applied only when no track is running, or `jump`). */
  from?: Partial<Channels>;
  /** Initial velocities (units / s). */
  velocity?: Partial<Channels>;
  /** Start even if a track is running (discard the old position). */
  jump?: boolean;
  /** ms before the spring starts (the `from` pose holds meanwhile). */
  delay?: number;
  /** transform-origin for the track (e.g. '0 0', 'left center'). */
  origin?: string;
  onRest?: () => void;
  /** Custom per-frame renderer (default: transform + opacity); gets the
   *  values and the velocities (units / s). */
  render?: (el: HTMLElement, v: Channels, vel: Channels) => void;
  /** `from` values are absolute positions (not entrance offsets that
   *  the motion level scales). */
  absolute?: boolean;
  /** Offset the CURRENT position by these amounts (velocity kept):
   *  carousel-style momentum when keys repeat. */
  add?: Partial<Channels>;
}

interface Track {
  el: HTMLElement;
  springs: Partial<Record<Ch, Spring>>;
  start: number;
  onRest?: () => void;
  render?: (el: HTMLElement, v: Channels, vel: Channels) => void;
  touched: Set<Ch>;
}

function paramsOf(s: SpringName | SpringParams | undefined): SpringParams {
  const p = typeof s === 'string' ? SPRING[s].params : (s ?? SPRING.glide.params);
  if (motionLevel() !== 'soft') return p;
  // Suave: the same rhythm, no overshoot (critically damped-ish).
  const crit = 2 * Math.sqrt(p.stiffness * (p.mass ?? 1));
  return { ...p, damping: Math.max(p.damping, crit * 0.95) };
}

/** Values in `from` relative to identity, scaled by the level's travel. */
function scaled(ch: Ch, v: number): number {
  const id = IDENTITY[ch];
  if (ch === 'opacity') return v;
  return id + (v - id) * travel();
}

class Engine {
  tracks = new Map<HTMLElement, Track>();
  private raf = 0;
  private last = 0;
  /** Capture hooks: a frozen clock that only moves when seeked. */
  frozen = false;
  virtual = 0;
  private frozenBase = 0;

  now(): number {
    return this.frozen ? this.frozenBase + this.virtual : (typeof performance !== 'undefined' ? performance.now() : Date.now());
  }

  freeze(): void {
    this.frozenBase = this.now();
    this.virtual = 0;
    this.last = this.frozenBase;
    this.frozen = true;
  }

  seek(t: number): void {
    if (!this.frozen) return;
    // Forward only: integrate up to the requested time.
    // 16 ms steps, like real frames (tick clamps long gaps).
    while (this.virtual < t) {
      this.virtual = Math.min(t, this.virtual + 16);
      this.tick(this.now());
    }
  }

  thaw(): void {
    this.frozen = false;
    this.last = this.now();
    this.kick();
  }

  run(el: HTMLElement, to: Partial<Channels>, o: SpringOptions): Track {
    const p = paramsOf(o.spring);
    let t = this.tracks.get(el);
    const fresh = !t || o.jump;
    if (!t) {
      t = { el, springs: {}, start: this.now() + (o.delay ?? 0), touched: new Set() };
      this.tracks.set(el, t);
    } else if (o.jump) t.start = this.now() + (o.delay ?? 0);
    t.onRest = o.onRest;
    t.render = o.render ?? t.render;
    if (o.origin) el.style.transformOrigin = o.origin;
    const chans = new Set<Ch>([...(Object.keys(to) as Ch[]), ...(Object.keys(o.from ?? {}) as Ch[])]);
    if (o.add) for (const ch of Object.keys(o.add) as Ch[]) chans.delete(ch);
    for (const ch of chans) {
      const target = to[ch] ?? IDENTITY[ch];
      let s = t.springs[ch];
      const [rd, rs] = REST[ch];
      if (!s || fresh) {
        const from = o.from?.[ch] !== undefined ? (o.absolute ? o.from[ch]! : scaled(ch, o.from[ch]!)) : s ? s.x : IDENTITY[ch];
        const v0 = s && !o.jump ? s.v : 0;
        s = new Spring(p, from, target, { restDelta: rd, restSpeed: rs });
        s.v = v0;
        t.springs[ch] = s;
      } else {
        // Interrupt: keep x and v, new target (and the new feel).
        const next = new Spring(p, s.x, target, { restDelta: rd, restSpeed: rs });
        next.v = s.v;
        t.springs[ch] = next;
        s = next;
      }
      if (o.velocity?.[ch] !== undefined) s.kick(o.velocity[ch]! * travel());
      t.touched.add(ch);
    }
    for (const ch of Object.keys(o.add ?? {}) as Ch[]) {
      const d = o.add![ch]!;
      let s = t.springs[ch];
      if (!s) {
        const [rd, rs] = REST[ch];
        s = t.springs[ch] = new Spring(p, IDENTITY[ch], to[ch] ?? IDENTITY[ch], { restDelta: rd, restSpeed: rs });
      }
      s.x += ch === 'opacity' ? d : d * travel();
      t.touched.add(ch);
    }
    this.paint(t);
    this.kick();
    return t;
  }

  values(t: Track): Channels {
    const v = { ...IDENTITY };
    for (const ch of Object.keys(t.springs) as Ch[]) v[ch] = t.springs[ch]!.x;
    return v;
  }

  paint(t: Track): void {
    const v = this.values(t);
    if (t.render) {
      const vel = { x: 0, y: 0, scale: 0, sx: 0, sy: 0, rotate: 0, opacity: 0 };
      for (const ch of Object.keys(t.springs) as Ch[]) vel[ch] = t.springs[ch]!.v;
      return t.render(t.el, v, vel);
    }
    const st = t.el.style;
    if (t.touched.has('x') || t.touched.has('y') || t.touched.has('scale') || t.touched.has('sx') || t.touched.has('sy') || t.touched.has('rotate')) {
      const sx = v.scale * v.sx;
      const sy = v.scale * v.sy;
      st.transform = `translate3d(${v.x.toFixed(2)}px, ${v.y.toFixed(2)}px, 0)${v.rotate ? ` rotate(${v.rotate.toFixed(3)}deg)` : ''}${sx !== 1 || sy !== 1 ? ` scale(${sx.toFixed(4)}, ${sy.toFixed(4)})` : ''}`;
    }
    if (t.touched.has('opacity')) st.opacity = String(Math.max(0, Math.min(1, v.opacity)));
  }

  /** At rest on identity: hand the element back to CSS. */
  release(t: Track): void {
    const v = this.values(t);
    const st = t.el.style;
    const ident = (Object.keys(IDENTITY) as Ch[]).every((ch) => Math.abs(v[ch] - IDENTITY[ch]) < 1e-3);
    if (ident && !t.render) {
      st.removeProperty('transform');
      st.removeProperty('opacity');
      st.removeProperty('transform-origin');
      st.removeProperty('will-change');
    }
  }

  stop(el: HTMLElement, release = true): void {
    const t = this.tracks.get(el);
    if (!t) return;
    this.tracks.delete(el);
    if (release) {
      for (const ch of Object.keys(t.springs) as Ch[]) {
        t.springs[ch]!.x = t.springs[ch]!.target;
      }
      this.paint(t);
      this.release(t);
    }
  }

  private kick(): void {
    if (this.raf || this.frozen || typeof requestAnimationFrame === 'undefined') return;
    this.last = this.now();
    this.raf = requestAnimationFrame((ts) => this.frame(ts));
  }

  private frame(_ts: number): void {
    this.raf = 0;
    if (this.frozen) return;
    this.tick(this.now());
    if (this.tracks.size) this.raf = requestAnimationFrame((ts) => this.frame(ts));
  }

  tick(now: number): void {
    // Clamp long gaps (a background tab, a GC): never teleport.
    const dt = Math.min(0.064, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    for (const t of [...this.tracks.values()]) {
      if (!t.el.isConnected) {
        this.tracks.delete(t.el);
        continue;
      }
      if (now < t.start) continue;
      let rest = true;
      for (const ch of Object.keys(t.springs) as Ch[]) rest = t.springs[ch]!.step(dt) && rest;
      this.paint(t);
      if (rest) {
        this.tracks.delete(t.el);
        this.release(t);
        t.onRest?.();
      }
    }
  }
}

export const engine = new Engine();

if (typeof window !== 'undefined') {
  // Frame-capture hooks (scripts/perf/motion-frames.mjs): freeze / seek.
  (window as unknown as { __lumiMotion: unknown }).__lumiMotion = {
    freeze: () => engine.freeze(),
    seek: (t: number) => engine.seek(t),
    thaw: () => engine.thaw(),
  };
}

/**
 * Spring `el` to `to` (missing channels → identity). Interruptible: a
 * second call mid-flight retargets from the current position and
 * velocity. Reduced motion: no-op (and any running track snaps to rest).
 * Returns false when nothing animates.
 */
export function springTo(el: Element | null | undefined, to: Partial<Channels>, o: SpringOptions = {}): boolean {
  const h = el as HTMLElement | null | undefined;
  if (!h) return false;
  if (!motionAllowed()) {
    engine.stop(h);
    o.onRest?.();
    return false;
  }
  engine.run(h, to, o);
  return true;
}

/** Spring from a pose back to identity (the usual "enter"). */
export function springIn(el: Element | null | undefined, from: Partial<Channels>, o: Omit<SpringOptions, 'from'> = {}): boolean {
  return springTo(el, {}, { ...o, from, jump: o.jump ?? true });
}

/** Current velocity of a channel (units / s), 0 when idle. */
export function velocityOf(el: Element | null | undefined, ch: Ch): number {
  const t = el ? engine.tracks.get(el as HTMLElement) : undefined;
  return t?.springs[ch]?.v ?? 0;
}

/** Current value of a channel (identity when idle). */
export function valueOf(el: Element | null | undefined, ch: Ch): number {
  const t = el ? engine.tracks.get(el as HTMLElement) : undefined;
  return t?.springs[ch]?.x ?? IDENTITY[ch];
}

export function stopSpring(el: Element | null | undefined): void {
  if (el) engine.stop(el as HTMLElement);
}

export interface CascadeOptions {
  /** ms between items (default 24). */
  step?: number;
  /** Total stagger budget (ms; default 240). */
  max?: number;
  /** Most items to animate (the rest appear at once; default 14). */
  limit?: number;
  spring?: SpringName | SpringParams;
  /** ms before the first item (e.g. after an exit). */
  delay?: number;
}

/** Staggered spring entry: each item springs from `from` to identity.
 *  Items are interactive at once. Returns the delays used. */
export function cascade(els: ArrayLike<Element>, from: Partial<Channels>, { step = 24, max = 240, limit = 14, spring = 'gentle', delay = 0 }: CascadeOptions = {}): number[] {
  if (!motionAllowed()) return [];
  const delays: number[] = [];
  const k = motionLevel() === 'soft' ? 0.6 : 1;
  const n = Math.min(els.length, limit);
  for (let i = 0; i < n; i++) {
    const d = Math.min(max, i * step * k);
    delays.push(d);
    springIn(els[i], from, { spring, delay: delay + d });
  }
  return delays;
}

/**
 * Exit ghost: the DOM is already gone/changed (state is final), but a
 * snapshot clone of `el` plays the exit where it was, then removes
 * itself. `to` is the end pose. Used for the explorer collapse, so close
 * is visible without delaying anything.
 */
export function exitGhost(el: Element | null | undefined, to: Partial<Channels>, o: SpringOptions & { parent?: Element; shallow?: boolean } = {}): HTMLElement | null {
  const src = el as HTMLElement | null | undefined;
  if (!src || !motionAllowed() || typeof document === 'undefined') return null;
  const r = src.getBoundingClientRect();
  if (!r.width || !r.height) return null;
  const ghost = src.cloneNode(!o.shallow) as HTMLElement;
  ghost.removeAttribute('id');
  ghost.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'));
  ghost.removeAttribute('data-testid');
  ghost.querySelectorAll('[data-testid]').forEach((n) => n.removeAttribute('data-testid'));
  ghost.setAttribute('aria-hidden', 'true');
  ghost.setAttribute('inert', '');
  ghost.classList.add('motion-ghost');
  ghost.style.animation = 'none';
  const st = ghost.style;
  st.position = 'fixed';
  st.left = `${r.left}px`;
  st.top = `${r.top}px`;
  st.width = `${r.width}px`;
  st.height = `${r.height}px`;
  st.margin = '0';
  st.pointerEvents = 'none';
  st.zIndex = '9000';
  st.willChange = 'transform, opacity';
  (o.parent ?? document.body).appendChild(ghost);
  const done = () => ghost.remove();
  // Safety net: a ghost never outlives a second.
  setTimeout(done, 1000);
  springTo(ghost, to, { ...o, onRest: () => { done(); o.onRest?.(); } });
  return ghost;
}
