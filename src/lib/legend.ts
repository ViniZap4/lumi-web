// Command legend (which-key style): the handful of keys that matter in
// the current context, plus completions while a key sequence is
// pending (`g…`, `z…`, a count, the vim leader, an operator).
//
// Pure: the view resolves the context and pending input, this module
// decides what to show. Kept short on purpose — the legend is one
// compact line; `?` has the full keymap.

export type LegendContext =
  | 'explorer'
  | 'reader'
  | 'normal'
  | 'insert'
  | 'visual'
  | 'replace'
  | 'palette'
  | 'prompt'
  | 'confirm'
  | 'filter'
  | 'books';

export interface LegendItem {
  keys: string;
  label: string;
}

export interface LegendExtras {
  /** Vim leader as typed (`<Space>`, `,`, `\`). */
  leader?: string;
  /** Leader mappings: keys AFTER the leader → what they run. */
  leaderMaps?: ReadonlyArray<{ keys: string; rhs: string }>;
  /** Insert-mode escape sequences (`jj`). */
  escapeSequences?: readonly string[];
}

const SHELL_G: LegendItem[] = [
  { keys: 'gg', label: 'top' },
  { keys: 'ge', label: 'bottom' },
  { keys: 'gh', label: 'book root' },
  { keys: 'gb', label: 'books' },
  { keys: 'g1–9', label: 'book n' },
];
const SHELL_Z: LegendItem[] = [
  { keys: 'zp', label: 'preview' },
  { keys: 'zh', label: 'book root' },
];
const VIM_G: LegendItem[] = [
  { keys: 'gg', label: 'top' },
  { keys: 'gj gk', label: 'display line' },
  { keys: 'gu gU', label: 'lower/upper' },
  { keys: 'gv', label: 'reselect' },
  { keys: 'gJ', label: 'join' },
];
const VIM_Z: LegendItem[] = [
  { keys: 'zz', label: 'center' },
  { keys: 'zt', label: 'to top' },
  { keys: 'zb', label: 'to bottom' },
];
const VIM_OPERATOR: LegendItem[] = [
  { keys: 'w e b', label: 'word' },
  { keys: 'iw aw', label: 'inner/a word' },
  { keys: 'ip ap', label: 'paragraph' },
  { keys: 'i" i( i[', label: 'inside' },
  { keys: '$ 0', label: 'to end/start' },
  { keys: 'j k', label: 'lines' },
];

/** Friendly description of a mapping rhs for the leader legend. */
export function describeRhs(rhs: string): string {
  const ex = /^:([A-Za-z][\w-]*)(.*?)(<CR>)?$/i.exec(rhs);
  if (ex) {
    const name = ex[1];
    const known: Record<string, string> = {
      link: 'insert link',
      w: 'save',
      write: 'save',
      q: 'close',
      quit: 'close',
      wq: 'close',
      x: 'close',
      settings: 'settings',
      preview: 'live/source',
      noh: 'clear search',
      nohlsearch: 'clear search',
    };
    return known[name] ?? `:${name}${ex[2]}`;
  }
  return rhs.length > 14 ? rhs.slice(0, 13) + '…' : rhs;
}

