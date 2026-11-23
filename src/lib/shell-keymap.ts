// Yazi-style keymap for the book shell (explorer + reader).
//
// Mirrors the Apple client's ShellKeymap (LumiKit/Explorer) so the two
// clients share one muscle memory: j/k/h/l, gg/G, ⌃d/⌃u, counts (5j),
// H/L folder history, / filter with n/N, a/r/d/y/p file ops, `.`
// hidden, zp preview, R refresh, i/e edit, q/Esc back, space/: palette,
// ? help, [ ] books, g1–g9 / ⌃⌘1–9 books, gb book picker, gh/zh/~ root.
//
// Pure and DOM-free: the view feeds keydowns, gets an action back and
// renders `pending` (count / chord prefix) in the command legend. The
// note editor is NOT routed through here — it owns its keys (vim).

import { isMac } from './shortcuts.ts';

export type ShellAction =
  | { kind: 'move'; n: number }
  | { kind: 'halfPage'; dir: 1 | -1 }
  | { kind: 'page'; dir: 1 | -1 }
  | { kind: 'top' }
  | { kind: 'bottom' }
  | { kind: 'parent' }
  | { kind: 'open' }
  | { kind: 'historyBack' }
  | { kind: 'historyForward' }
  | { kind: 'home' }
  | { kind: 'filter' }
  | { kind: 'nextMatch' }
  | { kind: 'prevMatch' }
  | { kind: 'clearOrBack' }
  | { kind: 'create' }
  | { kind: 'rename' }
  | { kind: 'delete' }
  | { kind: 'yank' }
  | { kind: 'paste' }
  | { kind: 'toggleHidden' }
  | { kind: 'togglePreview' }
  | { kind: 'refresh' }
  | { kind: 'edit' }
  | { kind: 'palette' }
  | { kind: 'command' }
  | { kind: 'help' }
  | { kind: 'settings' }
  | { kind: 'book'; n: number }
  | { kind: 'picker' }
  | { kind: 'prevBook' }
  | { kind: 'nextBook' }
  | { kind: 'close' }
  | { kind: 'hints' }
  | { kind: 'menu' }
  /** First key of a chord (`g`, `z`) or a count digit: consumed. */
  | { kind: 'pending' };

export type ShellContext = 'explorer' | 'reader';

export type KeyLike = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey'> & { shiftKey?: boolean };

/** ms a `g`/`z` prefix stays armed (Apple: 0.8 s). */
export const CHORD_TIMEOUT_MS = 800;
export const MAX_COUNT = 9999;

export class ShellKeymap {
  private prefix: 'g' | 'z' | null = null;
  private prefixAt = 0;
  private count: number | null = null;

  constructor(private now: () => number = Date.now) {}

  /** What the legend should show as typed-but-unfinished input. */
  get pending(): string | null {
    if (this.prefix && this.now() - this.prefixAt >= CHORD_TIMEOUT_MS) this.prefix = null;
    const c = this.count != null ? String(this.count) : '';
    const p = this.prefix ?? '';
    return c || p ? c + p : null;
  }

  /** The armed chord prefix (legend context), ignoring counts. */
  get chord(): 'g' | 'z' | null {
    return this.pending != null ? this.prefix : null;
  }

  reset(): void {
    this.prefix = null;
    this.count = null;
  }

