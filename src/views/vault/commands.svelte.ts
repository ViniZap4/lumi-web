// Keys, actions, the command legend, the palette and the context menu
// of the book shell. One `runAction` table serves the keymap, the
// legend, the palette, the context menu and the explorer's app keys.

import { vaults } from '../../lib/vaults.svelte.ts';
import { notes } from '../../lib/notes.svelte.ts';
import { books } from '../../lib/books.svelte.ts';
import { uiState } from '../../lib/uistate.svelte.ts';
import { editorSettings } from '../../lib/editor-settings.svelte.ts';
import { structuredFocus } from '../../lib/structured-mode.svelte.ts';
import { isEditableTarget } from '../../lib/shortcuts.ts';
import { ShellKeymap, CHORD_TIMEOUT_MS, type ShellAction } from '../../lib/shell-keymap.ts';
import { PaneKeys, fallsThroughWithoutTarget, PANE_CHORD_MS } from '../../lib/pane-nav.ts';
import { PreviewKeymap, type PreviewAction } from '../../lib/preview-keys.ts';
import { legendFor, contextForVimMode, type LegendContext, type LegendItem } from '../../lib/legend.ts';
import { effectiveSettings, appliedMappings, LEADER_TOKEN } from '../../lib/vim-config.ts';
import { accountGroups, hasAccountsLayer } from '../../lib/books-nav.ts';
import { menuFor, type MenuItem } from '../../lib/context-actions.ts';
import { normalizePath, type Entry, type NoteEntry } from '../../lib/notetree.ts';
import type { NoteSummary } from '../../lib/types.ts';
import type { PaletteCommand } from '../../lib/palette.ts';
import { zen } from '../../lib/zen.svelte.ts';
import { paletteCommands } from './palette-commands.ts';
import type { Workspace } from './workspace.svelte.ts';

export type MenuState = { x: number; y: number; items: MenuItem[]; entry: Entry | null; title: string };

const PREVIEW_ALIASES: Record<string, PreviewAction> = {
  down: { kind: 'scroll', unit: 'line', n: 1 },
  halfDown: { kind: 'scroll', unit: 'half', n: 1 },
  top: { kind: 'top' },
  nextHeading: { kind: 'heading', dir: 1, n: 1 },
  find: { kind: 'find' },
  findNext: { kind: 'findNext', dir: 1 },
  yank: { kind: 'yank' },
  back: { kind: 'back' },
};

const SHELL_ALIASES: Record<string, ShellAction> = {
  down: { kind: 'move', n: 1 },
  halfDown: { kind: 'halfPage', dir: 1 },
};

/** `:` lines typed in the palette (reader / home): the pane ex commands. */
const EX_LINE = /^\s*(vs|vsp|vspl|vspli|vsplit|sp|spl|spli|split|on|onl|only|zo|zoo|zoom|clo|clos|close|q|quit|exp|expl|explo|explor|explore|Ex|books?)\b\s*(.*)$/;

export function noteEntryFor(n: NoteSummary | null | undefined): NoteEntry | null {
  if (!n) return null;
  const path = normalizePath(n.path || n.id + '.md');
  return { kind: 'note', key: 'n:' + n.id, name: n.title ?? path.split('/').pop() ?? n.id, path, note: n };
}

export class CommandController {
  readonly keymap = new ShellKeymap();
  readonly paneKeys = new PaneKeys();
  readonly previewKeys = new PreviewKeymap();
  shellPending = $state<string | null>(null);
  panePending = $state(false);
  previewPending = $state<string | null>(null);
  paletteMode = $state<null | 'all' | 'command'>(null);
  hintsOpen = $state(false);
  /** Hint mode scope (the split preview's `f` labels only its links). */
  hintRoot = $state<(() => HTMLElement | null) | null>(null);
  menu = $state<MenuState | null>(null);
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;

  readonly eff = $derived(effectiveSettings(editorSettings.value));

  readonly legendCtx: LegendContext = $derived.by(() => {
    const ws = this.ws;
    const ed = ws.edit;
    if (this.paletteMode) return 'palette';
    if (ws.explorer.fx) return ws.explorer.level === 'books' ? 'books' : 'float';
    if (ws.hover.current?.keyboard) return 'hover';
    if (ws.pane === 'home') return 'home';
    // A canvas / board has the keyboard: its own keys (Reading or Edit).
    const sf = structuredFocus.current;
    if (sf) return sf.kind === 'canvas' ? 'canvas' : 'board';
    const ap = ws.panes.activePane;
    if (ap === 'leaf') return ws.panes.info[ws.panes.activeLeafId]?.editing ? (this.eff.vim ? contextForVimMode(ed.vimState.mode) : 'insert') : 'reader';
    if (ed.mode && ed.session && ap === 'split') return 'preview';
    if (ed.mode && ed.session) return this.eff.vim ? contextForVimMode(ed.vimState.mode) : 'insert';
    return 'reader';
  });

