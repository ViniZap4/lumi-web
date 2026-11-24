// @vitest-environment jsdom
// Motion v2: the spring integrator (settling, interruption / retarget,
// momentum), the shared engine (freeze / seek for frame capture) and
// the motion level gating (completo / suave / reduzido + the OS).
import { describe, it, expect, afterEach, vi } from 'vitest';
import { Spring, SPRING, springTo, springIn, cascade, exitGhost, engine, velocityOf, valueOf, setMotionLevel, motionLevel, motionAllowed, travel, stopSpring } from './motion.ts';

function run(s: Spring, ms: number, dt = 1 / 60): number[] {
  const xs: number[] = [];
  for (let t = 0; t < ms; t += dt * 1000) {
    s.step(dt);
    xs.push(s.x);
  }
  return xs;
}

afterEach(() => {
  setMotionLevel('full');
  delete (window as unknown as { matchMedia?: unknown }).matchMedia;
  for (const el of [...engine.tracks.keys()]) engine.stop(el);
  if (engine.frozen) engine.thaw();
});

describe('Spring integrator', () => {
  it('settles exactly on the target and reports rest', () => {
    for (const k of Object.keys(SPRING) as (keyof typeof SPRING)[]) {
      const s = new Spring(SPRING[k].params, 0, 100, { restDelta: 0.01, restSpeed: 0.05 });
      run(s, 2000);
      expect(s.settled, k).toBe(true);
      expect(s.x).toBe(100);
      expect(s.v).toBe(0);
    }
  });
  it('rests within its token duration (± a frame budget)', () => {
    const s = new Spring(SPRING.glide.params, 0, 1, { restDelta: 0.004, restSpeed: 0.04 });
    let t = 0;
    while (!s.step(1 / 240)) t += 1000 / 240;
    expect(t).toBeLessThan(SPRING.glide.ms + 120);
  });
  it('is frame-rate independent (30 vs 144 fps land on the same curve)', () => {
    const a = new Spring(SPRING.bouncy.params, 0, 1);
    const b = new Spring(SPRING.bouncy.params, 0, 1);
    a.step(0.1);
    for (let i = 0; i < 10; i++) b.step(0.01);
    expect(Math.abs(a.x - b.x)).toBeLessThan(0.02);
  });
  it('underdamped springs overshoot (visible physics), soft does not', () => {
    const b = new Spring(SPRING.bouncy.params, 0, 1);
    expect(Math.max(...run(b, 800))).toBeGreaterThan(1.12);
    const s = new Spring(SPRING.soft.params, 0, 1);
    expect(Math.max(...run(s, 1200))).toBeLessThanOrEqual(1.0005);
  });
  it('retarget mid-flight keeps position and velocity (no jump, no queue)', () => {
    const s = new Spring(SPRING.glide.params, 0, 100);
    run(s, 80);
    const x = s.x;
    const v = s.v;
    expect(v).toBeGreaterThan(0);
    s.setTarget(-50);
    expect(s.x).toBe(x);
    expect(s.v).toBe(v);
    // It keeps moving forward a moment (momentum) before turning back.
    s.step(1 / 120);
    expect(s.x).toBeGreaterThan(x);
    run(s, 2000);
    expect(s.x).toBe(-50);
  });
  it('kick adds momentum', () => {
    const s = new Spring(SPRING.glide.params, 0, 0);
    s.kick(800);
    s.step(1 / 60);
    expect(s.x).toBeGreaterThan(5);
    run(s, 2000);
    expect(s.x).toBe(0);
  });
  it('long frame gaps never explode (stable at dt = 64 ms)', () => {
    const s = new Spring(SPRING.snappy.params, 0, 1);
    for (let i = 0; i < 40; i++) s.step(0.064);
    expect(s.x).toBe(1);
  });
});

describe('engine (shared rAF loop)', () => {
  it('springTo writes compositor-only styles and hands back to CSS at rest', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    engine.freeze();
    springIn(el, { y: 20, opacity: 0 }, { spring: 'gentle' });
    expect(el.style.transform).toContain('translate3d(0.00px, 20.00px, 0)');
    expect(el.style.opacity).toBe('0');
    engine.seek(120);
    const y = valueOf(el, 'y');
    expect(y).toBeGreaterThan(0);
    expect(y).toBeLessThan(20);
    engine.seek(2000);
    expect(engine.tracks.has(el)).toBe(false);
    expect(el.style.transform).toBe('');
    expect(el.style.opacity).toBe('');
    el.remove();
  });
  it('a second springTo interrupts: same element, current x and v carry over', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    engine.freeze();
    springTo(el, { x: 100 }, { from: { x: 0 } });
    engine.seek(60);
    const x = valueOf(el, 'x');
    const v = velocityOf(el, 'x');
    expect(v).toBeGreaterThan(0);
    springTo(el, { x: 0 });
    expect(valueOf(el, 'x')).toBeCloseTo(x, 5);
    expect(velocityOf(el, 'x')).toBeCloseTo(v, 5);
    expect(engine.tracks.size).toBe(1);
    stopSpring(el);
    el.remove();
  });
  it('delayed tracks hold their from-pose until their start', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    engine.freeze();
    springIn(el, { y: 10 }, { delay: 100 });
    engine.seek(80);
    expect(valueOf(el, 'y')).toBe(10);
    engine.seek(200);
    expect(valueOf(el, 'y')).toBeLessThan(10);
    stopSpring(el);
    el.remove();
  });
  it('cascade staggers ≤ 240 ms in total and ≤ 14 items', () => {
    const els = Array.from({ length: 30 }, () => document.body.appendChild(document.createElement('p')));
    engine.freeze();
    const d = cascade(els, { y: 12, opacity: 0 }, { step: 26 });
    expect(d.length).toBe(14);
    expect(d[1]).toBe(26);
    expect(Math.max(...d)).toBe(240);
    els.forEach((e) => e.remove());
  });
  it('exitGhost plays the exit on a clone and removes it', () => {
    const el = document.createElement('section');
    el.id = 'x';
    el.dataset.testid = 'floating-explorer';
    el.getBoundingClientRect = () => ({ left: 10, top: 10, width: 100, height: 50, right: 110, bottom: 60, x: 10, y: 10, toJSON() {} }) as DOMRect;
    document.body.appendChild(el);
    engine.freeze();
    const g = exitGhost(el, { scale: 0.9, opacity: 0 }, { spring: 'snappy' })!;
    expect(g).not.toBeNull();
    expect(g.isConnected).toBe(true);
    expect(g.id).toBe('');
    expect(g.dataset.testid).toBeUndefined();
    expect(g.getAttribute('aria-hidden')).toBe('true');
    engine.seek(3000);
    expect(g.isConnected).toBe(false);
    el.remove();
  });
});