  /** Returns null when the key is not bound in `context` (the caller
   *  lets it through to the browser). */
  feed(e: KeyLike, context: ShellContext, mac = isMac()): ShellAction | null {
    // ⌃⌘1–9 (macOS) switch books.
    if (mac && e.ctrlKey && e.metaKey && !e.altKey && /^[1-9]$/.test(e.key)) {
      this.reset();
      return { kind: 'book', n: Number(e.key) };
    }
    // Command/Option-modified keys belong to the browser / app chrome.
    if (e.metaKey || e.altKey) {
      this.reset();
      return null;
    }
    if (e.ctrlKey) {
      this.reset();
      switch (e.key.toLowerCase()) {
        case 'd': return { kind: 'halfPage', dir: 1 };
        case 'u': return { kind: 'halfPage', dir: -1 };
        case 'n': return { kind: 'move', n: 1 };
        case 'p': return { kind: 'move', n: -1 };
        // ⌃f/⌃b stay with the browser (find / back) — PageDown/Up instead.
        default: return null;
      }
    }

    switch (e.key) {
      case 'ArrowDown': return { kind: 'move', n: this.takeCount() };
      case 'ArrowUp': return { kind: 'move', n: -this.takeCount() };
      case 'ArrowLeft':
      case 'Backspace': this.reset(); return { kind: 'parent' };
      case 'ArrowRight':
      case 'Enter': this.reset(); return { kind: 'open' };
      case 'Escape': this.reset(); return { kind: 'clearOrBack' };
      case 'PageDown': this.reset(); return { kind: 'page', dir: 1 };
      case 'PageUp': this.reset(); return { kind: 'page', dir: -1 };
      case 'Home': this.reset(); return { kind: 'top' };
      case 'End': this.reset(); return { kind: 'bottom' };
      case 'ContextMenu': this.reset(); return { kind: 'menu' };
      case 'F10': if (e.shiftKey) { this.reset(); return { kind: 'menu' }; } return null;
    }
    const ch = e.key;
    if (ch.length !== 1) return null;

    // Second key of a chord.
    if (this.prefix) {
      const p = this.prefix;
      const armed = this.now() - this.prefixAt < CHORD_TIMEOUT_MS;
      this.prefix = null;
      if (armed) {
        if (p === 'g') {
          if (/^[1-9]$/.test(ch)) { this.count = null; return { kind: 'book', n: Number(ch) }; }
          if (ch === 'g') { this.count = null; return { kind: 'top' }; }
          if (ch === 'h') { this.count = null; return { kind: 'home' }; }
          if (ch === 'e') { this.count = null; return { kind: 'bottom' }; }
          if (ch === 'b') { this.count = null; return { kind: 'picker' }; }
        } else {
          if (ch === 'h') { this.count = null; return { kind: 'home' }; }
          if (ch === 'p') { this.count = null; return { kind: 'togglePreview' }; }
        }
      }
      // Unknown second key: fall through and treat it on its own.
    }

    // Count prefix (no digit is bound on its own; `0` only extends).
    if (/^[0-9]$/.test(ch) && (ch !== '0' || this.count != null)) {
      this.count = Math.min(MAX_COUNT, (this.count ?? 0) * 10 + Number(ch));
      return { kind: 'pending' };
    }

    switch (ch) {
      case 'g':
      case 'z':
        this.prefix = ch;
        this.prefixAt = this.now();
        return { kind: 'pending' };
      case 'j': return { kind: 'move', n: this.takeCount() };
      case 'k': return { kind: 'move', n: -this.takeCount() };
      case 'G': this.count = null; return { kind: 'bottom' };
      case 'h':
      case '-': this.count = null; return { kind: 'parent' };
      case 'l': this.count = null; return { kind: 'open' };
      case 'H': this.count = null; return { kind: 'historyBack' };
      case 'L': this.count = null; return { kind: 'historyForward' };
      case '~': this.count = null; return { kind: 'home' };
      case ':': this.count = null; return { kind: 'command' };
      case ' ': this.count = null; return { kind: 'palette' };
      case '?': this.count = null; return { kind: 'help' };
      case ',': this.count = null; return { kind: 'settings' };
      case '[': this.count = null; return { kind: 'prevBook' };
      case ']': this.count = null; return { kind: 'nextBook' };
      case 'i':
      case 'e': this.count = null; return { kind: 'edit' };
      case 'R': this.count = null; return { kind: 'refresh' };
      // Hint mode (Vimium): F everywhere, f in the explorer (the
      // reader keeps f = page down, less-style).
      case 'F': this.count = null; return { kind: 'hints' };
    }

    this.count = null;
    if (context === 'explorer') {
      switch (ch) {
        case '/': return { kind: 'filter' };
        case 'n': return { kind: 'nextMatch' };
        case 'N': return { kind: 'prevMatch' };
        case 'a': return { kind: 'create' };
        case 'r': return { kind: 'rename' };
        case 'd': return { kind: 'delete' };
        case 'y': return { kind: 'yank' };
        case 'p': return { kind: 'paste' };
        case '.': return { kind: 'toggleHidden' };
        case 'f': return { kind: 'hints' };
        case 'q': return { kind: 'clearOrBack' };
        default: return null;
      }
    }
    switch (ch) {
      case 'q': return { kind: 'close' };
      case 'r': return { kind: 'rename' };
      case 'd': return { kind: 'halfPage', dir: 1 };
      case 'u': return { kind: 'halfPage', dir: -1 };
      case 'f': return { kind: 'page', dir: 1 };
      case 'b': return { kind: 'page', dir: -1 };
      case 'y': return { kind: 'yank' };
      default: return null;
    }
  }

  private takeCount(): number {
    const n = Math.max(1, this.count ?? 1);
    this.count = null;
    return n;
  }
}
