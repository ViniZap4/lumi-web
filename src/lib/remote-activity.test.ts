import { describe, it, expect, vi, afterEach } from 'vitest';
import { remoteActivity } from './remote-activity.svelte.ts';
import { toasts, MAX_TOASTS } from './toasts.svelte.ts';

afterEach(() => {
  remoteActivity.reset();
  toasts.clear();
  vi.useRealTimers();
});

describe('remoteActivity', () => {
  it('counts per book; unknown / empty ids are ignored', () => {
    expect(remoteActivity.tick('v1')).toBe(0);
    remoteActivity.bump('v1');
    remoteActivity.bump('v1');
    remoteActivity.bump('v2');
    remoteActivity.bump(null);
    expect(remoteActivity.tick('v1')).toBe(2);
    expect(remoteActivity.tick('v2')).toBe(1);
    expect(remoteActivity.tick(null)).toBe(0);
  });
});

describe('toasts', () => {
  it('stacks at most MAX_TOASTS, the oldest leaving first', () => {
    for (let i = 1; i <= 5; i++) toasts.push(`t${i}`);
    expect(toasts.list.map((t) => t.text)).toEqual(['t3', 't4', 't5']);
    expect(toasts.list).toHaveLength(MAX_TOASTS);
  });
  it('auto-dismisses per tone, dismiss removes, a repeat renews instead of stacking', () => {
    vi.useFakeTimers();
    toasts.push('saved', 'info', 1000);
    const err = toasts.push('boom', 'error', 3000);
    vi.advanceTimersByTime(900);
    toasts.push('boom', 'error', 3000); // same as newest: renewed
    expect(toasts.list).toHaveLength(2);
    vi.advanceTimersByTime(200);
    expect(toasts.list.map((t) => t.text)).toEqual(['boom']);
    vi.advanceTimersByTime(2700);
    expect(toasts.list).toHaveLength(1); // renewed at 900 → lives to 3900
    toasts.dismiss(err);
    expect(toasts.list).toEqual([]);
  });
});
