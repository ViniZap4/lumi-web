// A component loaded on first use. Reading `current` starts the import
// (once) and is reactive: it is null until the chunk arrives, then the
// component. `preload()` starts the import without rendering anything,
// e.g. when the browser is idle after the first paint.

export interface LazyComponent<T> {
  readonly current: T | null;
  preload(): Promise<T>;
}

export function lazyComponent<T>(load: () => Promise<{ default: T }>): LazyComponent<T> {
  let comp = $state.raw<T | null>(null);
  let pending: Promise<T> | null = null;
  const start = (): Promise<T> =>
    (pending ??= load().then(
      (m) => (comp = m.default),
      (e) => {
        // A failed chunk (offline, deploy in between) can be retried.
        pending = null;
        throw e;
      },
    ));
  return {
    get current() {
      if (!comp) void start().catch(() => {});
      return comp;
    },
    preload: start,
  };
}

/** Run `fn` when the browser is idle (or soon, where idle callbacks
 *  are missing). Returns a cancel function. */
export function whenIdle(fn: () => void, timeout = 2000): () => void {
  const w = typeof window !== 'undefined' ? (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void }) : null;
  if (w?.requestIdleCallback) {
    const id = w.requestIdleCallback(fn, { timeout });
    return () => w.cancelIdleCallback?.(id);
  }
  const t = setTimeout(fn, 200);
  return () => clearTimeout(t);
}
