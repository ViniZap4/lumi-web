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
  /** The book's empty home (no note open). */
  | 'home'
  | 'reader'
  /** The split preview, focused: a keyboard reader. */
  | 'preview'
  | 'normal'
  | 'insert'
  | 'visual'
  | 'replace'
  | 'palette'
  /** The floating explorer at the books level (accounts → books). */
  | 'books'
  /** The floating explorer overlay (SPEC-PARTE2 §2), files level. */
  | 'float'
  /** A hover preview card opened with `K` (§4). */
  | 'hover';

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
  /** More than one pane on screen and Ctrl-h/j/k/l pane keys on. */
  panes?: boolean;
}

/** Completions after `Ctrl-w` (vim window commands). */
export const PANE_W: LegendItem[] = [
  { keys: 'v', label: 'split right', do: 'app:vsplit' },
  { keys: 's', label: 'split below', do: 'app:hsplit' },
  { keys: 'h j k l', label: 'move to pane' },
  { keys: 'q', label: 'close pane', do: 'app:closePane' },
  { keys: 'o', label: 'only this', do: 'app:onlyPane' },
  { keys: '=', label: 'equalize', do: 'app:equalPanes' },
  { keys: 'f ⏎', label: 'link → split' },
  { keys: 'F', label: 'link → below' },
  { keys: 'w', label: 'next pane', do: 'app:panes' },
  { keys: 'p', label: 'previous pane' },
  { keys: '< > + -', label: 'resize' },
  { keys: 'Esc', label: 'cancel' },
];

/** Floating explorer keys (files level) — the only navigation. */
export const FLOAT_ITEMS: LegendItem[] = [
  { keys: 'j k', label: 'move' },
  { keys: 'h l', label: 'folders', tip: 'h at the book root climbs to the books' },
  { keys: '⏎', label: 'open here' },
  { keys: '⌃v', label: 'split right' },
  { keys: '⌃s', label: 'split below' },
  { keys: '/', label: 'filter' },
  { keys: 'a r d', label: 'new/rename/delete' },
  { keys: 'y p', label: 'copy' },
  { keys: 'Esc q', label: 'close' },
  { keys: 'f', label: 'hints' },
  { keys: 'gb', label: 'books' },
  { keys: 'e', label: 'edit' },
  { keys: '⇧F10', label: 'menu' },
  { keys: 'gg G', label: 'top/end' },
  { keys: 'H L', label: 'history' },
  { keys: '.', label: 'hidden' },
  { keys: 'zp', label: 'preview' },
];

/** Floating explorer, books level. */
export const BOOKS_ITEMS: LegendItem[] = [
  { keys: 'j k', label: 'move' },
  { keys: '⏎ l', label: 'open book' },
  { keys: 'h', label: 'accounts' },
  { keys: 'g1–9', label: 'book n' },
  { keys: 'a', label: 'new book' },
  { keys: 'gh', label: 'this book' },
  { keys: 'R', label: 'refresh' },
  { keys: 'Esc q', label: 'close' },
];

/** Hover card keys (opened with `K`). */
export const HOVER_ITEMS: LegendItem[] = [
  { keys: 'j k', label: 'scroll' },
  { keys: '⏎', label: 'open' },
  { keys: '⌃w f', label: 'open in split' },
  { keys: '⌃w F', label: 'split below' },
  { keys: 'Esc', label: 'close' },
];

const PANES_ITEM: LegendItem = { keys: '⌃h ⌃l', label: 'panes', do: 'app:panes', tip: 'Ctrl-h/j/k/l move between panes · Ctrl-w w next · Ctrl-w p previous' };

const PREVIEW_ITEMS: LegendItem[] = [
  { keys: 'j k', label: 'scroll', do: 'preview:down' },
  { keys: 'd u', label: 'half page', do: 'preview:halfDown' },
  { keys: '{ }', label: 'heading', do: 'preview:nextHeading', tip: '} next heading · { previous (also ]] [[)' },
  { keys: '/', label: 'find', do: 'preview:find', tip: '/ find in the preview · n N next/previous match' },
  { keys: 'f', label: 'hints', do: 'app:hints', tip: 'Label links, tasks and copy buttons; type a label to click it' },
  { keys: 'q ⌃h', label: 'editor', do: 'preview:back', tip: 'q, Esc, e, i or Ctrl-h: back to the editor' },
  { keys: 'y', label: 'copy', do: 'preview:yank', tip: 'Copy the selection / current match, else the note' },
  { keys: 'gg G', label: 'top/end', do: 'preview:top' },
  { keys: 'n N', label: 'next match', do: 'preview:findNext' },
  { keys: '⏎ gf', label: 'open link', tip: 'Tab to a link, then Enter or gf; ⌃w f opens it in a split' },
  { keys: 'K', label: 'preview link', tip: 'Preview the focused link in a card' },
  { keys: '-', label: 'explorer', do: 'app:explorer', tip: 'The floating explorer at this note' },
  { keys: 'space b', label: 'page' },
  { keys: '⌃w w', label: 'next pane', do: 'app:panes' },
];

