// Pane navigation (vim windows / vim-tmux-navigator style).
//
// Ctrl-h/j/k/l move focus to the pane on that side; `Ctrl-w h/j/k/l`,
// `Ctrl-w w` (next, wrapping) and `Ctrl-w p` (previous pane) are the
// vim window commands. Same keymap as the Apple client.
//
// Pure and DOM-free: the view describes what is on screen
// (`paneLayout`), feeds keydowns to `PaneKeys`, and asks `paneTarget`
// where a direction leads. In the note editor `editorPaneRoute` decides
// whether a key is pane navigation (vim NORMAL/VISUAL) or belongs to
// vim (INSERT keeps Ctrl-h = backspace, Ctrl-j = newline; explicit
// .vimrc maps of these keys win).

import type { PlannedMap } from './vim-config.ts';

/** main = the reader of the primary note, editor = CodeMirror,
 *  split = the rendered preview beside Source, leaf = a secondary note
 *  pane of a split layout (lib/pane-tree.ts). The explorer is not a
 *  pane: it floats (SPEC-PARTE2 §2). */
export type PaneId = 'main' | 'editor' | 'split' | 'leaf';
export type PaneDir = 'h' | 'j' | 'k' | 'l' | 'w' | 'p';

export interface PaneLayout {
  /** Visible panes, left → right. */
  order: PaneId[];
  /** Panes stacked vertically / as tabs (narrow split): `[top, bottom]`. */
  stack: [PaneId, PaneId] | null;
}

export interface LayoutInput {
  /** ≤860px: Source | Preview become tabs. */
  splitNarrow: boolean;
  editing: boolean;
  /** Split preview on (Source mode + preview). */
  split: boolean;
  /** A note is open in the reader. */
  mainHasNote: boolean;
}

export function paneLayout(x: LayoutInput): PaneLayout {
  if (x.editing) {
    if (!x.split) return { order: ['editor'], stack: null };
    return x.splitNarrow ? { order: ['editor'], stack: ['editor', 'split'] } : { order: ['editor', 'split'], stack: null };
  }
  return { order: x.mainHasNote ? ['main'] : [], stack: null };
}

/** All panes reachable in the layout (tabs included), in cycle order. */
export function panesOf(l: PaneLayout): PaneId[] {
  const out = [...l.order];
  if (l.stack) for (const p of l.stack) if (!out.includes(p)) out.splice(out.indexOf(l.stack[0]) + 1, 0, p);
  return out;
}

/**
 * Where `dir` leads from `from`, or null (no pane on that side).
 * Horizontal moves do not wrap (vim). In a stack (narrow split tabs)
 * j/k move between the tabs; h from the lower tab also returns to the
 * upper one, so Ctrl-h always leads from the preview back to the
 * editor. `w` cycles with wrap; `p` returns to `prev` when visible.
 */
export function paneTarget(l: PaneLayout, from: PaneId | null, dir: PaneDir, prev: PaneId | null = null): PaneId | null {
  const all = panesOf(l);
  if (all.length === 0) return null;
  const cur = from && all.includes(from) ? from : null;
  if (dir === 'p') return prev && prev !== cur && all.includes(prev) ? prev : null;
  if (dir === 'w') {
    if (!cur) return all[0];
    if (all.length < 2) return null;
    return all[(all.indexOf(cur) + 1) % all.length];
  }
  if (!cur) return all[0];
  const st = l.stack;
  if (st) {
    if (dir === 'j' && cur === st[0]) return st[1];
    if (dir === 'k' && cur === st[1]) return st[0];
    if (dir === 'h' && cur === st[1]) return st[0];
    if (dir === 'l' && cur === st[0]) return st[1];
  }
  if (dir === 'j' || dir === 'k') return null;
  // A stacked pane takes its stack's column for left/right moves.
  const col = st && cur === st[1] ? st[0] : cur;
  const i = l.order.indexOf(col);
  if (i < 0) return null;
  const j = dir === 'h' ? i - 1 : i + 1;
  return j >= 0 && j < l.order.length ? l.order[j] : null;
}

// ---- keys -------------------------------------------------------------------

