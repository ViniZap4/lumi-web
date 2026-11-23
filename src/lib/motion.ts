// Motion policy: one place decides whether the UI animates. Off when
// the OS asks for reduced motion or the user turned on "Reduce motion"
// (settings), which also sets `data-motion="reduce"` on <html> so the
// CSS kill-switch in app.css applies to every transition.

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

/** Element.animate when motion is allowed (GPU: transform/opacity only). */
export function animate(el: Element | null | undefined, frames: Keyframe[], ms = 160): void {
  if (!el || !motionAllowed() || typeof (el as HTMLElement).animate !== 'function') return;
  try {
    (el as HTMLElement).animate(frames, { duration: ms, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)' });
  } catch {
    /* ignore */
  }
}
