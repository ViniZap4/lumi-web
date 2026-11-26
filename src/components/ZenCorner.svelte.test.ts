// @vitest-environment jsdom
//
// Modo zen hot corner: pointer moves reveal / hide the chrome, keys
// never do, and nothing listens while zen is off.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import ZenCorner from './ZenCorner.svelte';
import { ZenController, HIDE_DELAY_MS } from '../lib/zen.svelte.ts';

let cmp: Record<string, any> | null = null;
let target: HTMLElement;
afterEach(() => {
  if (cmp) unmount(cmp);
  cmp = null;
  target?.remove();
  vi.useRealTimers();
  delete document.documentElement.dataset.zen;
  delete document.documentElement.dataset.zenReveal;
});

function move(x: number, y: number, el: Element = document.body): void {
  const e = new MouseEvent('pointermove', { clientX: x, clientY: y, bubbles: true });
  Object.defineProperty(e, 'pointerType', { value: 'mouse' });
  el.dispatchEvent(e);
}

function setup(on: boolean) {
  vi.useFakeTimers();
  const root = document.documentElement;
  const z = new ZenController({ storage: null, root });
  if (on) z.set(true);
  target = document.createElement('div');
  target.innerHTML = '<header class="topbar"><button>Livro</button></header><main>text</main>';
  document.body.appendChild(target);
  cmp = mount(ZenCorner, { target, props: { controller: z } });
  flushSync();
  return { z, root };
}

describe('ZenCorner', () => {
  it('reveals on the top-left corner and hides 600 ms after leaving', () => {
    const { z, root } = setup(true);
    move(20, 10);
    expect(z.revealed).toBe(true);
    expect(root.hasAttribute('data-zen-reveal')).toBe(true);
    move(500, 400);
    vi.advanceTimersByTime(HIDE_DELAY_MS - 10);
    expect(root.hasAttribute('data-zen-reveal')).toBe(true);
    vi.advanceTimersByTime(10);
    expect(root.hasAttribute('data-zen-reveal')).toBe(false);
  });

  it('stays revealed while the pointer is over the revealed bar', () => {
    const { z } = setup(true);
    move(20, 10);
    move(600, 12, target.querySelector('.topbar button')!);
    vi.advanceTimersByTime(HIDE_DELAY_MS * 3);
    expect(z.revealed).toBe(true);
  });

  it('the bar does not count before it is revealed', () => {
    const { z } = setup(true);
    move(600, 12, target.querySelector('.topbar button')!);
    expect(z.revealed).toBe(false);
  });

  it('typing never reveals', () => {
    const { z } = setup(true);
    for (const key of ['a', 'Escape', 'Meta', ' ']) document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    expect(z.revealed).toBe(false);
  });

  it('does nothing while zen is off, and starts listening when turned on', () => {
    const { z } = setup(false);
    move(10, 10);
    expect(z.revealed).toBe(false);
    z.set(true);
    flushSync();
    move(10, 10);
    expect(z.revealed).toBe(true);
  });

  it('touch moves are ignored', () => {
    const { z } = setup(true);
    const e = new MouseEvent('pointermove', { clientX: 5, clientY: 5, bubbles: true });
    Object.defineProperty(e, 'pointerType', { value: 'touch' });
    document.body.dispatchEvent(e);
    expect(z.revealed).toBe(false);
  });
});
