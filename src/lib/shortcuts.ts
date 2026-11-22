// Book shortcuts (SPEC-LIVROS §5): `g1`–`g9` open the n-th book of the
// selector, `gb` opens the selector, `gg` keeps meaning "top". On macOS
// ⌃⌘1–9 also switch books (no conflict with tab switching, which is
// ⌘1–9). Only in non-editable contexts — callers check
// `isEditableTarget` first.

export const CHORD_MS = 500;

export type ChordAction =
  | { kind: 'book'; n: number }
  | { kind: 'picker' }
  | { kind: 'top' }
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
  try {
    const p = (navigator as any).userAgentData?.platform ?? navigator.platform ?? '';
    return /mac/i.test(p);
  } catch {
    return false;
  }
}

/** Stateful `g` chord reader. Feed every keydown that reached the
 *  view's non-editable handler; a non-null result means "handled". */
export class GChord {
  private lastG: number | null = null;
  constructor(private now: () => number = Date.now) {}

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
      if (/^[1-9]$/.test(e.key)) return { kind: 'book', n: Number(e.key) };
      if (e.key === 'b') return { kind: 'picker' };
      if (e.key === 'g') return { kind: 'top' };
      return null;
    }
    if (e.key === 'g') {
      this.lastG = this.now();
      return { kind: 'pending' };
    }
    this.lastG = null;
    return null;
  }
}
