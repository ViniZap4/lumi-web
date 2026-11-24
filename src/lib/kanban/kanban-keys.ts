// Board keyboard model (SPEC-PARTE2 §5), pure and DOM-free.
//
// The view feeds key events plus the visible shape of the board (cards
// per lane, after filtering) and gets an action back. Indices are in
// the visible space; the view maps them to real cards.
//
//   h/l ←/→   previous/next column      j/k ↓/↑  next/previous card
//   gg / G    first / last card         H/L      move card to prev/next column
//   J/K       move card down/up         a        new card at end of column
//   o / O     new card below / above    A        new column
//   Enter / i edit card inline          x        toggle done
//   dd        delete card (confirm)     /        filter
//   r         rename column             < / >    move column left/right
//   u / C-r   undo / redo               Esc      clear pending / filter

export interface KanbanCursor {
  lane: number;
  /** -1 when the lane has no (visible) cards. */
  card: number;
}

export type KanbanKeyAction =
  | { kind: 'cursor'; cursor: KanbanCursor }
  | { kind: 'moveCard'; toLane: number; toIndex: number }
  | { kind: 'newCard'; lane: number; index: number }
  | { kind: 'newLane' }
  | { kind: 'edit' }
  | { kind: 'toggle' }
  | { kind: 'delete' }
  | { kind: 'filter' }
  | { kind: 'rename' }
  | { kind: 'moveLane'; toIndex: number }
  | { kind: 'undo' }
  | { kind: 'redo' }
  | { kind: 'escape' };

export interface KeyLike {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
}

export function clampCursor(c: KanbanCursor, shape: readonly number[]): KanbanCursor {
  if (!shape.length) return { lane: 0, card: -1 };
  const lane = Math.max(0, Math.min(c.lane, shape.length - 1));
  const n = shape[lane];
  return { lane, card: n === 0 ? -1 : Math.max(0, Math.min(c.card < 0 ? 0 : c.card, n - 1)) };
}

export class KanbanKeys {
  /** Pending prefix (`d`, `g`) or null. */
  pending: string | null = null;

  reset(): void {
    this.pending = null;
  }

  feed(e: KeyLike, cursor: KanbanCursor, shape: readonly number[]): KanbanKeyAction | null {
    if (e.metaKey || e.altKey) return null;
    const cur = clampCursor(cursor, shape);
    const lanes = shape.length;
    const n = lanes ? shape[cur.lane] : 0;
    const k = e.key;

    if (e.ctrlKey) {
      this.pending = null;
      return k === 'r' ? { kind: 'redo' } : null;
    }

    const p = this.pending;
    this.pending = null;
    if (p === 'd') return k === 'd' && cur.card >= 0 ? { kind: 'delete' } : null;
    if (p === 'g') return k === 'g' && n ? { kind: 'cursor', cursor: { lane: cur.lane, card: 0 } } : null;

    switch (k) {
      case 'h':
      case 'ArrowLeft':
        return lanes ? { kind: 'cursor', cursor: clampCursor({ lane: cur.lane - 1, card: cur.card }, shape) } : null;
      case 'l':
      case 'ArrowRight':
        return lanes ? { kind: 'cursor', cursor: clampCursor({ lane: cur.lane + 1, card: cur.card }, shape) } : null;
      case 'j':
      case 'ArrowDown':
        return n ? { kind: 'cursor', cursor: { lane: cur.lane, card: Math.min(n - 1, cur.card + 1) } } : null;
      case 'k':
      case 'ArrowUp':
        return n ? { kind: 'cursor', cursor: { lane: cur.lane, card: Math.max(0, cur.card - 1) } } : null;
      case 'G':
        return n ? { kind: 'cursor', cursor: { lane: cur.lane, card: n - 1 } } : null;
      case 'g':
        this.pending = 'g';
        return null;
      case 'H':
        if (cur.card < 0 || cur.lane === 0) return null;
        return { kind: 'moveCard', toLane: cur.lane - 1, toIndex: Math.min(cur.card, shape[cur.lane - 1]) };
      case 'L':
        if (cur.card < 0 || cur.lane >= lanes - 1) return null;
        return { kind: 'moveCard', toLane: cur.lane + 1, toIndex: Math.min(cur.card, shape[cur.lane + 1]) };
      case 'J':
        if (cur.card < 0 || cur.card >= n - 1) return null;
        return { kind: 'moveCard', toLane: cur.lane, toIndex: cur.card + 1 };
      case 'K':
        if (cur.card <= 0) return null;
        return { kind: 'moveCard', toLane: cur.lane, toIndex: cur.card - 1 };
      case 'a':
        return lanes ? { kind: 'newCard', lane: cur.lane, index: n } : { kind: 'newLane' };
      case 'o':
        return lanes ? { kind: 'newCard', lane: cur.lane, index: cur.card < 0 ? 0 : cur.card + 1 } : { kind: 'newLane' };
      case 'O':
        return lanes ? { kind: 'newCard', lane: cur.lane, index: Math.max(0, cur.card) } : { kind: 'newLane' };
      case 'A':
        return { kind: 'newLane' };
      case 'Enter':
      case 'i':
        return cur.card >= 0 ? { kind: 'edit' } : null;
      case 'x':
        return cur.card >= 0 ? { kind: 'toggle' } : null;
      case 'd':
        if (cur.card < 0) return null;
        this.pending = 'd';
        return null;
      case '/':
        return { kind: 'filter' };
      case 'r':
        return lanes ? { kind: 'rename' } : null;
      case '<':
        return cur.lane > 0 ? { kind: 'moveLane', toIndex: cur.lane - 1 } : null;
      case '>':
        return cur.lane < lanes - 1 ? { kind: 'moveLane', toIndex: cur.lane + 1 } : null;
      case 'u':
        return { kind: 'undo' };
      case 'Escape':
        return { kind: 'escape' };
    }
    return null;
  }
}