const SHELL_G: LegendItem[] = [
  { keys: 'gg', label: 'top', do: 'shell:top' },
  { keys: 'ge', label: 'bottom', do: 'shell:bottom' },
  { keys: 'gh', label: 'book root', do: 'shell:home' },
  { keys: 'gb', label: 'books', do: 'shell:picker' },
  { keys: 'g1–9', label: 'book n' },
];
const SHELL_Z: LegendItem[] = [
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
      explore: 'explorer',
      vsplit: 'split right',
      split: 'split below',
      only: 'only pane',
      follow: 'follow link',
      hover: 'preview link',
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
  if (ctx === 'float') return FLOAT_ITEMS;
  if (ctx === 'books') return BOOKS_ITEMS;
  if (ctx === 'hover') return HOVER_ITEMS;
  if (pend === '⌃w') return PANE_W;

  if (ctx === 'preview') {
    const count = /^(\d+)/.exec(pend)?.[1];
    const chord = pend.replace(/^\d+/, '');
    if (chord === 'g') return [{ keys: 'gg', label: 'top', do: 'preview:top' }];
    if (chord === '[' || chord === ']') return [{ keys: '[[', label: 'previous heading' }, { keys: ']]', label: 'next heading', do: 'preview:nextHeading' }];
    if (count) return [{ keys: `${count}j`, label: `scroll ${count}` }, { keys: `${count}}`, label: `${count} headings` }, { keys: 'Esc', label: 'cancel' }];
    return PREVIEW_ITEMS;
  }

  if (ctx === 'home' || ctx === 'reader') {
    const count = /^(\d+)/.exec(pend)?.[1];
    const chord = pend.replace(/^\d+/, '');
    if (chord === 'g') return ctx === 'reader' ? [...SHELL_G.slice(0, 4), { keys: 'gf', label: 'follow link', do: 'shell:follow' }, ...SHELL_G.slice(4)] : SHELL_G;
    if (chord === 'z') return SHELL_Z;
    if (count) {
      return ctx === 'home'
        ? [{ keys: `${count}j`, label: `down ${count}` }, { keys: `${count}k`, label: `up ${count}` }, { keys: 'Esc', label: 'cancel' }]
        : [{ keys: `${count}j`, label: `scroll ${count}` }, { keys: `${count}k`, label: `scroll ${count} up` }];
    }
    if (ctx === 'home') {
      return [
        { keys: '-', label: 'explorer', do: 'app:explorer', tip: 'The floating explorer: the only navigation (also l, ⏎, <leader>e, :explore)' },
        { keys: 'a', label: 'new note', do: 'shell:create' },
        { keys: 'j k', label: 'recent', do: 'shell:down' },
        { keys: 'gb', label: 'books', do: 'app:books', tip: 'Switch book in the floating explorer (accounts → books)' },
        { keys: '[ ]', label: 'prev/next book', do: 'shell:nextBook' },
        { keys: 'space', label: 'commands', do: 'shell:palette' },
        { keys: '?', label: 'keys', do: 'shell:help' },
        { keys: 'F', label: 'hints', do: 'app:hints', tip: 'Label everything clickable; type a label to click it' },
        { keys: 'H L', label: 'history', do: 'shell:historyBack' },
        { keys: ':', label: 'command', do: 'shell:command' },
        { keys: 'R', label: 'refresh', do: 'shell:refresh' },
        { keys: ',', label: 'settings', do: 'shell:settings' },
      ];
    }
    return [
      { keys: 'j k', label: 'scroll', do: 'shell:down' },
      { keys: 'd u', label: 'half page', do: 'shell:halfDown' },
      { keys: '- h', label: 'explorer', do: 'shell:floatExplorer', tip: 'The floating explorer at this note (yazi) — also <leader>e, :explore' },
      { keys: 'e i', label: 'edit', do: 'shell:edit' },
      { keys: 'gg G', label: 'top/end', do: 'shell:top' },
      { keys: 'q', label: 'close', do: 'shell:close', tip: 'Close the note (back to the book home); in a split, close the pane' },
      { keys: '⌃w v', label: 'split', do: 'app:vsplit', tip: 'Ctrl-w v / s split · q close · o only · = equalize' },
      { keys: 'K', label: 'preview link', do: 'shell:hover', tip: 'Preview the focused (or first visible) link' },
      { keys: 'gf', label: 'follow link', do: 'shell:follow', tip: 'gf / Enter: this pane · Ctrl-w f: split · ⌘-click: split' },
      { keys: 'H L', label: 'back/forward', do: 'shell:historyBack', tip: 'Previous / next note opened here' },
      { keys: 'y', label: 'copy', do: 'shell:yank' },
      { keys: 'F', label: 'hints', do: 'app:hints', tip: 'Label links, tasks and buttons; type a label to click it' },
      ...(x.panes ? [PANES_ITEM] : []),
      { keys: 'space', label: 'commands', do: 'shell:palette' },
      { keys: '?', label: 'keys', do: 'shell:help' },
      { keys: 'a r', label: 'new/rename', do: 'shell:rename', tip: 'a: new note, r: rename / move — in the explorer' },
      { keys: 'gb', label: 'books', do: 'app:books' },
      { keys: '⌘E', label: 'edit', do: 'shell:edit' },
      { keys: ':', label: 'command', do: 'shell:command' },
      { keys: '[ ]', label: 'prev/next book', do: 'shell:nextBook' },
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
        { keys: '- ' + `${leader}e`, label: 'explorer', do: 'ex:explore', tip: 'Floating explorer at this note' },
      ];
      if (x.source) items.push({ keys: `${leader}p`, label: x.split ? 'hide preview' : 'preview', do: 'ex:preview split', tip: 'Rendered preview beside the source (⌘⌥P, :preview split)' });
      if (x.split && x.panes) items.push({ keys: '⌃l', label: 'read preview', do: 'app:readPreview', tip: 'Ctrl-l focuses the preview: j/k, { }, /, f; q or Ctrl-h comes back' });
      else if (x.panes) items.push(PANES_ITEM);
      items.push(
        { keys: ':q', label: 'close', do: 'ex:q' },
        { keys: 'gf K', label: 'follow/preview link', do: 'ex:hover', tip: 'gf or Enter on a link follows it · K previews it · Ctrl-w f opens it in a split' },
        { keys: '⌃w v', label: 'split', do: 'ex:vsplit', tip: ':vsplit / :split [note] · Ctrl-w q close · o only · = equalize' },
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