  readonly legendPending = $derived.by(() => {
    const ctx = this.legendCtx;
    const ed = this.ws.edit;
    if (ctx === 'float' || ctx === 'books' || ctx === 'hover') return null;
    if (this.panePending) return '⌃w';
    if (ctx === 'preview') return this.previewPending;
    if (ed.mode && ctx !== 'reader') return ed.vimState.pending === this.eff.leader ? this.eff.leader : ed.vimState.pending;
    return this.shellPending;
  });

  readonly legendItems = $derived.by(() =>
    legendFor(this.legendCtx, this.legendPending, {
      leader: this.eff.leader,
      escapeSequences: this.eff.escapeSequences,
      source: this.ws.edit.mode && editorSettings.value.editMode === 'source',
      split: this.ws.edit.mode && this.ws.edit.splitOn,
      panes: this.ws.panes.multiPane && editorSettings.value.paneNav,
      structuredMode: structuredFocus.current?.mode,
      leaderMaps: this.ws.edit.mode
        ? appliedMappings()
            .filter((m) => m.lhs.startsWith(LEADER_TOKEN))
            .map((m) => ({ keys: m.lhs.slice(LEADER_TOKEN.length), rhs: m.rhs }))
        : [],
    }).filter((it) => !(this.legendCtx === 'books' && it.keys === 'h' && !hasAccountsLayer(accountGroups(books.list)))),
  );

  readonly legendMode = $derived.by(() => {
    const ctx = this.legendCtx;
    if (ctx === 'float') return 'explorer';
    if (ctx === 'books') return 'livros';
    if (ctx === 'hover') return 'preview';
    if (ctx === 'canvas' || ctx === 'board') return structuredFocus.current?.mode === 'edit' ? 'edit' : 'reading';
    return ctx;
  });

  readonly paletteCommands: PaletteCommand[] = $derived.by(() => paletteCommands(this.ws));

  constructor(private readonly ws: Workspace) {}

  install(): void {
    // The shell arms the configured vim leader (`<leader>z` = Modo zen).
    $effect(() => {
      this.keymap.leader = this.eff.leader;
    });
    // The Ctrl-w prefix expires like vim's other pending keys.
    $effect(() => {
      if (!this.panePending) return;
      const t = setTimeout(() => (this.panePending = this.paneKeys.pending), PANE_CHORD_MS + 20);
      return () => clearTimeout(t);
    });
  }

  destroy(): void {
    if (this.pendingTimer) clearTimeout(this.pendingTimer);
  }

  resetPreviewKeys(): void {
    this.previewKeys.reset();
    this.previewPending = null;
  }

  overlayOpen(): boolean {
    const ws = this.ws;
    return !!(
      uiState.accountModal || uiState.createBookOpen || ws.showSettings || uiState.settings || uiState.helpOpen || uiState.themePickerOpen ||
      this.paletteMode || this.hintsOpen || this.menu || ws.explorer.fx || ws.hover.current?.keyboard
    );
  }

  private syncPending(): void {
    this.shellPending = this.keymap.pending;
    if (this.pendingTimer) clearTimeout(this.pendingTimer);
    if (this.shellPending && this.keymap.chord) {
      this.pendingTimer = setTimeout(() => (this.shellPending = this.keymap.pending), CHORD_TIMEOUT_MS + 20);
    }
  }

  // ---- keys -----------------------------------------------------------------

