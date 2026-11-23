// Shared vim-ish list keyboard model for modals, popovers and lists:
// j/k (↓/↑) move, gg/G (Home/End) jump, ⌃d/⌃u half page, Enter/l/space
// activate, Esc/q close (h optionally "back"). Pure: callers own the
// cursor and decide what "activate" / "close" mean.
//
// In a text field only the keys that cannot be text (arrows, Home/End
// with no text interplay are skipped, Enter, Esc) are interpreted, so
// typing `j` into a filter still types `j`.

export interface KeyLike {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}

export type ListAction = 'activate' | 'close' | 'back' | null;

export interface ListKeyResult {
  index: number;
  action: ListAction;
}

/** Tiny chord memory for `gg`. One per list. */
export interface ChordState {
  g: number; // timestamp of a pending `g`, 0 = none
}

export function newChord(): ChordState {
  return { g: 0 };
}

export const CHORD_MS = 800;

export interface ListKeyOptions {
  /** The event target is a text input / textarea / contenteditable. */
  isTextTarget?: boolean;
  /** Rows per half page for ⌃d / ⌃u (default 5). */
  halfPage?: number;
  /** Wrap around at the ends (palette style). Default false (clamp). */
  wrap?: boolean;
  /** Chord state for `gg`; without it a single `g` jumps to the top. */
  chord?: ChordState;
  /** Clock override for tests. */
  now?: number;
  /** Treat `h` / ← as 'back' (default false → ignored). */
  hBack?: boolean;
  /** Treat Space as activate (default true). */
  spaceActivates?: boolean;
}

function clamp(i: number, n: number): number {
  return Math.max(0, Math.min(n - 1, i));
}

/**
 * Map a keydown to a cursor move and/or an action. Returns null when
 * the key is not part of the list model (the caller should let it
 * through untouched).
 */
export function listKey(e: KeyLike, index: number, length: number, opts: ListKeyOptions = {}): ListKeyResult | null {
  const n = Math.max(0, length);
  const cur = n ? clamp(index, n) : 0;
  const text = !!opts.isTextTarget;
  const half = Math.max(1, opts.halfPage ?? 5);
  const now = opts.now ?? Date.now();
  const chord = opts.chord;
  const pendingG = chord ? chord.g > 0 && now - chord.g <= CHORD_MS : false;
  if (chord && e.key !== 'g') chord.g = 0;

  // Esc always closes, wherever focus is.
  if (e.key === 'Escape') return { index: cur, action: 'close' };
  if (e.metaKey || e.altKey) return null;

  const step = (d: number): ListKeyResult => {
    if (!n) return { index: 0, action: null };
    let i = cur + d;
    if (opts.wrap) i = ((i % n) + n) % n;
    return { index: clamp(i, n), action: null };
  };

  if (e.ctrlKey) {
    switch (e.key) {
      case 'd': return step(half);
      case 'u': return step(-half);
      case 'n': case 'j': return step(1);
      case 'p': case 'k': return step(-1);
      default: return null;
    }
  }

  switch (e.key) {
    case 'ArrowDown': return step(1);
    case 'ArrowUp': return step(-1);
    case 'Enter': return { index: cur, action: 'activate' };
  }
  if (text) return null;

  switch (e.key) {
    case 'j': return step(1);
    case 'k': return step(-1);
    case 'Home': return { index: 0, action: null };
    case 'End':
    case 'G': return { index: n ? n - 1 : 0, action: null };
    case 'g':
      if (!chord || pendingG) {
        if (chord) chord.g = 0;
        return { index: 0, action: null };
      }
      chord.g = now;
      return { index: cur, action: null };
    case 'l':
    case 'ArrowRight':
      return { index: cur, action: 'activate' };
    case ' ':
      return opts.spaceActivates === false ? null : { index: cur, action: 'activate' };
    case 'q': return { index: cur, action: 'close' };
    case 'h':
    case 'ArrowLeft':
      return opts.hBack ? { index: cur, action: 'back' } : null;
  }
  return null;
}

/** True for inputs that take typed text (not checkboxes / buttons). */
export function isTextTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || typeof el !== 'object' || !('tagName' in el)) return false;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (el.isContentEditable) return true;
  if (tag !== 'INPUT') return false;
  const type = ((el as HTMLInputElement).type || 'text').toLowerCase();
  return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file'].includes(type);
}

/**
 * Remember the focused element; the returned function restores focus
 * to it (if it is still in the document). Call on open, run on close.
 */
export function captureFocus(doc: Document = document): () => void {
  const prev = doc.activeElement as HTMLElement | null;
  return () => {
    if (!prev || prev === doc.body || !prev.isConnected) return;
    try {
      prev.focus({ preventScroll: true });
    } catch {
      /* detached / not focusable */
    }
  };
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.hasAttribute('inert') && el.getAttribute('aria-hidden') !== 'true');
}

/**
 * Keep Tab inside `root` (simple cycle). Returns true when it handled
 * the event. Esc is never trapped — callers close on it.
 */
export function trapTab(e: KeyboardEvent, root: HTMLElement | null): boolean {
  if (e.key !== 'Tab' || !root) return false;
  const els = focusables(root);
  if (!els.length) {
    e.preventDefault();
    root.focus();
    return true;
  }
  const first = els[0];
  const last = els[els.length - 1];
  const a = root.ownerDocument.activeElement;
  if (e.shiftKey && (a === first || a === root || !root.contains(a))) {
    e.preventDefault();
    last.focus();
    return true;
  }
  if (!e.shiftKey && (a === last || !root.contains(a))) {
    e.preventDefault();
    first.focus();
    return true;
  }
  return false;
}

/**
 * Roving-focus list over the elements of `root` matching `selector`
 * (buttons, rows): j/k/gg/G/⌃d/⌃u move DOM focus, Enter/l/space click
 * the focused item, Esc/q call `onclose`. Returns true when the key was
 * consumed (caller should stop propagation).
 */
export function rovingKey(
  e: KeyboardEvent,
  root: HTMLElement | null,
  selector: string,
  onclose: (() => void) | null,
  opts: Omit<ListKeyOptions, 'isTextTarget'> = {},
): boolean {
  if (!root) return false;
  const text = isTextTarget(e.target);
  const items = [...root.querySelectorAll<HTMLElement>(selector)].filter(
    (el) => !(el as HTMLButtonElement).disabled,
  );
  const a = root.ownerDocument.activeElement as HTMLElement | null;
  const at = a ? items.indexOf(a) : -1;
  // Typing in a field: only Esc (and ↑/↓ when not inside a list item).
  if (text && e.key !== 'Escape') return false;
  const r = listKey(e, at < 0 ? -1 : at, items.length, { ...opts, isTextTarget: text });
  if (!r) return false;
  if (r.action === 'close') {
    if (!onclose) return false;
    e.preventDefault();
    onclose();
    return true;
  }
  if (r.action === 'activate') {
    // Native Enter/space on a focused control already clicks it.
    if (at < 0) return false;
    e.preventDefault();
    items[at].click();
    return true;
  }
  if (r.action === 'back') return false;
  e.preventDefault();
  let idx = r.index;
  // From outside the list, the first move lands on the first/last item.
  if (at < 0) {
    const up = e.key === 'k' || e.key === 'ArrowUp' || e.key === 'G' || e.key === 'End' || (e.ctrlKey && (e.key === 'u' || e.key === 'p'));
    idx = up ? items.length - 1 : 0;
  }
  const el = items[Math.max(0, idx)];
  if (el && !(e.key === 'g' && opts.chord && opts.chord.g > 0)) el.focus();
  return true;
}
