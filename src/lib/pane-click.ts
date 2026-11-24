// Click-to-focus for split panes (SPEC-PARTE2 §3): the first click or
// tap anywhere in a pane focuses it AND performs the click.
//
// Two halves, both passive (never preventDefault, never stopPropagation,
// so the click itself always lands):
//  1. capture-phase pointerdown on the note area marks the pane under
//     the pointer active at once, before any inner handler runs (canvas
//     pan, kanban drag and CodeMirror all handle pointerdown themselves,
//     some stop it from bubbling);
//  2. after the click settles (next frame), if keyboard focus did not
//     land inside that pane — the click hit a non-focusable header, the
//     wrapper of an editing pane, or an element that re-rendered and
//     dropped focus to <body> — the pane's own focus target takes it, so
//     the next key goes to the pane that was clicked.

export interface PaneClickOptions {
  /** The pane under the pointer becomes the active pane (state only). */
  activate(leaf: string): void;
  /** Give keyboard focus to the pane's focus target (reader / editor). */
  focus(leaf: string): void;
  /** Schedules the settle check (tests pass a synchronous one). */
  defer?: (fn: () => void) => void;
}

const LEAF = '[data-leaf]';

/** The element that should keep focus after a click inside `leafEl`:
 *  true when focus is already somewhere meaningful in that pane. */
export function focusLanded(leafEl: Element, active: Element | null): boolean {
  if (!active || active === document.body) return false;
  if (!leafEl.contains(active)) return false;
  // The pane wrapper itself (tabindex=-1) is not a focus target when the
  // pane holds an editor or a scroller: let the pane pick.
  return active !== leafEl;
}

export function installPaneClickFocus(root: HTMLElement, o: PaneClickOptions): () => void {
  const defer = o.defer ?? ((fn: () => void) => requestAnimationFrame(() => requestAnimationFrame(fn)));
  let armed: { leaf: string; el: Element } | null = null;

  const down = (e: PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const el = e.target instanceof Element ? e.target.closest(LEAF) : null;
    const leaf = (el as HTMLElement | null)?.dataset.leaf;
    if (!el || !leaf) {
      armed = null;
      return;
    }
    armed = { leaf, el };
    o.activate(leaf);
  };
  const settle = () => {
    const a = armed;
    armed = null;
    if (!a) return;
    defer(() => {
      // The pane may have re-rendered: look it up again by id.
      const el = [...root.querySelectorAll<HTMLElement>(LEAF)].find((x) => x.dataset.leaf === a.leaf) ?? a.el;
      if (!el.isConnected) return;
      // Text selection in progress: leave focus alone.
      const sel = typeof getSelection === 'function' ? getSelection() : null;
      if (sel && !sel.isCollapsed && el.contains(sel.anchorNode)) return;
      if (focusLanded(el, document.activeElement)) return;
      o.focus(a.leaf);
    });
  };
  root.addEventListener('pointerdown', down, true);
  root.addEventListener('pointerup', settle, true);
  root.addEventListener('pointercancel', settle, true);
  return () => {
    root.removeEventListener('pointerdown', down, true);
    root.removeEventListener('pointerup', settle, true);
    root.removeEventListener('pointercancel', settle, true);
  };
}