describe('motion level gating', () => {
  it('completo → full travel; suave → less travel, no overshoot; reduzido → nothing', () => {
    setMotionLevel('full');
    expect(motionLevel()).toBe('full');
    expect(travel()).toBe(1);
    setMotionLevel('soft');
    expect(document.documentElement.dataset.motion).toBe('soft');
    expect(travel()).toBeLessThan(0.6);
    const el = document.body.appendChild(document.createElement('div'));
    engine.freeze();
    springIn(el, { y: 100 }, { spring: 'bouncy' });
    expect(valueOf(el, 'y')).toBeCloseTo(100 * travel(), 5);
    let min = Infinity;
    for (let t = 16; t < 1500; t += 16) {
      engine.seek(t);
      min = Math.min(min, valueOf(el, 'y'));
    }
    expect(min).toBeGreaterThanOrEqual(-0.05); // suave never overshoots
    setMotionLevel('reduced');
    expect(document.documentElement.dataset.motion).toBe('reduce');
    expect(motionAllowed()).toBe(false);
    const onRest = vi.fn();
    expect(springIn(el, { y: 50 }, { onRest })).toBe(false);
    expect(onRest).toHaveBeenCalled();
    expect(el.style.transform).toBe('');
    expect(cascade([el], { y: 4 })).toEqual([]);
    expect(exitGhost(el, { opacity: 0 })).toBeNull();
    el.remove();
  });
  it('prefers-reduced-motion maps to reduzido whatever the setting', () => {
    (window as unknown as { matchMedia: unknown }).matchMedia = () => ({ matches: true });
    setMotionLevel('full');
    expect(motionLevel()).toBe('reduced');
    expect(springTo(document.createElement('div'), { x: 4 })).toBe(false);
  });
  it('the stylesheet maps suave to non-overshooting curves', async () => {
    const fs = (await import(/* @vite-ignore */ 'node:' + 'fs')) as { readFileSync(p: string, enc: string): string };
    const proc = (globalThis as unknown as { process: { cwd(): string } }).process;
    const css = fs.readFileSync(`${proc.cwd()}/src/styles/tokens.css`, 'utf8');
    expect(css).toMatch(/:root\[data-motion='soft'\]\s*\{[^}]*--spring-bouncy: var\(--spring-gentle-curve\)/);
  });
});

import { slab, riseBlocks, armRise, carousel } from './motion-actions.ts';

describe('choreographies (motion-actions)', () => {
  it('the cursor slab stretches with speed and settles at its own height', () => {
    const el = document.body.appendChild(document.createElement('div'));
    engine.freeze();
    const a = slab(el, 0);
    a.update(90);
    engine.seek(48);
    expect(el.style.transform).toMatch(/scaleY\(1\.[1-5]/);
    engine.seek(2000);
    expect(el.style.transform).toBe('translate3d(0, 90.00px, 0)');
    el.remove();
  });
  it('blocks rise only when a note is being opened (not on a re-mount)', () => {
    const root = document.body.appendChild(document.createElement('div'));
    for (let i = 0; i < 4; i++) {
      const b = root.appendChild(document.createElement('div'));
      b.className = 'md-b';
      b.getBoundingClientRect = () => ({ top: 10 * i, bottom: 10 * i + 8, left: 0, right: 10, width: 10, height: 8, x: 0, y: 0, toJSON() {} }) as DOMRect;
    }
    engine.freeze();
    expect(riseBlocks(root)).toEqual([]);
    armRise();
    expect(riseBlocks(root).length).toBe(4);
    // Consumed: a second reader rendering right after does not rise.
    expect(riseBlocks(root)).toEqual([]);
    root.remove();
  });
  it('carousel steps accumulate (momentum) and spring home', () => {
    const el = document.body.appendChild(document.createElement('div'));
    engine.freeze();
    carousel(el, 90);
    engine.seek(16);
    const x1 = valueOf(el, 'x');
    carousel(el, 90);
    expect(valueOf(el, 'x')).toBeGreaterThan(x1 + 80);
    engine.seek(3000);
    expect(engine.tracks.has(el)).toBe(false);
    el.remove();
  });
});