export type KeyLike = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey'> & { shiftKey?: boolean; code?: string };

/** `Ctrl-w` window commands (SPEC-PARTE2 §3): v/s split, q/c close,
 *  o only, = equalise, f/Enter follow the link under the cursor in a
 *  vertical split, F in a horizontal one, < > + - resize. */
export type WinCmd = 'vsplit' | 'split' | 'close' | 'only' | 'equal' | 'linkV' | 'linkH' | 'wider' | 'narrower' | 'taller' | 'shorter' | 'zoom';

export type PaneKeyResult =
  | { kind: 'nav'; dir: PaneDir; chord: boolean }
  | { kind: 'win'; cmd: WinCmd }
  | { kind: 'pending' }
  | { kind: 'cancel' };

/** Second key of `Ctrl-w` → window command (case matters: f vs F). */
export function winCommand(e: KeyLike): WinCmd | null {
  if (e.key === 'Enter') return 'linkV';
  const ch = e.ctrlKey ? ctrlLetter(e) : e.key;
  switch (ch) {
    case 'v': return 'vsplit';
    case 's':
    case 'S': return 'split';
    case 'q':
    case 'c': return 'close';
    case 'o': return 'only';
    case 'z': return 'zoom';
    case '=': return 'equal';
    case 'f': return 'linkV';
    case 'F': return 'linkH';
    case '>': return 'wider';
    case '<': return 'narrower';
    case '+': return 'taller';
    case '-': return 'shorter';
    default: return null;
  }
}

/** ms a `Ctrl-w` prefix stays armed. */
export const PANE_CHORD_MS = 1500;

export interface PaneKeyOptions {
  /** Ctrl-h/j/k/l move between panes (setting). */
  ctrlHjkl: boolean;
  /** Ctrl-<dir> keys a user .vimrc maps itself (left alone). */
  reserved?: ReadonlySet<string>;
  /** Ctrl-<key> → pane dir aliases from the .vimrc
   *  (`nnoremap <C-h> <C-w>h`). */
  aliases?: ReadonlyMap<string, PaneDir>;
  /** The .vimrc maps `<C-w>…` itself: leave Ctrl-w to vim. */
  ctrlWReserved?: boolean;
}

/** Letter of a Ctrl-chord, layout-independent where possible
 *  (Ctrl-h may report `Backspace` on some platforms). */
export function ctrlLetter(e: KeyLike): string | null {
  if (!e.ctrlKey || e.metaKey || e.altKey) return null;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key === 'Backspace' ? 'h' : null;
  if (k && /^[a-z]$/.test(k)) return k;
  // Non-Latin layouts report a non-ASCII key: fall back to the position.
  if (e.code && /^Key[A-Z]$/.test(e.code)) return e.code.slice(3).toLowerCase();
  return null;
}

const DIRS = new Set<PaneDir>(['h', 'j', 'k', 'l', 'w', 'p']);
const ARROWS: Record<string, PaneDir> = { ArrowLeft: 'h', ArrowDown: 'j', ArrowUp: 'k', ArrowRight: 'l' };

export class PaneKeys {
  private armedAt: number | null = null;

  constructor(private now: () => number = Date.now) {}

  /** A `Ctrl-w` prefix is waiting for its second key. */
  get pending(): boolean {
    if (this.armedAt != null && this.now() - this.armedAt >= PANE_CHORD_MS) this.armedAt = null;
    return this.armedAt != null;
  }

  reset(): void {
    this.armedAt = null;
  }

