// Keyboard focus for a note pane whose content may be a structured view
// (JSON canvas, kanban board).
//
// The shell focuses the pane's reader after opening a note (once the
// view transition finished) and when a pane becomes active. For a
// markdown note the reader IS the keyboard surface; for a canvas or a
// board it is only the wrapper, and the view's own element (which takes
// focus when it mounts) owns the keys. Focusing the wrapper there stole
// focus from the canvas right after an in-app open, so hjkl / + / - / a
// went to the shell and the canvas looked frozen until a click or a
// reload (where no transition runs after the mount).

/** The element of a structured view that owns the keyboard inside `root`. */
export const STRUCTURED_FOCUS_SELECTOR = '[data-testid="canvas-view"], [data-testid="kanban-board"]';

/** Where keyboard focus should go inside a pane root. */
export function paneFocusTarget(root: HTMLElement | null): HTMLElement | null {
  if (!root) return null;
  return root.querySelector<HTMLElement>(STRUCTURED_FOCUS_SELECTOR) ?? root;
}

/**
 * Focus a pane: keep focus that is already inside one of its views (a
 * mounted canvas / board, or an editor inside the pane), otherwise move
 * it to the view's own element, or the reader for markdown.
 */
export function focusPane(root: HTMLElement | null, doc: Document | null = typeof document !== 'undefined' ? document : null): void {
  if (!root) return;
  const active = doc?.activeElement ?? null;
  if (active && active !== root && root.contains(active) && active.closest(STRUCTURED_FOCUS_SELECTOR)) return;
  paneFocusTarget(root)?.focus({ preventScroll: true });
}
