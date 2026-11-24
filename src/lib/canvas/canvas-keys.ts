// Canvas keyboard model (SPEC-PARTE2 §6), pure and DOM-free.
//
//   Tab / S-Tab     next / previous node (reading order)
//   Enter           edit text node / group label, open file or link node
//   gf              open file node        C-w f   open it in a split
//   h j k l, arrows pan                   H J K L  move the selected node (S-arrows too)
//   + = zi ⌘+       zoom in               _ zo ⌘-  zoom out
//   0 zf            fit                   a        new text node
//   -               not owned: the shell opens the explorer (SPEC-PARTE2 §5b)
//   f               new file node (note picker)
//   d, Backspace, Delete  delete selection
//   c 1..6 / c 0    color / clear color   (Enter on a selected edge edits its label)
//   u / C-r         undo / redo           Esc      clear selection

export type CanvasKeyAction =
  | { kind: 'cycle'; dir: 1 | -1 }
  | { kind: 'activate' }
  | { kind: 'openFile'; split: boolean }
  | { kind: 'pan'; dx: number; dy: number }
  | { kind: 'nudge'; dx: number; dy: number }
  | { kind: 'zoom'; factor: number }
  | { kind: 'fit' }
  | { kind: 'addText' }
  | { kind: 'addFile' }
  | { kind: 'delete' }
  | { kind: 'color'; color: string | null }
  | { kind: 'undo' }
  | { kind: 'redo' }
  | { kind: 'escape' };

export interface CanvasKeyLike {
  key: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
}

export const PAN_STEP = 80;
export const NUDGE_STEP = 20;

export class CanvasKeys {
  pending: string | null = null;

  private zoomed(factor: number): CanvasKeyAction {
    this.pending = null;
    return { kind: 'zoom', factor };
  }

  reset(): void {
    this.pending = null;
  }

  /** `hasSelection`: a node or edge is selected. `reading` (SPEC-PARTE2
   *  §5a): only navigation (cycle, open, pan, zoom, fit, Esc) — the keys
   *  that would change the canvas are not owned (they reach the shell). */
  feed(e: CanvasKeyLike, hasSelection: boolean, reading = false): CanvasKeyAction | null {
    const a = this.feedAny(e, hasSelection);
    if (!reading || !a) return a;
    switch (a.kind) {
      case 'cycle':
      case 'activate':
      case 'openFile':
      case 'pan':
      case 'zoom':
      case 'fit':
      case 'escape':
        return a;
      default:
        this.pending = null;
        return null;
    }
  }

  private feedAny(e: CanvasKeyLike, hasSelection: boolean): CanvasKeyAction | null {
    const k = e.key;
    // ⌘/Ctrl-+ and ⌘/Ctrl-- zoom the canvas (the view prevents the
    // browser's page zoom). Anything else with ⌘/Alt is not ours.
    if ((e.metaKey || e.ctrlKey) && !e.altKey) {
      if (k === '+' || k === '=') return this.zoomed(1.2);
      if (k === '-' || k === '_') return this.zoomed(1 / 1.2);
    }
    if (e.metaKey || e.altKey) return null;
    const p = this.pending;
    this.pending = null;

    if (p === 'C-w') return k === 'f' || k === 'Enter' ? { kind: 'openFile', split: true } : null;
    if (p === 'g') return k === 'f' ? { kind: 'openFile', split: false } : null;
    if (p === 'z') {
      if (k === 'i') return { kind: 'zoom', factor: 1.2 };
      if (k === 'o') return { kind: 'zoom', factor: 1 / 1.2 };
      if (k === 'f') return { kind: 'fit' };
      return null;
    }
    if (p === 'c') {
      if (/^[1-6]$/.test(k)) return { kind: 'color', color: k };
      if (k === '0') return { kind: 'color', color: null };
      return null;
    }

    if (e.ctrlKey) {
      if (k === 'w') {
        this.pending = 'C-w';
        return null;
      }
      if (k === 'r') return { kind: 'redo' };
      return null;
    }

    // Panning moves the view: content shifts opposite to the key (`|| 0` avoids -0).
    const pan = (dx: number, dy: number): CanvasKeyAction => ({ kind: 'pan', dx: -dx * PAN_STEP || 0, dy: -dy * PAN_STEP || 0 });
    const nudge = (dx: number, dy: number): CanvasKeyAction =>
      hasSelection ? { kind: 'nudge', dx: dx * NUDGE_STEP, dy: dy * NUDGE_STEP } : pan(dx, dy);

    switch (k) {
      case 'Tab':
        return { kind: 'cycle', dir: e.shiftKey ? -1 : 1 };
      case 'Enter':
        return hasSelection ? { kind: 'activate' } : null;
      case 'g':
        this.pending = 'g';
        return null;
      case 'z':
        this.pending = 'z';
        return null;
      case 'c':
        if (!hasSelection) return null;
        this.pending = 'c';
        return null;
      case 'h':
        return pan(-1, 0);
      case 'l':
        return pan(1, 0);
      case 'j':
        return pan(0, 1);
      case 'k':
        return pan(0, -1);
      case 'ArrowLeft':
        return e.shiftKey ? nudge(-1, 0) : pan(-1, 0);
      case 'ArrowRight':
        return e.shiftKey ? nudge(1, 0) : pan(1, 0);
      case 'ArrowDown':
        return e.shiftKey ? nudge(0, 1) : pan(0, 1);
      case 'ArrowUp':
        return e.shiftKey ? nudge(0, -1) : pan(0, -1);
      case 'H':
        return hasSelection ? nudge(-1, 0) : null;
      case 'L':
        return hasSelection ? nudge(1, 0) : null;
      case 'J':
        return hasSelection ? nudge(0, 1) : null;
      case 'K':
        return hasSelection ? nudge(0, -1) : null;
      case '+':
      case '=':
        return { kind: 'zoom', factor: 1.2 };
      // `-` is deliberately absent: it always opens the explorer.
      case '_':
        return { kind: 'zoom', factor: 1 / 1.2 };
      case '0':
        return { kind: 'fit' };
      case 'a':
        return { kind: 'addText' };
      case 'f':
        return { kind: 'addFile' };
      case 'd':
      case 'x':
      case 'Backspace':
      case 'Delete':
        return hasSelection ? { kind: 'delete' } : null;
      case 'u':
        return { kind: 'undo' };
      case 'Escape':
        return { kind: 'escape' };
    }
    return null;
  }
}
