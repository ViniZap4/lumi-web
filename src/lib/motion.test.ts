// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { setReduceMotion, motionAllowed, withViewTransition, animate } from './motion.ts';

afterEach(() => setReduceMotion(false));

describe('reduced motion', () => {
  it('the setting marks <html> and turns motion off', () => {
    setReduceMotion(true);
    expect(document.documentElement.dataset.motion).toBe('reduce');
    expect(motionAllowed()).toBe(false);
    setReduceMotion(false);
    expect(document.documentElement.dataset.motion).toBeUndefined();
    expect(motionAllowed()).toBe(true);
  });
  it('view transitions are skipped (update runs directly) when reduced', async () => {
    const start = vi.fn((cb: () => unknown) => { void cb(); return { finished: Promise.resolve() }; });
    (document as unknown as { startViewTransition: unknown }).startViewTransition = start;
    let ran = 0;
    setReduceMotion(true);
    await withViewTransition(() => ran++);
    expect(start).not.toHaveBeenCalled();
    expect(ran).toBe(1);
    setReduceMotion(false);
    await withViewTransition(() => ran++);
    expect(start).toHaveBeenCalledTimes(1);
    expect(ran).toBe(2);
    delete (document as unknown as { startViewTransition?: unknown }).startViewTransition;
  });
  it('without the API the update still runs synchronously', () => {
    let ran = false;
    void withViewTransition(() => (ran = true));
    expect(ran).toBe(true);
  });
  it('element animations are not started when reduced', () => {
    const el = document.createElement('div');
    const spy = vi.fn();
    (el as unknown as { animate: unknown }).animate = spy;
    setReduceMotion(true);
    animate(el, [{ opacity: 0 }, { opacity: 1 }]);
    expect(spy).not.toHaveBeenCalled();
    setReduceMotion(false);
    animate(el, [{ opacity: 0 }, { opacity: 1 }]);
    expect(spy).toHaveBeenCalledTimes(1);
  });
  it('the stylesheet kills transitions + animations for the setting and the OS preference', async () => {
    // Read app.css from disk (vitest runs with css: false).
    const fs = (await import(/* @vite-ignore */ 'node:' + 'fs')) as { readFileSync(p: string, enc: string): string };
    const proc = (globalThis as unknown as { process: { cwd(): string } }).process;
    const css = fs.readFileSync(`${proc.cwd()}/src/app.css`, 'utf8');
    expect(css).toMatch(/:root\[data-motion='reduce'\] \*[^{]*\{\s*animation: none !important;\s*transition: none !important;/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?transition: none !important/);
  });
});

import { springCurve, springLinear, SPRING, springEase, flip, stagger, sharedTransition, scrollBehavior } from './motion.ts';

describe('springs', () => {
  it('a spring curve starts at 0, ends exactly at 1 and settles', () => {
    const c = springCurve({ stiffness: 500, damping: 40 });
    expect(c.points[0]).toBe(0);
    expect(c.points.at(-1)).toBe(1);
    expect(c.ms).toBeGreaterThan(50);
    expect(c.ms).toBeLessThan(1000);
    // Settled: the last few samples are within 1 % of rest.
    for (const p of c.points.slice(-3)) expect(Math.abs(1 - p)).toBeLessThan(0.01);
  });
  it('underdamped springs overshoot, critically damped ones do not (much)', () => {
    expect(Math.max(...springCurve(SPRING.bouncy.params).points)).toBeGreaterThan(1.03);
    expect(Math.max(...springCurve(SPRING.snappy.params).points)).toBeLessThan(1.01);
  });
  it('linear() strings are well-formed and short', () => {
    const s = springLinear({ stiffness: 400, damping: 30 });
    expect(s).toMatch(/^linear\(0(, -?\d+(\.\d+)?)+\)$/);
    expect(s.split(',').length).toBeLessThanOrEqual(24);
    expect(s.endsWith(', 1)')).toBe(true);
  });
  it('tokens: snappy fits the typing-path budget, overlays stay short', () => {
    expect(SPRING.snappy.ms).toBeLessThanOrEqual(220);
    expect(SPRING.gentle.ms).toBeLessThanOrEqual(320);
    expect(SPRING.bouncy.ms).toBeLessThanOrEqual(320);
    for (const t of Object.values(SPRING)) expect(t.easing.startsWith('linear(')).toBe(true);
  });
  it('the CSS spring variables (styles/tokens.css, the one token source) match the solver', async () => {
    const fs = (await import(/* @vite-ignore */ 'node:' + 'fs')) as { readFileSync(p: string, enc: string): string };
    const proc = (globalThis as unknown as { process: { cwd(): string } }).process;
    const css = fs.readFileSync(`${proc.cwd()}/src/styles/tokens.css`, 'utf8');
    expect(fs.readFileSync(`${proc.cwd()}/src/app.css`, 'utf8')).toContain("@import './styles/tokens.css';");
    for (const k of ['snappy', 'glide', 'gentle', 'bouncy', 'soft'] as const) {
      expect(css).toContain(`--spring-${k}: ${SPRING[k].easing};`);
      expect(css).toContain(`--spring-${k}-ms: ${SPRING[k].ms}ms;`);
    }
  });
  it('springEase interpolates the sampled curve', () => {
    const pts = SPRING.gentle.points;
    expect(springEase(pts, 0)).toBe(0);
    expect(springEase(pts, 1)).toBe(1);
    const mid = springEase(pts, 0.5);
    expect(mid).toBeGreaterThan(0.5);
    expect(mid).toBeLessThan(1);
  });
});

function animEl(rect = { left: 0, top: 0, width: 100, height: 20 }) {
  const el = document.createElement('div');
  const spy = vi.fn(() => ({}) as Animation);
  (el as unknown as { animate: unknown }).animate = spy;
  el.getBoundingClientRect = () => ({ ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height, x: rect.left, y: rect.top, toJSON() {} }) as DOMRect;
  return { el, spy };
}

describe('motion helpers + reduced-motion gating', () => {
  afterEach(() => {
    delete (window as unknown as { matchMedia?: unknown }).matchMedia;
  });

  it('flip animates from the old box with a spring; no-op when nothing moved', () => {
    const { el, spy } = animEl({ left: 100, top: 50, width: 100, height: 20 });
    flip(el, { left: 100, top: 50, width: 100, height: 20 });
    expect(spy).not.toHaveBeenCalled();
    flip(el, { left: 20, top: 10, width: 50, height: 20 });
    expect(spy).toHaveBeenCalledTimes(1);
    const [frames, opts] = spy.mock.calls[0] as unknown as [Keyframe[], KeyframeAnimationOptions];
    expect(String(frames[0].transform)).toContain('translate(-80px, -40px)');
    expect(opts.easing).toBe(SPRING.gentle.easing);
  });

  it('stagger delays items, capped at 200 ms in total', () => {
    const items = Array.from({ length: 30 }, () => animEl());
    const delays = stagger(items.map((x) => x.el), { step: 20, max: 500 });
    expect(delays[0]).toBe(0);
    expect(delays[1]).toBe(20);
    expect(Math.max(...delays)).toBe(200);
    expect(items.every((x) => x.spy.mock.calls.length === 1)).toBe(true);
  });

  it('the OS preference turns every helper off', async () => {
    (window as unknown as { matchMedia: unknown }).matchMedia = () => ({ matches: true });
    expect(motionAllowed()).toBe(false);
    expect(scrollBehavior()).toBe('auto');
    const a = animEl();
    expect(animate(a.el, [{ opacity: 0 }, { opacity: 1 }])).toBeNull();
    expect(flip(a.el, { left: 0, top: 90, width: 10, height: 10 })).toBeNull();
    expect(stagger([a.el])).toEqual([]);
    expect(a.spy).not.toHaveBeenCalled();
    const start = vi.fn();
    (document as unknown as { startViewTransition: unknown }).startViewTransition = start;
    let ran = 0;
    await sharedTransition('note-title', a.el, () => ran++);
    expect(ran).toBe(1);
    expect(start).not.toHaveBeenCalled();
    delete (document as unknown as { startViewTransition?: unknown }).startViewTransition;
  });

  it('the app setting turns every helper off too', () => {
    setReduceMotion(true);
    const a = animEl();
    expect(stagger([a.el, a.el])).toEqual([]);
    expect(flip(a.el, { left: 50, top: 0, width: 100, height: 20 })).toBeNull();
    expect(a.spy).not.toHaveBeenCalled();
  });

  it('sharedTransition names the source, then the target, inside a view transition', async () => {
    const src = animEl().el;
    const dst = document.createElement('h1');
    let seenSrc = '';
    let seenDst = '';
    (document as unknown as { startViewTransition: unknown }).startViewTransition = (cb: () => Promise<void>) => {
      seenSrc = src.style.getPropertyValue('view-transition-name');
      const done = cb().then(() => { seenDst = dst.style.getPropertyValue('view-transition-name'); });
      return { finished: done };
    };
    await sharedTransition('note-title', src, () => {
      dst.dataset.vtTarget = 'note-title';
      document.body.appendChild(dst);
    });
    expect(seenSrc).toBe('note-title');
    expect(seenDst).toBe('note-title');
    // Names are cleared afterwards (they must be unique per snapshot).
    expect(src.style.getPropertyValue('view-transition-name')).toBe('');
    expect(dst.style.getPropertyValue('view-transition-name')).toBe('');
    dst.remove();
    delete (document as unknown as { startViewTransition?: unknown }).startViewTransition;
  });

  it('without the API, the target FLIPs from the source box', async () => {
    const src = animEl({ left: 10, top: 300, width: 120, height: 20 }).el;
    const t = animEl({ left: 40, top: 60, width: 300, height: 40 });
    await sharedTransition('note-title', src, () => {
      t.el.dataset.vtTarget = 'note-title';
      document.body.appendChild(t.el);
    });
    expect(t.spy).toHaveBeenCalled();
    t.el.remove();
  });

  it('the stylesheet gates the new motion (scroll, caret, springs) under both switches', async () => {
    const fs = (await import(/* @vite-ignore */ 'node:' + 'fs')) as { readFileSync(p: string, enc: string): string };
    const proc = (globalThis as unknown as { process: { cwd(): string } }).process;
    const css = fs.readFileSync(`${proc.cwd()}/src/app.css`, 'utf8');
    expect(css).toMatch(/html \{ scroll-behavior: smooth; \}/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*html \{ scroll-behavior: auto; \}/);
    expect(css).toMatch(/:root\[data-motion='reduce'\] \{ scroll-behavior: auto !important; \}/);
    const tokens = fs.readFileSync(`${proc.cwd()}/src/styles/tokens.css`, 'utf8');
    expect(tokens).toMatch(/@supports not \(animation-timing-function: linear\(0, 1\)\)/);
    // Ambient motion pauses while the tab is hidden (lib/ambient.ts).
    expect(css).toMatch(/:root\[data-hidden\] \*[^{]*\{ animation-play-state: paused !important; \}/);
  });
});
