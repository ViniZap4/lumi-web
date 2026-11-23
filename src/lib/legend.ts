// Command legend (which-key style): the handful of keys that matter in
// the current context, plus completions while a key sequence is
// pending (`g…`, `z…`, a count, the vim leader, an operator).
//
// Pure: the view resolves the context and pending input, this module
// decides what to show. Items are listed in priority order; the
// legend component measures them and shows as many as fit on its one
// line (`fitLegend`), so wide windows get the extras (marks,
// registers, folding, split-preview keys) and narrow ones the core.
// Items with `do` are clickable: the view runs the same action the
// keys would (`shell:<action>`, `vim:<keys>`, `ex:<cmd>`, `app:<id>`).

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
  /** Action run on click (same as typing the keys). */
  do?: string;
  /** Longer tooltip. */
  tip?: string;
}

export interface LegendExtras {
  /** Vim leader as typed (`<Space>`, `,`, `\`). */
  leader?: string;
  /** Leader mappings: keys AFTER the leader → what they run. */
  leaderMaps?: ReadonlyArray<{ keys: string; rhs: string }>;
  /** Insert-mode escape sequences (`jj`). */
  escapeSequences?: readonly string[];
  /** Editor is in Source mode (split preview keys apply). */
  source?: boolean;
  /** The split preview is showing. */
  split?: boolean;
}

