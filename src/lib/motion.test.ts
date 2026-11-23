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