  handleKey = (e: KeyboardEvent): void => {
    const ws = this.ws;
    const ed = ws.edit;
    // Cmd/Ctrl+S: refresh after the live save, regardless of focus.
    if (ed.mode && (e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      void ed.save();
      return;
    }

    // A hover card shown by the pointer: Esc dismisses it.
    if (ws.hover.current && !ws.hover.current.keyboard && e.key === 'Escape') {
      e.preventDefault();
      ws.hover.close();
      return;
    }

    if (this.overlayOpen()) return;

    // A component (CodeMirror/vim, a form control, a board / canvas)
    // already handled it — including the second key of a Ctrl-w chord
    // (canvas Ctrl-w f), so the shell's chord ends too.
    if (e.defaultPrevented) {
      if (this.paneKeys.pending) {
        this.paneKeys.reset();
        this.panePending = false;
      }
      return;
    }
    // A task checkbox (focused by a click or a hint) is not text entry:
    // the reader keys keep working around it.
    const taskBox = (e.target as HTMLElement | null)?.matches?.('input[type="checkbox"][data-task]') ?? false;
    if (isEditableTarget(e.target) && !taskBox) return;

    // Pane navigation: Ctrl-h/j/k/l, Ctrl-w h/j/k/l/w/p. (The editor
    // routes its own, vim-mode aware, see NoteEditor.)
    const pk = this.paneKeys.feed(e, { ctrlHjkl: editorSettings.value.paneNav });
    this.panePending = this.paneKeys.pending;
    if (pk) {
      if (pk.kind === 'win') {
        e.preventDefault();
        ws.panes.runWin(pk.cmd);
        return;
      }
      if (pk.kind !== 'nav' || ws.panes.navigate(pk.dir) || !fallsThroughWithoutTarget(pk)) {
        e.preventDefault();
        return;
      }
    }

    // The split preview, focused, is a keyboard reader.
    if (ed.mode && ws.panes.activePane === 'split') {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K' || e.key === 'e' || e.key === 'E')) {
        // fall through to the palette / reading toggles below
      } else {
        this.handlePreviewKey(e);
        return;
      }
    }

    // Cmd/Ctrl+K: palette (in the editor CodeMirror takes it for links).
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      this.paletteMode = 'all';
      return;
    }