const SHELL_G: LegendItem[] = [
  { keys: 'gg', label: 'top', do: 'shell:top' },
  { keys: 'ge', label: 'bottom', do: 'shell:bottom' },
  { keys: 'gh', label: 'book root', do: 'shell:home' },
  { keys: 'gb', label: 'books', do: 'shell:picker' },
  { keys: 'g1–9', label: 'book n' },
];
const SHELL_Z: LegendItem[] = [
  { keys: 'zp', label: 'preview', do: 'shell:togglePreview' },
  { keys: 'zh', label: 'book root', do: 'shell:home' },
];
const VIM_G: LegendItem[] = [
  { keys: 'gg', label: 'top', do: 'vim:gg' },
  { keys: 'gj gk', label: 'display line' },
  { keys: 'gu gU', label: 'lower/upper' },
  { keys: 'gv', label: 'reselect', do: 'vim:gv' },
  { keys: 'gJ', label: 'join', do: 'vim:gJ' },
];
const VIM_Z: LegendItem[] = [
  { keys: 'zz', label: 'center', do: 'vim:zz' },
  { keys: 'zt', label: 'to top', do: 'vim:zt' },
  { keys: 'zb', label: 'to bottom', do: 'vim:zb' },
  { keys: 'za', label: 'toggle fold', do: 'vim:za' },
  { keys: 'zc zo', label: 'close/open fold' },
  { keys: 'zM zR', label: 'fold/unfold all' },
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

/** Click action for a leader mapping rhs (ex commands only). */
function rhsAction(rhs: string): string | undefined {
  const m = /^:(.+?)(<CR>)?$/i.exec(rhs);
  return m ? `ex:${m[1]}` : undefined;
}

/**
 * Which items fit on one line. `widths[i]` is item i's measured width
 * (priority order), `gap` the space between items, `available` the
 * room for items. Greedy in priority order: an item that does not fit
 * is skipped and smaller, lower-priority ones may still take the
 * remaining room; the result keeps priority order. When something is
 * left out, `reserve` (the overflow marker) is kept free.
 */
export function fitLegend(widths: readonly number[], available: number, gap: number, reserve = 0): { shown: number[]; overflow: boolean } {
  const total = widths.reduce((a, w) => a + w, 0) + gap * Math.max(0, widths.length - 1);
  if (total <= available) return { shown: widths.map((_, i) => i), overflow: false };
  const room = available - reserve - gap;
  const shown: number[] = [];
  let used = 0;
  for (let i = 0; i < widths.length; i++) {
    const need = widths[i] + (shown.length ? gap : 0);
    if (used + need <= room) {
      shown.push(i);
      used += need;
    }
  }
  return { shown, overflow: shown.length < widths.length };
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
        { keys: 'j k', label: 'move', do: 'shell:down' },
        { keys: 'h l', label: 'folder', do: 'shell:parent' , tip: 'h: parent folder · l: open folder / note' },
        { keys: '⏎', label: 'open', do: 'shell:open' },
        { keys: 'e', label: 'edit', do: 'shell:edit' },
        { keys: '/', label: 'filter', do: 'shell:filter' },
        { keys: 'a', label: 'new', do: 'shell:create' },
        { keys: 'r', label: 'rename', do: 'shell:rename' },
        { keys: 'd', label: 'delete', do: 'shell:delete' },
        { keys: 'y p', label: 'copy', do: 'shell:yank', tip: 'y: yank the note · p: paste a copy here' },
        { keys: 'f', label: 'hints', do: 'app:hints', tip: 'Label everything clickable; type a label to click it' },
        { keys: 'space', label: 'commands', do: 'shell:palette' },
        { keys: '?', label: 'keys', do: 'shell:help' },
        { keys: 'gg G', label: 'top/end', do: 'shell:top' },
        { keys: 'H L', label: 'history', do: 'shell:historyBack' },
        { keys: ':', label: 'command', do: 'shell:command' },
        { keys: '⇧F10', label: 'menu', do: 'app:menu', tip: 'Context menu for the row (or right-click)' },
        { keys: 'zp', label: 'preview col', do: 'shell:togglePreview' },
        { keys: '⌃d ⌃u', label: 'half page' },
        { keys: '.', label: 'hidden', do: 'shell:toggleHidden' },
        { keys: 'R', label: 'refresh', do: 'shell:refresh' },
        { keys: '[ ]', label: 'prev/next book', do: 'shell:nextBook' },
        { keys: 'gb', label: 'books', do: 'shell:picker' },
        { keys: ',', label: 'settings', do: 'shell:settings' },
      ];
    }
    return [
      { keys: 'j k', label: 'scroll', do: 'shell:down' },
      { keys: 'd u', label: 'half page', do: 'shell:halfDown' },
      { keys: 'gg G', label: 'top/end', do: 'shell:top' },
      { keys: 'e i', label: 'edit', do: 'shell:edit' },
      { keys: 'q h', label: 'back', do: 'shell:parent' },
      { keys: 'y', label: 'copy', do: 'shell:yank' },
      { keys: 'F', label: 'hints', do: 'app:hints', tip: 'Label links, tasks and buttons; type a label to click it' },
      { keys: 'space', label: 'commands', do: 'shell:palette' },
      { keys: '?', label: 'keys', do: 'shell:help' },
      { keys: 'r', label: 'rename', do: 'shell:rename' },
      { keys: 'H L', label: 'history', do: 'shell:historyBack' },
      { keys: '⌘E', label: 'edit', do: 'shell:edit' },
      { keys: ':', label: 'command', do: 'shell:command' },
      { keys: '[ ]', label: 'prev/next book', do: 'shell:nextBook' },
      { keys: 'gh', label: 'book root', do: 'shell:home' },
      { keys: ',', label: 'settings', do: 'shell:settings' },
    ];
  }

  if (ctx === 'normal' || ctx === 'visual') {
    if (pend === leader || pend === '<leader>') {
      const maps = (x.leaderMaps ?? []).map((m) => ({ keys: leader + m.keys, label: describeRhs(m.rhs), do: rhsAction(m.rhs) }));
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
    case 'normal': {
      const items: LegendItem[] = [
        { keys: 'i a o', label: 'insert', do: 'vim:i' },
        { keys: 'v V', label: 'visual', do: 'vim:v' },
        { keys: 'dd yy p', label: 'cut/copy/paste' },
        { keys: 'u ⌃r', label: 'undo/redo', do: 'vim:u', tip: 'u undo · Ctrl-r redo' },
        { keys: '/ n', label: 'search', do: 'vim:/' },
        { keys: `${leader}l`, label: 'link', do: 'ex:link' },
      ];
      if (x.source) items.push({ keys: `${leader}p`, label: x.split ? 'hide preview' : 'preview', do: 'ex:preview split', tip: 'Rendered preview beside the source (⌘⌥P, :preview split)' });
      items.push(
        { keys: ':q', label: 'close', do: 'ex:q' },
        { keys: '⌘E', label: 'reading', do: 'app:reading' },
        { keys: 'ciw', label: 'change word', do: 'vim:ciw' },
        { keys: '.', label: 'repeat', do: 'vim:.' },
        { keys: '>> <<', label: 'indent', do: 'vim:>>' },
        { keys: '* #', label: 'word search', do: 'vim:*' },
        { keys: 'za', label: 'fold', do: 'vim:za', tip: 'za toggle · zc close · zo open · zM/zR all' },
        { keys: 'gg G', label: 'top/end', do: 'vim:gg' },
        { keys: 'ma \'a', label: 'marks', tip: 'm{a-z} sets a mark, \'{a-z} jumps to it' },
        { keys: '"a', label: 'registers', tip: '"{a-z} before y/d/p picks a register' },
        { keys: 'zz', label: 'center', do: 'vim:zz' },
        { keys: '⌘⇧E', label: x.source ? 'live preview' : 'source', do: 'app:toggleMode' },
        { keys: ':', label: 'ex', do: 'vim::' },
      );
      if (x.split) items.push({ keys: '⌘⌥P', label: 'split', do: 'ex:preview split' });
      return items;
    }
    case 'insert': {
      const esc = x.escapeSequences?.length ? `Esc ${x.escapeSequences.join(' ')}` : 'Esc';
      return [
        { keys: esc, label: 'normal', do: 'vim:<Esc>' },
        { keys: '[[', label: 'link a note', do: 'ex:link' },
        { keys: '⌘K', label: 'link', do: 'ex:link' },
        { keys: '⌘V', label: 'URL on selection → link' },
        { keys: '⌃w', label: 'delete word' },
        { keys: '⌃u', label: 'delete line start' },
        { keys: '⌃o', label: 'one normal cmd' },
        { keys: '⌘E', label: 'reading', do: 'app:reading' },
      ];
    }
    case 'visual':
      return [
        { keys: 'y d c', label: 'copy/cut/change', do: 'vim:y' },
        { keys: '> <', label: 'indent', do: 'vim:>' },
        { keys: '~ u U', label: 'case', do: 'vim:~' },
        { keys: '⌘K', label: 'make link', do: 'ex:link' },
        { keys: 'Esc', label: 'normal', do: 'vim:<Esc>' },
        { keys: 'o', label: 'other end', do: 'vim:o' },
        { keys: 'iw ip', label: 'select word/para' },
        { keys: 'J', label: 'join', do: 'vim:J' },
        { keys: ':', label: 'ex on range', do: 'vim::' },
      ];
    case 'replace':
      return [{ keys: 'Esc', label: 'normal', do: 'vim:<Esc>' }];
    case 'palette':
      return [
        { keys: '↑ ↓ ⌃n ⌃p', label: 'select' },
        { keys: '⏎', label: 'run' },
        { keys: 'Esc', label: 'close' },
        { keys: ':', label: 'commands only' },
        { keys: 'Tab', label: 'next' },
      ];
    case 'prompt':
      return [
        { keys: '⏎', label: 'confirm', do: 'app:submit' },
        { keys: 'Esc', label: 'cancel', do: 'app:cancel' },
        { keys: 'a/b/name', label: 'in folders' },
        { keys: 'dir/', label: 'folder' },
      ];
    case 'filter':
      return [
        { keys: '⏎', label: 'keep filter', do: 'app:submit' },
        { keys: '↑ ↓', label: 'move' },
        { keys: 'Esc', label: 'clear', do: 'app:cancel' },
        { keys: 'n N', label: 'next/prev (after ⏎)' },
      ];
    case 'confirm':
      return [
        { keys: 'y ⏎', label: 'confirm', do: 'app:confirm' },
        { keys: 'n Esc', label: 'cancel', do: 'app:cancel' },
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
