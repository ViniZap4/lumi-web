// Book shortcuts (SPEC-LIVROS §5): `g1`–`g9` open the n-th book of the
// selector, `gb` opens the selector, `gg` keeps meaning "top". On macOS
// ⌃⌘1–9 also switch books (no conflict with tab switching, which is
// ⌘1–9). Only in non-editable contexts — callers check
// `isEditableTarget` first.
//
// Navigation chords (wave 3, opt-in via `{ nav: true }`, mirroring the
// TUI tree's g/z prefixes): `gh` and `zh` jump to the book root
// ("home"), `zp` toggles the preview column. Unknown second keys cancel
// the prefix and are NOT consumed, so `g` then `j` still moves down.

import { detectPlatform, isApple } from './platform.ts';

export const CHORD_MS = 500;

export type ChordAction =
  | { kind: 'book'; n: number }
  | { kind: 'picker' }
  | { kind: 'top' }
  | { kind: 'home' }
  | { kind: 'preview' }
  | { kind: 'pending' }
  | null;

/** Text-entry targets own their keystrokes (CodeMirror's content node
 *  is a contenteditable <div>, not an INPUT/TEXTAREA). */
export function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el !== 'object') return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (el.isContentEditable) return true;
  // jsdom (and some detached nodes) lack isContentEditable.
  return typeof el.closest === 'function' &&
    el.closest('[contenteditable]:not([contenteditable="false"])') != null;
}

export function isMac(): boolean {
  return isApple(detectPlatform());
}

/** Stateful `g` chord reader. Feed every keydown that reached the
 *  view's non-editable handler; a non-null result means "handled". */
export class GChord {
  private lastG: number | null = null;
  private prefix: 'g' | 'z' = 'g';
  private readonly nav: boolean;
  constructor(
    private now: () => number = Date.now,
    opts: { nav?: boolean } = {},
  ) {
    this.nav = opts.nav ?? false;
  }

  reset(): void {
    this.lastG = null;
  }

  feed(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey'>, mac = isMac()): ChordAction {
    // ⌃⌘1–9 (macOS only).
    if (mac && e.ctrlKey && e.metaKey && !e.altKey && /^[1-9]$/.test(e.key)) {
      this.lastG = null;
      return { kind: 'book', n: Number(e.key) };
    }
    if (e.ctrlKey || e.metaKey || e.altKey) {
      this.lastG = null;
      return null;
    }
    const armed = this.lastG !== null && this.now() - this.lastG < CHORD_MS;
    if (armed) {
      this.lastG = null;
      if (this.prefix === 'z') {
        if (e.key === 'h') return { kind: 'home' };
        if (e.key === 'p') return { kind: 'preview' };
        return null;
      }
      if (/^[1-9]$/.test(e.key)) return { kind: 'book', n: Number(e.key) };
      if (e.key === 'b') return { kind: 'picker' };
      if (e.key === 'g') return { kind: 'top' };
      if (this.nav && e.key === 'h') return { kind: 'home' };
      return null;
    }
    if (e.key === 'g' || (this.nav && e.key === 'z')) {
      this.lastG = this.now();
      this.prefix = e.key;
      return { kind: 'pending' };
    }
    this.lastG = null;
    return null;
  }
}
