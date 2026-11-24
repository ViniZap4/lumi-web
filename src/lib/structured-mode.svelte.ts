// Reading | Edit | Source for structured notes (SPEC-PARTE2 §5a).
//
// Kanban boards and JSON canvases open in Reading: navigate, pan/zoom,
// follow links, but nothing changes by accident. Edit is the interactive
// board / canvas. Source is the vim editor (the host's `onsource`).
//
//   Reading → Edit     i / e, ⌘/Ctrl-E, the switch
//   Edit → Reading     Esc / q with nothing selected or pending, ⌘/Ctrl-E, the switch
//
// `structuredFocus` tells the shell (legend, palette) which structured
// view has the keyboard and lets it switch that view's mode.

export type StructuredMode = 'read' | 'edit';
export type StructuredKind = 'canvas' | 'kanban';

export const MODE_LABEL: Record<StructuredMode, string> = { read: 'Reading', edit: 'Edit' };

/** Mode a structured note opens in: Reading unless the user set
 *  "open notes in: editing". */
export function initialStructuredMode(openIn: string | null | undefined): StructuredMode {
  return openIn === 'editing' ? 'edit' : 'read';
}

export interface ModeKeyLike {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}

/**
 * The mode a key switches to, or null when the key is not a mode key.
 * `idle`: nothing selected, no pending chord, no inline editor, no
 * filter — only then do Esc / q leave Edit (otherwise they clear that
 * state first, as before).
 */
export function modeKey(e: ModeKeyLike, mode: StructuredMode, idle: boolean): StructuredMode | null {
  if (e.altKey) return null;
  if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'e') return mode === 'read' ? 'edit' : 'read';
  if (e.metaKey || e.ctrlKey) return null;
  if (mode === 'read') return e.key === 'i' || e.key === 'e' ? 'edit' : null;
  return idle && (e.key === 'Escape' || e.key === 'q') ? 'read' : null;
}

export interface StructuredTarget {
  kind: StructuredKind;
  mode: StructuredMode;
  set: (m: StructuredMode) => void;
  source?: () => void;
}

/** The structured view that has the keyboard (`current`, legend) and
 *  the one that had it last and is still mounted (`last`, palette: the
 *  palette input takes focus before its command runs). */
class StructuredFocus {
  current = $state<StructuredTarget | null>(null);
  last = $state<StructuredTarget | null>(null);
  private owner: object | null = null;
  private lastOwner: object | null = null;

  claim(owner: object, v: StructuredTarget): void {
    this.owner = owner;
    this.lastOwner = owner;
    this.current = v;
    this.last = v;
  }

  /** Focus left the view (it stays the palette's target). */
  blur(owner: object): void {
    if (this.owner !== owner) return;
    this.owner = null;
    this.current = null;
  }

  /** The view unmounted. */
  release(owner: object): void {
    this.blur(owner);
    if (this.lastOwner !== owner) return;
    this.lastOwner = null;
    this.last = null;
  }
}

export const structuredFocus = new StructuredFocus();