    // Cmd/Ctrl+E toggles reading <-> editing (Obsidian). Inside the
    // editor CodeMirror handles it first; this covers focus elsewhere.
    if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.key === 'e' || e.key === 'E')) {
      if (e.shiftKey) {
        e.preventDefault();
        editorSettings.toggleEditMode();
        return;
      }
      if (ed.mode) {
        e.preventDefault();
        ed.exit();
        return;
      }
      const target = ws.noteUnderFocus();
      if (target) {
        e.preventDefault();
        void ed.editNote(target);
      }
      return;
    }

    // In edit mode, leaving is an explicit command only (Done button,
    // Mod-Enter, Mod-E, vim :q) — never a stray Esc.
    if (ed.mode && ws.panes.activePane !== 'leaf') return;

    // Enter / Space on a focused button or link keep their meaning.
    const t = e.target as HTMLElement | null;
    if ((e.key === 'Enter' || e.key === ' ') && t?.matches?.('button, a[href], [role="button"]')) return;

    const action = this.keymap.feed(e, 'reader');
    this.syncPending();
    if (!action) return;
    e.preventDefault();
    if (action.kind === 'pending') return;
    this.runAction(action);
  };

  private handlePreviewKey(e: KeyboardEvent): void {
    const ws = this.ws;
    const t = e.target as HTMLElement | null;
    // Tab / Enter on a focused link or button keep their native meaning.
    if (e.key === 'Tab') return;
    const a = this.previewKeys.feed(e);
    this.previewPending = this.previewKeys.pending;
    if (!a) return;
    if (a.kind === 'open' && !(t && t.matches('a[href], button, input[data-task]'))) return;
    e.preventDefault();
    if (a.kind === 'pending') return;
    const primary = ws.panes.primaryLeaf;
    switch (a.kind) {
      case 'back':
        if (e.key === 'Escape' && ws.edit.splitRef?.clearFind()) return;
        void ws.panes.focusPaneEl('editor', 'split');
        return;
      case 'hints':
        this.openHints(() => ws.edit.splitRef?.previewElement() ?? null);
        return;
      case 'yank':
        void ws.copyPreviewText();
        return;
      case 'help':
        uiState.helpOpen = true;
        return;
      case 'command':
        this.paletteMode = 'command';
        return;
      case 'floatExplorer':
        ws.explorer.open();
        return;
      case 'hover':
        ws.hover.key(ws.readerLinkTarget(), null, ws.leafPath(primary));
        return;
      case 'follow': {
        const l = ws.readerLinkTarget();
        if (l) ws.followLink(l.href, 'current', ws.leafPath(primary));
        return;
      }
      default:
        ws.edit.splitRef?.run(a);
    }
  }

  openHints(root: (() => HTMLElement | null) | null = null): void {
    this.hintRoot = root;
    this.hintsOpen = true;
  }

  closeHints = (): void => {
    this.hintsOpen = false;
    this.hintRoot = null;
  };

  // ---- actions --------------------------------------------------------------

  /** Reader keys in a secondary pane; false = not pane-specific. */
  private runLeafAction(a: ShellAction): boolean {
    const ws = this.ws;
    const id = ws.panes.activeLeafId;
    const h = ws.panes.refs[id];
    if (!h) return false;
    switch (a.kind) {
      case 'edit': void h.enterEdit(); return true;
      case 'close': ws.panes.closeLeaf(id); return true;
      case 'yank': {
        const el = h.element()?.querySelector('.md-body');
        const sel = window.getSelection?.()?.toString();
        void navigator.clipboard?.writeText(sel || el?.textContent || '').then(() => ws.flash(sel ? 'copied selection' : 'copied note text'), () => ws.flash('clipboard unavailable', 'warn'));
        return true;
      }
      case 'rename':
      case 'open':
        return true;
      default:
        return false;
    }
  }

  runAction = (a: ShellAction): void => {
    const ws = this.ws;
    const ex = ws.explorer;
    if (ws.panes.activePane === 'leaf' && this.runLeafAction(a)) return;
    const home = ws.pane === 'home';
    switch (a.kind) {
      case 'move':
        if (home) ws.homeMove(a.n);
        else ws.scrollNote(60 * a.n);
        return;
      case 'halfPage':
        if (home) ws.homeMove(a.dir * 4);
        else ws.scrollNote(a.dir > 0 ? 'half' : '-half');
        return;
      case 'page':
        if (home) ws.homeMove(a.dir * 8);
        else ws.scrollNote(a.dir > 0 ? 'page' : '-page');
        return;
      case 'top':
        if (home) ws.homeFocus(0);
        else ws.scrollNote('top');
        return;
      case 'bottom':
        if (home) ws.homeFocus(ws.recents.length - 1);
        else ws.scrollNote('bottom');
        return;
      // h / ← / ⌫ / -: the explorer, at this note (vim-vinegar's `-`).
      case 'parent':
      case 'floatExplorer':
        ex.open();
        return;
      case 'open':
        if (home) ex.open();
        return;
      case 'historyBack':
      case 'historyForward': {
        const id = a.kind === 'historyBack' ? ws.noteHistory.goBack() : ws.noteHistory.goForward();
        if (id) ws.openIn(id, 'current', ws.panes.primaryLeaf, { history: false });
        else ws.flash(a.kind === 'historyBack' ? 'no earlier note' : 'no later note');
        return;
      }
      case 'home':
        ex.open({ root: true });
        return;
      case 'filter':
        ex.open({ initial: 'filter' });
        return;
      case 'close':
        if (!home) ws.panes.closeLeaf();
        return;
      case 'clearOrBack':
        return;
      case 'create':
        ex.beginCreate();
        return;
      case 'rename':
        ex.beginRename();
        return;
      case 'delete':
        ex.beginDelete();
        return;
      case 'yank':
        if (!home) void ws.copyNoteText();
        return;
      case 'paste':
        ex.open({ initial: 'paste' });
        return;
      case 'refresh':
        void notes.refresh();
        ws.flash('refreshing…');
        return;
      case 'edit': {
        const target = ws.noteUnderFocus();
        if (target && ws.edit.mode && ws.edit.session?.noteID === target) void ws.panes.focusPaneEl('editor');
        else if (target) void ws.edit.editNote(target);
        else if (home) ex.open();
        return;
      }
      case 'palette':
        this.paletteMode = 'all';
        return;
      case 'command':
        this.paletteMode = 'command';
        return;
      case 'help':
        uiState.helpOpen = true;
        return;
      case 'settings':
        uiState.openSettings('editor');
        return;
      case 'book':
        books.openShortcut(a.n);
        return;
      case 'picker':
        ex.openBooks();
        return;
      case 'prevBook':
      case 'nextBook':
        ws.cycleBook(a.kind === 'nextBook' ? 1 : -1);
        return;
      case 'hints':
        this.openHints(null);
        return;
      case 'menu':
        this.openMenuAtCursor();
        return;
      case 'hover':
        ws.hover.key(ws.readerLinkTarget(), null, ws.leafPath());
        return;
      case 'zen':
        zen.toggle();
        return;
      case 'follow': {
        const l = ws.readerLinkTarget();
        if (!l) return ws.flash('no link to follow — Tab to one, or f for hints', 'warn');
        ws.followLink(l.href, 'current', ws.leafPath());
        return;
      }
    }
  };

  // ---- legend ---------------------------------------------------------------

  onLegendAction = (it: LegendItem): void => {
    const ws = this.ws;
    const d = it.do;
    if (!d) return;
    const i = d.indexOf(':');
    const ns = d.slice(0, i);
    const arg = d.slice(i + 1);
    if (ns === 'shell') {
      this.runAction(SHELL_ALIASES[arg] ?? ({ kind: arg } as ShellAction));
      return;
    }
    if (ns === 'preview') {
      const a = PREVIEW_ALIASES[arg];
      if (a.kind === 'back') void ws.panes.focusPaneEl('editor', 'split');
      else if (a.kind === 'yank') void ws.copyPreviewText();
      else ws.edit.splitRef?.run(a);
      return;
    }
    if (ns === 'vim' || ns === 'ex') {
      ws.edit.editorRef?.run(d);
      return;
    }
    const pn = ws.panes;
    switch (arg) {
      case 'hints':
        this.openHints(this.legendCtx === 'preview' ? () => ws.edit.splitRef?.previewElement() ?? null : null);
        return;
      case 'panes': pn.navigate('w'); return;
      case 'vsplit': pn.runWin('vsplit'); return;
      case 'hsplit': pn.runWin('split'); return;
      case 'closePane': pn.runWin('close'); return;
      case 'onlyPane': pn.runWin('only'); return;
      case 'zoomPane': pn.runWin('zoom'); return;
      case 'equalPanes': pn.runWin('equal'); return;
      case 'explorer': ws.explorer.open(); return;
      case 'books': ws.explorer.openBooks(); return;
      case 'readPreview': void pn.focusPaneEl('split'); return;
      case 'menu': this.openMenuAtCursor(); return;
      case 'reading': ws.edit.exitAnimated(); return;
      case 'toggleMode': editorSettings.toggleEditMode(); return;
      case 'settings': uiState.openSettings('editor'); return;
    }
  };

  /** `:` lines typed in the palette (reader / home): the pane ex
   *  commands. true = handled. */
  runExLine = (line: string): boolean => {
    if (/^\s*zen\s*$/.test(line)) {
      zen.toggle();
      return true;
    }
    const m = EX_LINE.exec(line);
    if (!m) return false;
    const pn = this.ws.panes;
    const cmd = m[1];
    const arg = m[2].trim();
    if (cmd.startsWith('vs')) pn.runWin('vsplit', { arg });
    else if (cmd.startsWith('sp')) pn.runWin('split', { arg });
    else if (cmd.startsWith('on')) pn.runWin('only');
    else if (cmd.startsWith('zo')) pn.runWin('zoom');
    else if (cmd.startsWith('clo') || cmd === 'q' || cmd === 'quit') pn.runWin('close');
    else if (cmd.startsWith('book')) this.ws.explorer.openBooks();
    else this.ws.explorer.open();
    return true;
  };

  // ---- context menu (the open note) -----------------------------------------

  private openMenu(x: number, y: number, entry: Entry | null): void {
    const items = menuFor(entry, { offline: this.ws.structuralOffline, canPaste: !!this.ws.explorer.yanked, reader: true });
    const title = entry ? (entry.kind === 'note' ? (entry.note.title ?? entry.name) : entry.name + '/') : (vaults.selected?.name ?? 'book');
    this.menu = { x, y, items, entry, title };
  }

  onReaderContext = (ev: MouseEvent): void => {
    const t = ev.target as HTMLElement | null;
    // Keep the browser menu on links, images, selections and fields.
    if (this.ws.pane !== 'note' || this.ws.edit.mode || t?.closest('a, img, input, textarea, [contenteditable]') || window.getSelection?.()?.toString()) return;
    const entry = noteEntryFor(notes.selected);
    if (!entry) return;
    ev.preventDefault();
    this.openMenu(ev.clientX, ev.clientY, entry);
  };

  openMenuAtCursor(): void {
    if (this.ws.pane !== 'note') return;
    const entry = noteEntryFor(notes.selected);
    const r = this.ws.readerEl()?.getBoundingClientRect();
    if (entry) this.openMenu((r?.left ?? 0) + 48, (r?.top ?? 0) + 48, entry);
  }

  runMenu = (it: MenuItem): void => {
    switch (it.action) {
      case 'copyLink': {
        const e = this.menu?.entry ?? noteEntryFor(notes.selected);
        if (e?.kind === 'note') this.ws.copyLinkTo(e, notes.selected?.path ?? '');
        return;
      }
      case 'newFolder':
        this.ws.explorer.beginNewFolder();
        return;
      default:
        this.runAction({ kind: it.action } as ShellAction);
    }
  };
}