export function legendFor(ctx: LegendContext, pending: string | null = null, x: LegendExtras = {}): LegendItem[] {
  const leader = x.leader ?? '\\';
  const pend = pending ?? '';

  if (ctx === 'explorer' || ctx === 'reader') {
    const count = /^(\d+)/.exec(pend)?.[1];
    const chord = pend.replace(/^\d+/, '');
    if (chord === 'g') return SHELL_G;
    if (chord === 'z') return SHELL_Z;
    if (count) {
      return ctx === 'explorer'
        ? [{ keys: `${count}j`, label: `down ${count}` }, { keys: `${count}k`, label: `up ${count}` }, { keys: 'Esc', label: 'cancel' }]
        : [{ keys: `${count}j`, label: `scroll ${count}` }, { keys: `${count}k`, label: `scroll ${count} up` }];
    }
    if (ctx === 'explorer') {
      return [
        { keys: 'j k', label: 'move' },
        { keys: 'h l', label: 'folder' },
        { keys: '⏎', label: 'open' },
        { keys: 'e', label: 'edit' },
        { keys: '/', label: 'filter' },
        { keys: 'a', label: 'new' },
        { keys: 'r', label: 'rename' },
        { keys: 'd', label: 'delete' },
        { keys: 'y p', label: 'copy' },
        { keys: 'H L', label: 'history' },
        { keys: 'space', label: 'commands' },
        { keys: '?', label: 'keys' },
      ];
    }
    return [
      { keys: 'j k', label: 'scroll' },
      { keys: 'd u', label: 'half page' },
      { keys: 'gg G', label: 'top/end' },
      { keys: 'e i', label: 'edit' },
      { keys: 'q h', label: 'back' },
      { keys: 'y', label: 'copy' },
      { keys: 'space', label: 'commands' },
      { keys: '?', label: 'keys' },
    ];
  }

  if (ctx === 'normal' || ctx === 'visual') {
    if (pend === leader || pend === '<leader>') {
      const maps = (x.leaderMaps ?? []).map((m) => ({ keys: leader + m.keys, label: describeRhs(m.rhs) }));
      return maps.length ? maps : [{ keys: `${leader}l`, label: 'insert link' }];
    }
    const count = /^(\d+)/.exec(pend)?.[1];
    const rest = pend.replace(/^\d+/, '');
    if (rest === 'g') return VIM_G;
    if (rest === 'z') return VIM_Z;
    if (/^[dcy<>]$/.test(rest)) {
      return [...VIM_OPERATOR, { keys: rest + rest, label: 'whole line' }];
    }
    if (count && !rest) return [{ keys: `${count}j`, label: `${count} lines` }, { keys: `${count}w`, label: `${count} words` }, { keys: `${count}dd`, label: `delete ${count}` }];
  }

  switch (ctx) {
    case 'normal':
      return [
        { keys: 'i a o', label: 'insert' },
        { keys: 'v V', label: 'visual' },
        { keys: 'dd yy p', label: 'cut/copy/paste' },
        { keys: 'u ⌃r', label: 'undo/redo' },
        { keys: '/ n', label: 'search' },
        { keys: `${leader}l`, label: 'link' },
        { keys: ':q', label: 'close' },
        { keys: '⌘E', label: 'reading' },
      ];
    case 'insert': {
      const esc = x.escapeSequences?.length ? `Esc ${x.escapeSequences.join(' ')}` : 'Esc';
      return [
        { keys: esc, label: 'normal' },
        { keys: '[[', label: 'link a note' },
        { keys: '⌘K', label: 'link' },
        { keys: '⌘V', label: 'URL on selection → link' },
        { keys: '⌃w', label: 'delete word' },
      ];
    }
    case 'visual':
      return [
        { keys: 'y d c', label: 'copy/cut/change' },
        { keys: '> <', label: 'indent' },
        { keys: '~ u U', label: 'case' },
        { keys: '⌘K', label: 'make link' },
        { keys: 'Esc', label: 'normal' },
      ];
    case 'replace':
      return [{ keys: 'Esc', label: 'normal' }];
    case 'palette':
      return [
        { keys: '↑ ↓ ⌃n ⌃p', label: 'select' },
        { keys: '⏎', label: 'run' },
        { keys: 'Esc', label: 'close' },
      ];
    case 'prompt':
      return [
        { keys: '⏎', label: 'confirm' },
        { keys: 'Esc', label: 'cancel' },
        { keys: 'a/b/name', label: 'in folders' },
        { keys: 'dir/', label: 'folder' },
      ];
    case 'filter':
      return [
        { keys: '⏎', label: 'keep filter' },
        { keys: '↑ ↓', label: 'move' },
        { keys: 'Esc', label: 'clear' },
        { keys: 'n N', label: 'next/prev (after ⏎)' },
      ];
    case 'confirm':
      return [
        { keys: 'y ⏎', label: 'confirm' },
        { keys: 'n Esc', label: 'cancel' },
      ];
    case 'books':
      return [
        { keys: 'j k', label: 'move' },
        { keys: '⏎ l', label: 'open' },
        { keys: 'g1–9', label: 'book n' },
        { keys: 'R', label: 'refresh' },
        { keys: 'Esc', label: 'back' },
      ];
  }
  return [];
}

/** Vim mode → legend context (`vim-mode-change` payload). */
export function contextForVimMode(mode: string | null | undefined, subMode?: string | null): LegendContext {
  if (mode === 'insert') return 'insert';
  if (mode === 'replace') return 'replace';
  if (mode === 'visual') return 'visual';
  void subMode;
  return 'normal';
}