  /** null = not a pane key (let it through). */
  feed(e: KeyLike, o: PaneKeyOptions): PaneKeyResult | null {
    if (this.pending) {
      this.armedAt = null;
      if (e.key === 'Escape') return { kind: 'cancel' };
      if (e.metaKey || e.altKey) return { kind: 'cancel' };
      const win = winCommand(e);
      if (win) return { kind: 'win', cmd: win };
      // Ctrl-w Ctrl-h ≡ Ctrl-w h; Ctrl-w Ctrl-w ≡ Ctrl-w w.
      const ch = e.ctrlKey ? ctrlLetter(e) : e.key.length === 1 ? e.key.toLowerCase() : null;
      const dir = ARROWS[e.key] ?? (ch && DIRS.has(ch as PaneDir) ? (ch as PaneDir) : null);
      return dir ? { kind: 'nav', dir, chord: true } : { kind: 'cancel' };
    }
    const ch = ctrlLetter(e);
    if (!ch || e.shiftKey) return null;
    if (ch === 'w') {
      if (o.ctrlWReserved) return null;
      this.armedAt = this.now();
      return { kind: 'pending' };
    }
    const alias = o.aliases?.get(ch);
    if (alias) return { kind: 'nav', dir: alias, chord: false };
    if (!o.ctrlHjkl || o.reserved?.has(ch)) return null;
    if (ch === 'h' || ch === 'j' || ch === 'k' || ch === 'l') return { kind: 'nav', dir: ch, chord: false };
    return null;
  }
}

// ---- editor routing -----------------------------------------------------------

export type VimModeName = 'normal' | 'visual' | 'insert' | 'replace' | 'plain';

/** Pane keys from the user's maps for a vim mode: Ctrl-keys the user
 *  bound (left to vim) and `<C-x> → <C-w>{dir}` aliases. */
export function userPaneKeys(maps: readonly Pick<PlannedMap, 'lhs' | 'rhs' | 'ctx'>[], mode: 'normal' | 'visual'): Pick<PaneKeyOptions, 'reserved' | 'aliases' | 'ctrlWReserved'> {
  const reserved = new Set<string>();
  const aliases = new Map<string, PaneDir>();
  let ctrlWReserved = false;
  for (const m of maps) {
    if (m.ctx !== undefined && m.ctx !== mode) continue;
    const lhs = m.lhs.toLowerCase();
    if (lhs.startsWith('<c-w>')) {
      ctrlWReserved = true;
      continue;
    }
    const one = /^<c-([a-z])>$/.exec(lhs);
    if (!one) continue;
    const to = /^<c-w>(?:([hjklwp])|<c-([hjklwp])>)$/i.exec(m.rhs.trim());
    if (to) aliases.set(one[1], (to[1] ?? to[2]).toLowerCase() as PaneDir);
    else reserved.add(one[1]);
  }
  return { reserved, aliases, ctrlWReserved };
}

/**
 * Should the editor treat this key as pane navigation? Only with vim on,
 * in NORMAL/VISUAL, and not in the middle of a vim command (`d`, `"a`,
 * a count). INSERT/REPLACE keep vim semantics.
 */
export function editorPaneRoute(
  keys: PaneKeys,
  e: KeyLike,
  s: { vim: boolean; mode: VimModeName; vimPending: boolean; ctrlHjkl: boolean; maps: readonly Pick<PlannedMap, 'lhs' | 'rhs' | 'ctx'>[] },
): PaneKeyResult | null {
  if (!s.vim || (s.mode !== 'normal' && s.mode !== 'visual')) {
    keys.reset();
    return null;
  }
  if (s.vimPending && !keys.pending) return null;
  return keys.feed(e, { ctrlHjkl: s.ctrlHjkl, ...userPaneKeys(s.maps, s.mode) });
}

/** The vim engine is mid-command (operator, count, register, a
 *  multi-key prefix): its next key is vim's, not ours. */
export function vimMidCommand(input: { operator?: unknown; prefixRepeat?: readonly unknown[]; motionRepeat?: readonly unknown[]; keyBuffer?: readonly unknown[]; registerName?: unknown } | null | undefined): boolean {
  if (!input) return false;
  return !!(input.operator || input.prefixRepeat?.length || input.motionRepeat?.length || input.keyBuffer?.length || input.registerName);
}

/**
 * Keys that have a meaning of their own when no pane lies that way:
 * Ctrl-k (link helper / palette on Windows & Linux). The rest are
 * consumed anyway so the browser does not open history (Ctrl-h),
 * downloads (Ctrl-j) or the address bar (Ctrl-l).
 */
export function fallsThroughWithoutTarget(r: { dir: PaneDir; chord: boolean }): boolean {
  return !r.chord && r.dir === 'k';
}
