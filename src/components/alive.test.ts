// @vitest-environment jsdom
// Alive-motion components: SyncDot pulse, ToastStack, ModePill.
import { describe, it, expect, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import SyncDot from './SyncDot.svelte';
import ToastStack from './ToastStack.svelte';
import ModePill from './ModePill.svelte';
import { remoteActivity } from '../lib/remote-activity.svelte.ts';
import { toasts } from '../lib/toasts.svelte.ts';
import { setReduceMotion } from '../lib/motion.ts';

// jsdom has no Web Animations: svelte's transitions need a stand-in.
const proto = Element.prototype as unknown as Record<string, unknown>;
proto.getAnimations ??= () => [];
proto.animate ??= function () {
  const a = { cancel() {}, finish() {}, onfinish: null as null | (() => void), currentTime: 0, playState: 'finished' };
  queueMicrotask(() => a.onfinish?.());
  return a;
};

let target: HTMLElement;
let cmp: Record<string, unknown> | null = null;

function render(C: unknown, props: Record<string, unknown>) {
  target = document.createElement('div');
  document.body.appendChild(target);
  cmp = mount(C as never, { target, props } as never) as Record<string, unknown>;
  flushSync();
}

afterEach(() => {
  if (cmp) unmount(cmp);
  cmp = null;
  target?.remove();
  remoteActivity.reset();
  toasts.clear();
  setReduceMotion(false);
});

describe('SyncDot', () => {
  it('breathes while syncing and rings once per remote change after mount', () => {
    remoteActivity.bump('v1'); // before mount: no ring
    render(SyncDot, { state: 'syncing', vaultID: 'v1' });
    expect(target.querySelector('.dot-syncing')).not.toBeNull();
    expect(target.querySelector('[data-testid="sync-ping"]')).toBeNull();
    remoteActivity.bump('v2'); // another book
    flushSync();
    expect(target.querySelector('[data-testid="sync-ping"]')).toBeNull();
    remoteActivity.bump('v1');
    flushSync();
    const first = target.querySelector('[data-testid="sync-ping"]');
    expect(first).not.toBeNull();
    remoteActivity.bump('v1');
    flushSync();
    // A fresh element, so the one-shot animation replays.
    expect(target.querySelector('[data-testid="sync-ping"]')).not.toBe(first);
  });
});

describe('ToastStack', () => {
  it('renders the stack in a polite live region; click dismisses', () => {
    setReduceMotion(true); // instant transitions in jsdom
    render(ToastStack, {});
    toasts.push('one');
    toasts.push('two', 'warn');
    flushSync();
    const region = target.querySelector('[data-testid="toast-stack"]')!;
    expect(region.getAttribute('aria-live')).toBe('polite');
    const items = Array.from(target.querySelectorAll<HTMLElement>('[data-testid="toast"]'));
    expect(items.map((x) => x.textContent)).toEqual(['one', 'two']);
    expect(items[1].classList.contains('warn')).toBe(true);
    items[0].click();
    flushSync();
    expect(toasts.list.map((t) => t.text)).toEqual(['two']);
  });
});

describe('ModePill', () => {
  it('one element carries the mode; the label swaps in place', () => {
    setReduceMotion(true);
    render(ModePill, { mode: 'normal', label: 'Normal' });
    const pill = target.querySelector<HTMLElement>('[data-testid="vim-mode"]')!;
    expect(pill.dataset.mode).toBe('normal');
    expect(pill.textContent?.trim()).toBe('Normal');
  });
});
