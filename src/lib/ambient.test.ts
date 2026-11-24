// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { installAmbient } from './ambient.ts';
import { setReduceMotion } from './motion.ts';

afterEach(() => {
  setReduceMotion(false);
  document.body.innerHTML = '';
  delete document.documentElement.dataset.hidden;
});

function setVisibility(v: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => v });
  document.dispatchEvent(new Event('visibilitychange'));
}

function pointer(target: Element, x: number, y: number, pointerType = 'mouse') {
  const e = new MouseEvent('pointermove', { bubbles: true, clientX: x, clientY: y });
  Object.defineProperty(e, 'pointerType', { value: pointerType });
  target.dispatchEvent(e);
}

describe('ambient life', () => {
  it('pauses every animation while the tab is hidden (data-hidden on <html>)', () => {
    const off = installAmbient();
    setVisibility('hidden');
    expect(document.documentElement.dataset.hidden).toBe('');
    setVisibility('visible');
    expect(document.documentElement.dataset.hidden).toBeUndefined();
    off();
    setVisibility('hidden');
    expect(document.documentElement.dataset.hidden).toBeUndefined();
    setVisibility('visible');
  });

  it('the cursor light follows the pointer on the hovered .glow surface only, once per frame', () => {
    let queued: FrameRequestCallback[] = [];
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      queued.push(cb);
      return queued.length;
    });
    const frame = () => {
      const q = queued;
      queued = [];
      q.forEach((cb) => cb(0));
    };
    document.body.innerHTML = '<button class="glow" id="a"><span id="in">x</span></button><button class="glow" id="b"></button>';
    const a = document.getElementById('a')!;
    const b = document.getElementById('b')!;
    a.getBoundingClientRect = () => ({ left: 10, top: 20, width: 100, height: 30 }) as DOMRect;
    const off = installAmbient();
    pointer(document.getElementById('in')!, 70, 90);
    pointer(document.getElementById('in')!, 40, 35);
    expect(queued.length).toBe(1);
    frame();
    expect(a.style.getPropertyValue('--mx')).toBe('30px');
    expect(a.style.getPropertyValue('--my')).toBe('15px');
    pointer(b, 5, 5);
    frame();
    expect(a.style.getPropertyValue('--mx')).toBe('');
    // Touch input and reduced motion: no light.
    pointer(a, 50, 50, 'touch');
    frame();
    expect(a.style.getPropertyValue('--mx')).toBe('');
    setReduceMotion(true);
    pointer(a, 50, 50);
    frame();
    expect(a.style.getPropertyValue('--mx')).toBe('');
    off();
    raf.mockRestore();
  });
});
