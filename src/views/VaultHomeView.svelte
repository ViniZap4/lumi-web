<script lang="ts">
  // The book shell. The floating explorer (SPEC-PARTE2 §2) is the only
  // navigation: there is no explorer column and no books sidebar. A
  // book opens on its last note (per book, per device) or on a calm
  // empty home with the explorer floating on top; `-`, <leader>e,
  // :explore, the top bar's Explorer button and the palette open it;
  // `gb` / the book button open it at the books level.
  import { onMount, onDestroy, untrack, tick } from 'svelte';
  import { vaults } from '../lib/vaults.svelte.ts';
  import { notes } from '../lib/notes.svelte.ts';
  import { renderBlocks, taskToggle, startsWithTitle } from '../lib/markdown.ts';
  import { keyLabel } from '../lib/platform.ts';
  import { ApiError, type NoteSummary } from '../lib/types.ts';
  import * as api from '../lib/api.ts';
  import { offline, bundleMarkdown, downloadText, exportFilename } from '../lib/offline.svelte.ts';
  import { flushPending, toggleTaskHeadless, acquireEditorSession, editorPool } from '../lib/editor-boot.ts';
  import type { ConflictCopy } from '../lib/offline-store.ts';
  import { uiState } from '../lib/uistate.svelte.ts';
  import { books } from '../lib/books.svelte.ts';
  import { sync } from '../lib/sync.svelte.ts';
  import { serverLabel } from '../lib/serverurl.ts';
  import { isEditableTarget } from '../lib/shortcuts.ts';
  import { ShellKeymap, CHORD_TIMEOUT_MS, type ShellAction } from '../lib/shell-keymap.ts';
  import type { MillerNav } from '../lib/miller.svelte.ts';
  import { dirOf, normalizePath, type Entry, type NoteEntry } from '../lib/notetree.ts';
  import { movedPath, copyTitle } from '../lib/fileops.ts';
  import { markdownLink } from '../lib/links.ts';
  import { legendFor, contextForVimMode, type LegendContext, type LegendItem } from '../lib/legend.ts';
  import { PaneKeys, paneLayout, paneTarget, panesOf, fallsThroughWithoutTarget, PANE_CHORD_MS, type PaneId, type PaneDir, type WinCmd } from '../lib/pane-nav.ts';
  import {
    single, splitPane, closePane, equalize, setNote, setView, focus as focusLeafState, resizeSplit, nudgePane,
    neighbor, cycle, leaves, findLeaf, paneCount, parsePaneState, pruneNotes, newPaneId,
    type PaneState, type PaneLeaf, type SplitDir,
  } from '../lib/pane-tree.ts';
  import { classifyLink, whereFromClick, type OpenWhere, type LinkAt } from '../lib/link-open.ts';
  import { HoverIntent, type HoverTarget } from '../lib/hover-preview.ts';
  import { formatDeepLink } from '../lib/deeplink.ts';
  import { resolveView, viewsFor, MARKDOWN_VIEW } from '../lib/note-views.ts';
  import { registerStructuredViews } from '../lib/structured-views.ts';
  // Kanban boards and JSON canvases render through the note-view registry.
  registerStructuredViews();
  import { MAC } from '../lib/platform.ts';
  import { linkCandidates } from '../lib/links.ts';
  import { PreviewKeymap, type PreviewAction } from '../lib/preview-keys.ts';
  import { menuFor, type MenuItem } from '../lib/context-actions.ts';
  import { focusPane } from '../lib/view-focus.ts';
  import { structuredFocus } from '../lib/structured-mode.svelte.ts';
  import { noteIconKind } from '../lib/note-icons.ts';
  import NoteIcon from '../components/NoteIcon.svelte';
  import { withViewTransition, sharedTransition, animate, scrollBehavior, SPRING, motionAllowed } from '../lib/motion.ts';
  import { installPaneClickFocus } from '../lib/pane-click.ts';
  import { dropSide, noteIdOfKey, NOTE_DRAG_TYPE, type DropTarget } from '../lib/pane-drop.ts';
  import { toasts } from '../lib/toasts.svelte.ts';
  import ToastStack from '../components/ToastStack.svelte';
  import ModePill from '../components/ModePill.svelte';
  import { effectiveSettings, appliedMappings, LEADER_TOKEN } from '../lib/vim-config.ts';
  import { selectorOrder } from '../lib/books-model.ts';
  import { rememberLastNote, lastNote, planBookOpen, recentNotes, NoteHistory } from '../lib/book-home.ts';
  import { peekNote } from '../lib/note-content.ts';
  import { updatedLabel } from '../lib/hover-preview.ts';
  import type { PaletteCommand } from '../lib/palette.ts';
  import VaultSettingsModal from '../components/VaultSettingsModal.svelte';
  import VaultCreateModal from '../components/VaultCreateModal.svelte';
  import SyncStatusPopover from '../components/SyncStatusPopover.svelte';
  import SyncDot from '../components/SyncDot.svelte';
  import CommandLegend from '../components/CommandLegend.svelte';
  import CommandPalette from '../components/CommandPalette.svelte';
  import HelpOverlay from '../components/HelpOverlay.svelte';
  import MarkdownView from '../components/MarkdownView.svelte';
  import SourceSplit from '../components/SourceSplit.svelte';
  import { noteViewKind } from '../lib/note-kind.ts';
  import ContextMenu from '../components/ContextMenu.svelte';
  import HintOverlay from '../components/HintOverlay.svelte';
  import PaneTree from '../components/PaneTree.svelte';
  import NotePane from '../components/NotePane.svelte';
  import NoteViewHost from '../components/NoteViewHost.svelte';
  import HoverCard from '../components/HoverCard.svelte';
  import FloatingExplorer, { type FxOps, type FxPrompt, type FxPlan, type FxLevel, type FxInitial } from '../components/FloatingExplorer.svelte';
  import { editorSettings } from '../lib/editor-settings.svelte.ts';
  import { countWords, readingTime, type EditorStats } from '../lib/textstats.ts';

  let showSettings = $state(false);
  // Editor + Yjs runtime is lazy-loaded on first edit; types stay
  // static so the rest of the view keeps its existing typing.
  import type { EditorSession as EditorSessionT } from '../lib/editor-session.svelte.ts';

  type NoteEditorComp = typeof import('../components/NoteEditor.svelte').default;

  /** 'home' = the book's calm empty home; 'note' = a note (reader,
   *  editor or a split layout) fills the stage. */
  let pane = $state<'home' | 'note'>('home');
  let previewEl = $state<HTMLElement | null>(null);
  let homeEl = $state<HTMLElement | null>(null);
  const noteHistory = new NoteHistory();

  // ---- keymap + legend state ----------------------------------------------
  const keymap = new ShellKeymap();
  let shellPending = $state<string | null>(null);
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;
  let vimState = $state<{ mode: string; pending: string | null; sub?: string | null }>({ mode: 'normal', pending: null });
  let paletteMode = $state<null | 'all' | 'command'>(null);
  let hintsOpen = $state(false);
  let menu = $state<{ x: number; y: number; items: MenuItem[]; entry: Entry | null; title: string } | null>(null);
  let rootEl = $state<HTMLElement | null>(null);
  let noteEditorRef = $state<{ editorView(): import('@codemirror/view').EditorView | null; run(a: string): boolean; gotoLine(n: number): void; focus(): void } | null>(null);
  let splitRef = $state<{ focusPreview(): Promise<boolean>; revealSource(): void; previewElement(): HTMLElement | null; topLine(): number | null; run(a: PreviewAction): boolean; clearFind(): boolean } | null>(null);
  /** Hint mode scope (the split preview's `f` labels only its links). */
  let hintRoot = $state<(() => HTMLElement | null) | null>(null);

  // ---- panes (Ctrl-h/j/k/l, Ctrl-w h/j/k/l/w/p) ------------------------------
  const paneKeys = new PaneKeys();
  const previewKeys = new PreviewKeymap();
  let focusedPane = $state<PaneId | null>(null);
  let prevPane: PaneId | null = null;
  let panePending = $state(false);
  let previewPending = $state<string | null>(null);
  let narrowView = $state(false);
  let splitNarrow = $state(false);

  /** Short notices slide in as stacked toasts (lib/toasts). */
  function flash(text: string, tone: 'info' | 'warn' | 'error' = 'info'): void {
    toasts.push(text, tone);
  }

  // Slice 4.4 — Yjs+CM6 editor session. EditorSession owns the Y.Doc
  // and provider; reactive `status` + `peers` flow into the bar.
  // Slice 4.6 — the editor module + Yjs runtime are split into an
  // async chunk; module references are cached after the first load.
  let editMode = $state(false);
  let editSession = $state<EditorSessionT | null>(null);
  let editError = $state<string | null>(null);
  let saving = $state(false);
  let editorLoading = $state(false);
  let NoteEditor = $state<NoteEditorComp | null>(null);
  let editorStats = $state<EditorStats | null>(null);
  /** Transient hint for actions that need the network. */
  let offlineHint = $state<string | null>(null);
  let hintTimer: ReturnType<typeof setTimeout> | null = null;
  const OFFLINE_HINT = 'Indisponível offline: criar, renomear e apagar notas precisam do servidor.';
  const structuralOffline = $derived(sync.isOffline(books.active));

  // Conflict copies (lineage mismatch / deleted note) of this book.
  $effect(() => {
    const vid = vaults.selectedID;
    untrack(() => void offline.watchConflicts(vid));
  });
  const noteConflicts = $derived(offline.conflicts.filter((c) => c.noteID === notes.selectedID));
  // Copies of notes that no longer exist cannot be reached through a
  // note: list them at the book level.
  const orphanConflicts = $derived(
    notes.stale || notes.loadingList ? [] : offline.conflicts.filter((c) => !notes.list.some((n) => n.id === c.noteID)),
  );

  // Lineage mismatch: the session refused to merge its replica (now a
  // conflict copy) and stopped. Rebuild a fresh session — the replica
  // is gone, so it joins empty and adopts the server's history.
  $effect(() => {
    const c = editSession?.lineageConflict;
    if (!c) return;
    untrack(() => {
      exitEdit();
      void enterEdit();
    });
  });

  // Push replicas of this book that still hold unsent edits (closed
  // notes edited offline) once the network is back.
  $effect(() => {
    const vid = vaults.selectedID;
    if (!vid || structuralOffline) return;
    const open = editSession?.noteID ?? null;
    if (offline.pendingNotes(vid, open).length === 0) return;
    untrack(() => void flushPending(vid, open));
  });

  function exportConflict(c: ConflictCopy): void {
    downloadText(exportFilename([{ vaultID: c.vaultID, noteID: c.noteID, title: c.title, text: c.text }]), c.text);
  }

  async function copyConflict(c: ConflictCopy): Promise<void> {
    try {
      await navigator.clipboard.writeText(c.text);
    } catch {
      exportConflict(c);
    }
  }

  function exportAllConflicts(list: ConflictCopy[]): void {
    const items = list.map((c) => ({ vaultID: c.vaultID, noteID: c.noteID, title: c.title, text: c.text }));
    if (items.length) downloadText(exportFilename(items), bundleMarkdown(items));
  }

  // Reset edit state whenever the focused note changes. ONLY
  // notes.selectedID is a dependency: the body runs untracked, because
  // reading editMode/editSession here (directly or via exitEdit) made
  // the effect re-run when enterEdit flipped editMode — cancelling the
  // edit the instant it started.
  let lastSelectedID: string | null = untrack(() => notes.selectedID);
  $effect(() => {
    const id = notes.selectedID;
    untrack(() => {
      if (id === lastSelectedID) return;
      lastSelectedID = id;
      if (editSession && editSession.noteID !== id) exitEdit();
      editError = null;
    });
  });

  /** The book whose opening (last note / home) was decided. */
  let plannedFor = $state<string | null>(null);

  // Hydrate notes whenever the active vault changes. The notes store
  // is idempotent on a no-op vaultID transition so this is safe. The
  // full list fetched here is the book's catch-up baseline (cursor =
  // the head known now; later heads trigger GET /changes).
  $effect(() => {
    const vid = vaults.selectedID;
    untrack(() => {
      if (notes.vaultID !== vid) {
        pane = 'home';
        fx = null;
        fxDir = '';
        yanked = null;
        panes = null;
        plannedFor = null;
        noteHistory.reset();
      }
      if (editSession && editSession.vaultID !== vid) exitEdit();
      const b = vid ? books.bookForVault(vid) : null;
      if (b && notes.vaultID !== vid) sync.onBookOpened(b);
      void notes.openVault(vid);
    });
  });

  // The book was revoked (vault.revoked / gone from the list): close
  // the editor (SPEC-LIVROS §3.3).
  const activeRevoked = $derived(books.active ? (books.revoked[books.active.id] ?? null) : null);
  const activeStatus = $derived(books.active ? sync.statusOf(books.active) : null);
  $effect(() => {
    if (activeRevoked) untrack(() => exitEdit());
  });

  // A note that no longer exists (deleted here or elsewhere) returns to
  // the book's home.
  $effect(() => {
    if (pane === 'note' && !notes.selectedID) untrack(() => (pane = 'home'));
  });
  // A note selected from elsewhere (just created, a store-level select)
  // opens: the home never sits on top of a selected note.
  $effect(() => {
    if (pane === 'home' && notes.selectedID) untrack(() => (pane = 'note'));
  });

  // The last opened note, per book, per device.
  $effect(() => {
    const vid = vaults.selectedID;
    const id = pane === 'note' ? notes.selectedID : null;
    if (!vid || !id || plannedFor !== vid) return;
    untrack(() => rememberLastNote(vid, id));
  });

  onMount(() => {
    window.addEventListener('keydown', handleKey);
    window.addEventListener('focusin', onFocusIn);
    // First click/tap in a pane focuses it AND acts (SPEC-PARTE2 §3).
    const offClick = rootEl
      ? installPaneClickFocus(rootEl, {
          activate: (leaf) => {
            if (panes && panes.active !== leaf && findLeaf(panes.root, leaf)) panes = focusLeafState(panes, leaf);
            if (leaf !== primaryLeaf && multi) focusedPane = 'leaf';
          },
          focus: (leaf) => focusLeaf(leaf),
        })
      : () => {};
    let mq: MediaQueryList | null = null;
    const onmq = () => (narrowView = !!mq?.matches);
    try {
      mq = window.matchMedia('(max-width: 720px)');
      onmq();
      mq.addEventListener?.('change', onmq);
    } catch {
      /* jsdom */
    }
    return () => {
      offClick();
      window.removeEventListener('keydown', handleKey);
      window.removeEventListener('focusin', onFocusIn);
      mq?.removeEventListener?.('change', onmq);
    };
  });

  /** Which pane holds keyboard focus (click focuses panes too). */
  function onFocusIn(e: FocusEvent): void {
    const leafEl = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-leaf]') : null;
    if (leafEl?.dataset.leaf && panes && panes.active !== leafEl.dataset.leaf) panes = focusLeafState(panes, leafEl.dataset.leaf);
    const el = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-pane]') : null;
    const p = (el?.dataset.pane as PaneId | undefined) ?? null;
    if (!p || p === focusedPane) return;
    prevPane = focusedPane;
    focusedPane = p;
    previewKeys.reset();
    previewPending = null;
  }

  const layout = $derived(
    paneLayout({
      splitNarrow,
      editing: editMode && !!editSession,
      split: editMode && editorSettings.value.editMode === 'source' && editorSettings.value.previewSplit && !!editSession?.editable,
      mainHasNote: pane === 'note' && !!notes.selectedID && !!notes.content,
    }),
  );
  /** The focused pane when it is on screen; else the pane the current
   *  mode implies. */
  const activePane: PaneId = $derived.by(() => {
    if (focusedPane === 'leaf' && activeIsSecondary) return 'leaf';
    if (focusedPane && panesOf(layout).includes(focusedPane)) return focusedPane;
    if (editMode && editSession) return 'editor';
    return 'main';
  });

  /** Move focus `dir`; false when no pane lies that way. With several
   *  note panes, h/j/k/l follow the pane tree's geometry; the editor |
   *  preview pair of the primary pane moves inside first. */
  function navigatePane(dir: PaneDir): boolean {
    // Moving to another pane unzooms first (tmux).
    if (zoomed) setZoom(null, false);
    if (multi && panes) return navigateTree(dir);
    const from = activePane;
    const to = paneTarget(layout, from, dir, prevPane);
    if (!to || to === from) return false;
    void focusPaneEl(to, from);
    return true;
  }

  function navigateTree(dir: PaneDir): boolean {
    const t = panes!;
    const cur = activeLeafId;
    if (dir === 'w' || dir === 'p') {
      const to = dir === 'w' ? cycle(t, cur, 1) : (prevLeaf && findLeaf(t.root, prevLeaf) ? prevLeaf : null);
      if (!to || to === cur) return false;
      prevLeaf = cur;
      focusLeaf(to);
      return true;
    }
    // Inside the primary pane: editor ⇄ split preview first.
    if (!activeIsSecondary && editMode && editSession && (dir === 'h' || dir === 'l')) {
      const inner = activePane;
      if (dir === 'l' && inner === 'editor' && layout.order.includes('split')) return void focusPaneEl('split', 'editor'), true;
      if (dir === 'h' && inner === 'split') return void focusPaneEl('editor', 'split'), true;
    }
    const to = neighbor(t, cur, dir);
    if (!to) return false;
    prevLeaf = cur;
    focusLeaf(to, dir);
    return true;
  }
  let prevLeaf: string | null = null;

  async function focusPaneEl(to: PaneId, from: PaneId | null = activePane): Promise<void> {
    switch (to) {
      case 'main':
        focusPane(readerEl());
        return;
      case 'split':
        await splitRef?.focusPreview();
        return;
      case 'editor': {
        splitRef?.revealSource();
        await tick();
        if (from === 'split' && editorSettings.value.previewCursorSync) {
          const line = splitRef?.topLine();
          if (line != null) noteEditorRef?.gotoLine(line);
        }
        noteEditorRef?.focus();
        return;
      }
    }
  }

  onDestroy(() => {
    if (hintTimer) clearTimeout(hintTimer);
    if (pendingTimer) clearTimeout(pendingTimer);
    hoverIntent.cancel();
    void offline.watchConflicts(null);
    // Tear the editor session down (socket + Y.Doc) — e.g. on logout
    // App.svelte unmounts this view while an editor is open.
    if (editSession) {
      sync.setEditor(editSession.vaultID, null);
      editorPool.release(editSession);
      editSession = null;
    }
    // Drop the per-vault cache so the next vault load starts clean.
    void notes.openVault(null);
  });

  function overlayOpen(): boolean {
    return !!(uiState.accountModal || uiState.createBookOpen || showSettings || uiState.settings || uiState.helpOpen || uiState.themePickerOpen || paletteMode || hintsOpen || menu || fx || hover?.keyboard);
  }

  function syncPending(): void {
    shellPending = keymap.pending;
    if (pendingTimer) clearTimeout(pendingTimer);
    if (shellPending && keymap.chord) {
      pendingTimer = setTimeout(() => (shellPending = keymap.pending), CHORD_TIMEOUT_MS + 20);
    }
  }

  function handleKey(e: KeyboardEvent): void {
    // Cmd/Ctrl+S: refresh after the live save, regardless of focus.
    if (editMode && (e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      void saveEdit();
      return;
    }

    // A hover card shown by the pointer: Esc dismisses it.
    if (hover && !hover.keyboard && e.key === 'Escape') {
      e.preventDefault();
      closeHover();
      return;
    }

    if (overlayOpen()) return;

    // A component (CodeMirror/vim, a form control, a board / canvas)
    // already handled it — including the second key of a Ctrl-w chord
    // (canvas Ctrl-w f), so the shell's chord ends too.
    if (e.defaultPrevented) {
      if (paneKeys.pending) {
        paneKeys.reset();
        panePending = false;
      }
      return;
    }
    // A task checkbox (focused by a click or a hint) is not text entry:
    // the reader keys keep working around it.
    const taskBox = (e.target as HTMLElement | null)?.matches?.('input[type="checkbox"][data-task]') ?? false;
    if (isEditableTarget(e.target) && !taskBox) return;

    // Pane navigation: Ctrl-h/j/k/l, Ctrl-w h/j/k/l/w/p. (The editor
    // routes its own, vim-mode aware, see NoteEditor.)
    const pk = paneKeys.feed(e, { ctrlHjkl: editorSettings.value.paneNav });
    panePending = paneKeys.pending;
    if (pk) {
      if (pk.kind === 'win') {
        e.preventDefault();
        runWin(pk.cmd);
        return;
      }
      if (pk.kind !== 'nav' || navigatePane(pk.dir) || !fallsThroughWithoutTarget(pk)) {
        e.preventDefault();
        return;
      }
    }

    // The split preview, focused, is a keyboard reader.
    if (editMode && activePane === 'split') {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K' || e.key === 'e' || e.key === 'E')) {
        // fall through to the palette / reading toggles below
      } else {
        handlePreviewKey(e);
        return;
      }
    }

    // Cmd/Ctrl+K: palette (in the editor CodeMirror takes it for links).
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      paletteMode = 'all';
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
      if (editMode) {
        e.preventDefault();
        exitEdit();
        return;
      }
      const target = noteUnderFocus();
      if (target) {
        e.preventDefault();
        void editNote(target);
      }
      return;
    }

    // In edit mode, leaving is an explicit command only (Done button,
    // Mod-Enter, Mod-E, vim :q) — never a stray Esc.
    if (editMode && activePane !== 'leaf') return;

    // Enter / Space on a focused button or link keep their meaning.
    const t = e.target as HTMLElement | null;
    if ((e.key === 'Enter' || e.key === ' ') && t?.matches?.('button, a[href], [role="button"]')) return;

    const action = keymap.feed(e, 'reader');
    syncPending();
    if (!action) return;
    e.preventDefault();
    if (action.kind === 'pending') return;
    runAction(action);
  }

  function handlePreviewKey(e: KeyboardEvent): void {
    const t = e.target as HTMLElement | null;
    // Tab / Enter on a focused link or button keep their native meaning.
    if (e.key === 'Tab') return;
    const a = previewKeys.feed(e);
    previewPending = previewKeys.pending;
    if (!a) return;
    if (a.kind === 'open' && !(t && t.matches('a[href], button, input[data-task]'))) return;
    e.preventDefault();
    if (a.kind === 'pending') return;
    switch (a.kind) {
      case 'back':
        if (e.key === 'Escape' && splitRef?.clearFind()) return;
        void focusPaneEl('editor', 'split');
        return;
      case 'hints':
        hintRoot = () => splitRef?.previewElement() ?? null;
        hintsOpen = true;
        return;
      case 'yank':
        void copyPreviewText();
        return;
      case 'help':
        uiState.helpOpen = true;
        return;
      case 'command':
        paletteMode = 'command';
        return;
      case 'floatExplorer':
        openFloating();
        return;
      case 'hover':
        hoverKey(readerLinkTarget(), null, leafPath(primaryLeaf));
        return;
      case 'follow': {
        const l = readerLinkTarget();
        if (l) followLink(l.href, 'current', leafPath(primaryLeaf));
        return;
      }
      default:
        splitRef?.run(a);
    }
  }

  async function copyPreviewText(): Promise<void> {
    const sel = window.getSelection?.()?.toString();
    const text = sel || editSession?.ytext.toString() || notes.content?.body || '';
    try {
      await navigator.clipboard.writeText(text);
      flash(sel ? 'copied selection' : 'copied note text');
    } catch {
      flash('clipboard unavailable', 'warn');
    }
  }

  /** The note an action applies to: the open note, if any. */
  function noteUnderFocus(): string | null {
    return pane === 'note' ? notes.selectedID : null;
  }

  /** Reader keys in a secondary pane; false = not pane-specific. */
  function runLeafAction(a: ShellAction): boolean {
    const h = paneRefs[activeLeafId];
    if (!h) return false;
    switch (a.kind) {
      case 'edit': void h.enterEdit(); return true;
      case 'close': closeLeaf(activeLeafId); return true;
      case 'yank': {
        const el = h.element()?.querySelector('.md-body');
        const sel = window.getSelection?.()?.toString();
        void navigator.clipboard?.writeText(sel || el?.textContent || '').then(() => flash(sel ? 'copied selection' : 'copied note text'), () => flash('clipboard unavailable', 'warn'));
        return true;
      }
      case 'rename':
      case 'open':
        return true;
      default:
        return false;
    }
  }

  function runAction(a: ShellAction): void {
    if (activePane === 'leaf' && runLeafAction(a)) return;
    const home = pane === 'home';
    switch (a.kind) {
      case 'move':
        if (home) homeMove(a.n);
        else scrollNote(60 * a.n);
        return;
      case 'halfPage':
        if (home) homeMove(a.dir * 4);
        else scrollNote(a.dir > 0 ? 'half' : '-half');
        return;
      case 'page':
        if (home) homeMove(a.dir * 8);
        else scrollNote(a.dir > 0 ? 'page' : '-page');
        return;
      case 'top':
        if (home) homeFocus(0);
        else scrollNote('top');
        return;
      case 'bottom':
        if (home) homeFocus(recents.length - 1);
        else scrollNote('bottom');
        return;
      // h / ← / ⌫ / -: the explorer, at this note (vim-vinegar's `-`).
      case 'parent':
      case 'floatExplorer':
        openFloating();
        return;
      case 'open':
        if (home) openFloating();
        return;
      case 'historyBack':
      case 'historyForward': {
        const id = a.kind === 'historyBack' ? noteHistory.goBack() : noteHistory.goForward();
        if (id) openIn(id, 'current', primaryLeaf, { history: false });
        else flash(a.kind === 'historyBack' ? 'no earlier note' : 'no later note');
        return;
      }
      case 'home':
        openFloating({ root: true });
        return;
      case 'filter':
        openFloating({ initial: 'filter' });
        return;
      case 'close':
        if (!home) closeLeaf();
        return;
      case 'clearOrBack':
        return;
      case 'create':
        beginCreate();
        return;
      case 'rename':
        beginRename();
        return;
      case 'delete':
        beginDelete();
        return;
      case 'yank':
        if (!home) void copyNoteText();
        return;
      case 'paste':
        openFloating({ initial: 'paste' });
        return;
      case 'refresh':
        void notes.refresh();
        flash('refreshing…');
        return;
      case 'edit': {
        const target = noteUnderFocus();
        if (target && editMode && editSession?.noteID === target) void focusPaneEl('editor');
        else if (target) void editNote(target);
        else if (home) openFloating();
        return;
      }
      case 'palette':
        paletteMode = 'all';
        return;
      case 'command':
        paletteMode = 'command';
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
        openBooks();
        return;
      case 'prevBook':
      case 'nextBook':
        cycleBook(a.kind === 'nextBook' ? 1 : -1);
        return;
      case 'hints':
        hintRoot = null;
        hintsOpen = true;
        return;
      case 'menu':
        openMenuAtCursor();
        return;
      case 'hover':
        hoverKey(readerLinkTarget(), null, leafPath());
        return;
      case 'follow': {
        const l = readerLinkTarget();
        if (!l) return flash('no link to follow — Tab to one, or f for hints', 'warn');
        followLink(l.href, 'current', leafPath());
        return;
      }
    }
  }

  function cycleBook(dir: 1 | -1): void {
    const order = selectorOrder(books.list);
    if (order.length < 2) return;
    const i = Math.max(0, order.findIndex((b) => b.id === books.activeID));
    books.setActive(order[(i + dir + order.length) % order.length].id);
  }

  // ---- the book's home ------------------------------------------------------

  const recents = $derived(recentNotes(notes.list, 8));
  let homeIndex = $state(-1);

  function homeFocus(i: number): void {
    if (recents.length === 0) return;
    homeIndex = Math.max(0, Math.min(recents.length - 1, i));
    homeEl?.querySelector<HTMLElement>(`[data-recent="${homeIndex}"]`)?.focus({ preventScroll: false });
  }

  function homeMove(d: number): void {
    const a = document.activeElement as HTMLElement | null;
    const at = a?.dataset?.recent != null ? Number(a.dataset.recent) : homeIndex;
    homeFocus(at < 0 ? (d > 0 ? 0 : recents.length - 1) : at + d);
  }

  /** Close the open note: back to the book's home. */
  function closeNote(): void {
    if (editMode) exitEdit();
    const vid = vaults.selectedID;
    if (vid) rememberLastNote(vid, null);
    void withViewTransition(async () => {
      pane = 'home';
      panes = null;
      await tick();
    });
    void notes.select(null);
    homeIndex = -1;
    void tick().then(() => homeEl?.focus({ preventScroll: true }));
  }

  // ---- opening notes ----------------------------------------------------------

  function openNote(id: string, o: OpenOpts = {}): void {
    openIn(id, 'current', primaryLeaf, o);
  }

  function scrollNote(by: number | 'top' | 'bottom' | 'half' | '-half' | 'page' | '-page'): void {
    if (activeIsSecondary) return paneRefs[activeLeafId]?.scroll(by);
    const el = readerEl();
    if (!el) return;
    const h = el.clientHeight;
    const smooth = (top: number) => {
      if (typeof el.scrollTo === 'function') el.scrollTo({ top, behavior: scrollBehavior() });
      else el.scrollTop = top;
    };
    if (by === 'top') smooth(0);
    else if (by === 'bottom') smooth(el.scrollHeight);
    else if (by === 'half') smooth(el.scrollTop + h / 2);
    else if (by === '-half') smooth(el.scrollTop - h / 2);
    else if (by === 'page') smooth(el.scrollTop + h * 0.9);
    else if (by === '-page') smooth(el.scrollTop - h * 0.9);
    else el.scrollTop += by;
  }

  async function editNote(id: string): Promise<void> {
    if (notes.selectedID !== id) {
      noteHistory.visit(id);
      await notes.select(id);
    }
    if (notes.selectedID !== id) return;
    pane = 'note';
    await enterEdit();
  }

  // ---- file operations (run by the floating explorer) ---------------------------

  function errText(e: unknown): string {
    return e instanceof ApiError ? (e.detail ?? e.code) : (e as Error).message;
  }

  function beginCreate(): void {
    if (structuralOffline) return showOfflineHint();
    openFloating({ initial: 'create' });
  }

  /** `a` prompt prefilled with `.canvas` (POST kind:"canvas"). */
  function beginCreateCanvas(): void {
    if (structuralOffline) return showOfflineHint();
    openFloating({ initial: 'createCanvas' });
  }

  function beginRename(): void {
    if (structuralOffline) return showOfflineHint();
    openFloating({ initial: 'rename' });
  }

  function beginDelete(): void {
    if (structuralOffline) return showOfflineHint();
    openFloating({ initial: 'delete' });
  }

  function showOfflineHint(): void {
    offlineHint = OFFLINE_HINT;
    if (hintTimer) clearTimeout(hintTimer);
    hintTimer = setTimeout(() => (offlineHint = null), 4000);
  }

  /** POST (always at the book root), then PATCH the path into `folder`. */
  async function createNoteIn(n: MillerNav, title: string, folder: string, body = '', kind?: 'canvas'): Promise<void> {
    const created = await notes.create(kind ? { title, body, kind } : { title, body });
    if (!created) return;
    let final = created;
    if (folder) {
      const file = normalizePath(created.path || created.id + '.md').split('/').pop()!;
      final = (await notes.patch(created.id, { path: `${folder}/${file}` })) ?? created;
      n.removeFolder(folder); // real now
    }
    n.reveal(final.id);
  }

  async function moveFolder(from: string, to: string, ex: MillerNav): Promise<void> {
    if (ex.extraDirs.has(from) && !notes.list.some((n) => movedPath(n.path, from, to))) {
      ex.removeFolder(from);
      ex.addFolder(to);
      ex.goTo(dirOf(to), 'd:' + to);
      return;
    }
    const moves = notes.list
      .map((n) => ({ n, path: movedPath(n.path || n.id + '.md', from, to) }))
      .filter((m): m is { n: (typeof notes.list)[number]; path: string } => m.path != null);
    let done = 0;
    for (const m of moves) {
      flash(`moving ${++done}/${moves.length}…`);
      await notes.patch(m.n.id, { path: m.path });
    }
    ex.goTo(dirOf(to), 'd:' + to);
    flash(`moved ${moves.length} ${moves.length === 1 ? 'note' : 'notes'} to ${to}/`);
  }

  async function copyNoteText(): Promise<void> {
    const sel = window.getSelection?.()?.toString();
    const text = sel || notes.content?.body || '';
    try {
      await navigator.clipboard.writeText(text);
      flash(sel ? 'copied selection' : 'copied note text');
    } catch {
      flash('clipboard unavailable', 'warn');
    }
  }

  function copyLinkTo(e: NoteEntry, fromPath: string): void {
    const link = markdownLink(e.note.title ?? e.name, fromPath, e.note.path || e.note.id + '.md');
    void navigator.clipboard?.writeText(link).then(() => flash('copied ' + link), () => flash('clipboard unavailable', 'warn'));
  }

  // ---- links -----------------------------------------------------------------

  /** Open a relative note link from the open note (Live Preview
   *  Mod-click without a pane router). */
  function openLinkedNote(href: string): void {
    followLink(href, 'current', leafPath(primaryLeaf), false, primaryLeaf);
  }

  /** Link clicks inside the primary pane's rendered markdown (reader,
   *  split preview). In-note `#` anchors are handled by MarkdownView. */
  function onMdLink(href: string, e: MouseEvent): void {
    routeClick(href, e, leafPath(primaryLeaf), primaryLeaf);
  }

  // ---- tasks ---------------------------------------------------------------------

  /** Reader: toggle a task without opening the editor — a headless
   *  live session applies the single-character ranged change. The
   *  checkbox flips immediately; a failure reverts it. */
  async function toggleTaskFromReader(index: number): Promise<void> {
    const vid = vaults.selectedID;
    const id = notes.selectedID;
    const body = notes.content?.body ?? '';
    if (!vid || !id) return;
    const ch = taskToggle(body, index);
    if (!ch) return;
    notes.applyLocalBody(id, body.slice(0, ch.from) + ch.insert + body.slice(ch.to));
    const r = await toggleTaskHeadless(vid, id, index);
    if ('error' in r) {
      if (notes.selectedID === id) notes.applyLocalBody(id, body);
      flash(r.error, 'warn');
    } else if (notes.selectedID === id) {
      notes.applyLocalBody(id, r.text);
    }
  }

  /** Split preview: the editor owns the doc — dispatch the 1-char
   *  change through CodeMirror (y-codemirror turns it into a ranged
   *  Y.Text op). */
  function toggleTaskInEditor(index: number): void {
    const v = noteEditorRef?.editorView();
    if (!v) return;
    const ch = taskToggle(v.state.doc.toString(), index);
    if (ch) v.dispatch({ changes: ch, userEvent: 'input.toggle-task' });
  }

  // ---- context menu (the open note) ----------------------------------------------

  function entryFor(n: NoteSummary | null | undefined): NoteEntry | null {
    if (!n) return null;
    const path = normalizePath(n.path || n.id + '.md');
    return { kind: 'note', key: 'n:' + n.id, name: n.title ?? path.split('/').pop() ?? n.id, path, note: n };
  }

  function openMenu(x: number, y: number, entry: Entry | null): void {
    const items = menuFor(entry, { offline: structuralOffline, canPaste: !!yanked, reader: true });
    const title = entry ? (entry.kind === 'note' ? (entry.note.title ?? entry.name) : entry.name + '/') : (vaults.selected?.name ?? 'book');
    menu = { x, y, items, entry, title };
  }

  function onReaderContext(ev: MouseEvent): void {
    const t = ev.target as HTMLElement | null;
    // Keep the browser menu on links, images, selections and fields.
    if (pane !== 'note' || editMode || t?.closest('a, img, input, textarea, [contenteditable]') || window.getSelection?.()?.toString()) return;
    const entry = entryFor(notes.selected);
    if (!entry) return;
    ev.preventDefault();
    openMenu(ev.clientX, ev.clientY, entry);
  }

  function openMenuAtCursor(): void {
    if (pane !== 'note') return;
    const entry = entryFor(notes.selected);
    const r = readerEl()?.getBoundingClientRect();
    if (entry) openMenu((r?.left ?? 0) + 48, (r?.top ?? 0) + 48, entry);
  }

  function runMenu(it: MenuItem): void {
    switch (it.action) {
      case 'copyLink': {
        const e = menu?.entry ?? entryFor(notes.selected);
        if (e?.kind === 'note') copyLinkTo(e, notes.selected?.path ?? '');
        return;
      }
      case 'newFolder':
        if (structuralOffline) return showOfflineHint();
        openFloating({ initial: 'newFolder' });
        return;
      default:
        runAction({ kind: it.action } as ShellAction);
    }
  }

  // ---- panes: splits of notes (SPEC-PARTE2 §3) ------------------------------
  //
  // The note area is a tree of panes (lib/pane-tree.ts). `panes` is null
  // while there is a single pane (the classic reader/editor). The
  // *primary* leaf renders the open note (notes.selected + this view's
  // editor session); every other leaf is a NotePane with its own note,
  // reader and editor. Live sessions are shared through editorPool, so
  // two panes on one note edit one Y.Doc. A pane renders the note view
  // its kind picks (lib/note-views.ts): markdown, kanban, canvas.

  type NotePaneHandle = {
    focus(): void;
    scroll(by: number | 'top' | 'bottom' | 'half' | '-half' | 'page' | '-page'): void;
    enterEdit(): Promise<void>;
    exitEdit(): void;
    isEditing(): boolean;
    element(): HTMLElement | null;
    notePath(): string;
  };

  const PANES_KEY = 'lumi.panes.v1:';
  let panes = $state.raw<PaneState | null>(null);
  let primaryLeaf = $state(newPaneId());
  const paneRefs: Record<string, NotePaneHandle | null> = $state({});
  let paneInfo = $state<Record<string, { editing: boolean; title: string }>>({});
  let primaryWrapEl = $state<HTMLElement | null>(null);

  const multi = $derived(!!panes && paneCount(panes) > 1 && pane === 'note');
  const activeLeafId = $derived(panes?.active ?? primaryLeaf);
  const activeIsSecondary = $derived(multi && activeLeafId !== primaryLeaf);
  const leafList = $derived(panes ? leaves(panes.root) : []);
  const multiPane = $derived(multi || layout.order.length + (layout.stack ? 1 : 0) > 1);

  /** The scrollable reader of the primary pane. */
  function readerEl(): HTMLElement | null {
    return multi ? primaryWrapEl : previewEl;
  }

  /** Book-relative path of the note in leaf `id`. */
  function leafPath(id: string = activeLeafId): string {
    if (id === primaryLeaf) return notes.selected?.path ?? notes.content?.path ?? '';
    const l = panes ? findLeaf(panes.root, id) : null;
    return (l && notes.list.find((n) => n.id === l.note)?.path) ?? paneRefs[id]?.notePath() ?? '';
  }

  function ensureTree(): PaneState | null {
    if (panes) return panes;
    const id = notes.selectedID;
    if (!id) return null;
    panes = single(id, primaryLeaf);
    return panes;
  }

  // ---- zoom (tmux-style, SPEC-PARTE2 §3) ------------------------------------
  // `zoomed` is the leaf filling the note area; the others stay mounted
  // (hidden, not closed). Never persisted.
  let zoomed = $state<string | null>(null);
  $effect(() => {
    if (zoomed && (!multi || !panes || !findLeaf(panes.root, zoomed))) untrack(() => (zoomed = null));
  });

  function leafElement(id: string): HTMLElement | null {
    return rootEl?.querySelector<HTMLElement>(`[data-leaf="${id}"]`) ?? null;
  }

  /** Zoom `id` (or unzoom with null). The zoomed pane is revealed from
   *  its old box to the full note area (clip, no text distortion); on
   *  unzoom the hidden panes settle back in around it. */
  async function setZoom(id: string | null, animated = true): Promise<void> {
    if (id === zoomed) return;
    if (id && (!multi || !panes || !findLeaf(panes.root, id))) {
      flash('zoom needs a split — ⌃w v first', 'warn');
      return;
    }
    const target = id ?? zoomed!;
    const el = leafElement(target);
    const first = el?.getBoundingClientRect() ?? null;
    if (id && panes) panes = focusLeafState(panes, id);
    zoomed = id;
    await tick();
    if (!animated || !motionAllowed()) return;
    const s = SPRING.gentle;
    const now = leafElement(target);
    if (id && now && first) {
      // Grow: the pane's content starts where it was (translated to the
      // old box) and slides home while its visible window (clip) widens
      // to the full area — a shared-element grow without scaling text.
      const last = now.getBoundingClientRect();
      const dx = first.left - last.left;
      const dy = first.top - last.top;
      const inset = `inset(0px ${Math.max(0, last.width - first.width)}px ${Math.max(0, last.height - first.height)}px 0px round 12px)`;
      animate(now, [
        { transform: `translate(${dx}px, ${dy}px)`, clipPath: inset },
        { transform: 'none', clipPath: 'inset(0px 0px 0px 0px round 0px)' },
      ], SPRING.glide.ms, SPRING.glide.easing);
    } else if (!id) {
      const others = [...(rootEl?.querySelectorAll<HTMLElement>('[data-leaf]') ?? [])].filter((x) => x.dataset.leaf !== target);
      others.forEach((x, i) => animate(x, [{ opacity: 0, transform: 'scale(0.97)' }, { opacity: 1, transform: 'none' }], s.ms, s.easing, Math.min(120, i * 30)));
      if (now) animate(now, [{ transform: 'scale(1.015)' }, { transform: 'none' }], s.ms, s.easing);
    }
  }

  function toggleZoom(id: string = activeLeafId): void {
    void setZoom(zoomed ? null : id);
  }

  // ---- drag a note from the explorer onto a pane edge ---------------------
  let dropAt = $state<{ leaf: string; t: DropTarget; rect: { left: number; top: number; width: number; height: number } } | null>(null);
  let noteDragging = $state(false);

  function dropTargetAt(x: number, y: number): typeof dropAt {
    const stage = previewEl;
    if (!stage || pane !== 'note') return null;
    const els = multi ? [...stage.querySelectorAll<HTMLElement>('[data-leaf]')] : [stage];
    for (const el of els) {
      const r = el.getBoundingClientRect();
      if (!r.width) continue;
      const t = dropSide(r, x, y);
      if (t) return { leaf: el.dataset.leaf ?? primaryLeaf, t, rect: { left: r.left, top: r.top, width: r.width, height: r.height } };
    }
    return null;
  }
  function onStageDragOver(e: DragEvent): void {
    if (!e.dataTransfer || ![...e.dataTransfer.types].includes(NOTE_DRAG_TYPE)) return;
    const d = dropTargetAt(e.clientX, e.clientY);
    dropAt = d;
    if (d) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  }
  function onStageDrop(e: DragEvent): void {
    const d = dropAt ?? dropTargetAt(e.clientX, e.clientY);
    dropAt = null;
    const key = e.dataTransfer?.getData(NOTE_DRAG_TYPE);
    const id = key ? noteIdOfKey(key) : null;
    if (!d || !id) return;
    e.preventDefault();
    fx = null;
    noteDragging = false;
    void splitWith(d.t.dir, id, d.leaf, d.t.before);
  }

  /** Open `note` in a new pane beside (`row`) or below (`col`) leaf `at`. */
  async function splitWith(dir: SplitDir, note: string | null, at: string = activeLeafId, before = false): Promise<void> {
    // Opening a split unzooms first.
    if (zoomed) zoomed = null;
    // From the home, the first note simply opens.
    if (pane === 'home' || !notes.selectedID) {
      if (note) openNote(note);
      else flash('open a note first', 'warn');
      return;
    }
    const base = ensureTree();
    if (!base) return flash('open a note first', 'warn');
    const target = note ?? findLeaf(base.root, at)?.note ?? notes.selectedID;
    if (!target) return;
    const next = splitPane(base, findLeaf(base.root, at) ? at : base.active, dir, target, undefined, before);
    if (!next) return flash('too many panes — close one first (⌃w q)', 'warn');
    panes = next;
    await tick();
    const el = rootEl?.querySelector<HTMLElement>(`[data-leaf="${next.active}"]`);
    const off = (dir === 'row' ? 18 : 14) * (before ? -1 : 1);
    animate(el, [{ opacity: 0, transform: dir === 'row' ? `translateX(${off}px) scale(0.985)` : `translateY(${off}px) scale(0.985)` }, { opacity: 1, transform: 'none' }], SPRING.gentle.ms, SPRING.gentle.easing);
    focusedPane = 'leaf';
    paneRefs[next.active]?.focus();
    requestAnimationFrame(() => {
      if (panes?.active === next.active) paneRefs[next.active]?.focus();
    });
  }

  /** Make leaf `id` the primary one (it shows notes.selected). */
  function promote(id: string): void {
    if (!panes || id === primaryLeaf) return;
    const l = findLeaf(panes.root, id);
    if (!l) return;
    const wasEditing = paneRefs[id]?.isEditing() ?? false;
    if (editSession) exitEdit();
    primaryLeaf = id;
    void notes.select(l.note).then(() => {
      // The secondary pane released its session with a grace period:
      // the primary picks the same live doc up.
      if (wasEditing) void enterEdit();
    });
  }

  function closeLeaf(id: string = activeLeafId): void {
    if (!panes || paneCount(panes) < 2) {
      if (editMode) exitEditAnimated();
      else closeNote();
      return;
    }
    const next = closePane(panes, id);
    if (!next) return;
    void withViewTransition(async () => {
      if (id === primaryLeaf) promote(next.active === id ? leaves(next.root)[0].id : next.active);
      panes = paneCount(next) > 1 ? next : null;
      if (!panes) primaryLeaf = leaves(next.root)[0].id;
      delete paneRefs[id];
      await tick();
    });
    void tick().then(() => focusLeaf(next.active));
  }

  function onlyLeaf(id: string = activeLeafId): void {
    if (!panes) return;
    if (id !== primaryLeaf) promote(id);
    void withViewTransition(async () => {
      panes = null;
      await tick();
    });
    void tick().then(() => focusLeaf(primaryLeaf));
  }

  function focusLeaf(id: string, from?: PaneDir): void {
    if (panes) panes = focusLeafState(panes, id);
    if (id === primaryLeaf || !multi) {
      if (editMode && editSession) {
        const split = editorSettings.value.editMode === 'source' && editorSettings.value.previewSplit && !splitNarrow;
        void focusPaneEl(from === 'h' && split ? 'split' : 'editor');
      } else void focusPaneEl('main');
      return;
    }
    paneRefs[id]?.focus();
  }

  function setPrimaryView(view: string | null): void {
    const base = ensureTree();
    if (base) panes = setView(base, primaryLeaf, view);
  }

  /** Window commands: Ctrl-w v/s/q/o/=/f/F/</>/+/- and :vsplit etc. */
  function runWin(cmd: WinCmd, o: { link?: LinkAt | null; arg?: string } = {}): void {
    switch (cmd) {
      case 'vsplit':
      case 'split': {
        let note: string | null = null;
        if (o.arg) {
          const hit = linkCandidates(notes.list, o.arg, { limit: 1 })[0];
          if (!hit) return flash(`no note matches “${o.arg}”`, 'warn');
          note = hit.id;
        }
        void splitWith(cmd === 'vsplit' ? 'row' : 'col', note);
        return;
      }
      case 'close': closeLeaf(); return;
      case 'only': onlyLeaf(); return;
      case 'zoom': toggleZoom(); return;
      case 'equal': if (panes) panes = equalize(panes); return;
      case 'linkV':
      case 'linkH': {
        const l = o.link ?? readerLinkTarget();
        if (!l) return flash('no link under the cursor', 'warn');
        followLink(l.href, cmd === 'linkV' ? 'vsplit' : 'hsplit', leafPath(), l.wiki);
        return;
      }
      case 'wider':
      case 'narrower':
      case 'taller':
      case 'shorter':
        if (!panes) return;
        panes = nudgePane(panes, activeLeafId, cmd === 'wider' || cmd === 'narrower' ? 'row' : 'col', cmd === 'wider' || cmd === 'taller' ? 0.05 : -0.05);
        return;
    }
  }

  // The primary leaf follows the open note.
  $effect(() => {
    const id = notes.selectedID;
    untrack(() => {
      if (!panes) return;
      const l = findLeaf(panes.root, primaryLeaf);
      if (!l) return;
      if (id && l.note !== id) panes = setNote(panes, primaryLeaf, id);
      else if (!id && !notes.loadingContent && paneCount(panes) > 1 && pane === 'note') {
        // The primary note is gone (deleted): its pane closes.
        closeLeaf(primaryLeaf);
      }
    });
  });

  // Notes deleted elsewhere close their panes and leave the history.
  $effect(() => {
    const list = notes.list;
    untrack(() => {
      if (notes.loadingList || notes.stale) return;
      const ids = new Set(list.map((n) => n.id));
      noteHistory.prune((n) => ids.has(n));
      if (!panes) return;
      const pruned = pruneNotes(panes, (n) => ids.has(n));
      if (pruned === panes) return;
      if (!pruned || paneCount(pruned) < 2) panes = null;
      else {
        if (!findLeaf(pruned.root, primaryLeaf)) promote(pruned.active);
        panes = pruned;
      }
    });
  });

  // Layout per book, per device (only multi-pane layouts are kept).
  $effect(() => {
    const vid = vaults.selectedID;
    const s = panes;
    const prim = primaryLeaf;
    untrack(() => {
      if (!vid || plannedFor !== vid) return;
      try {
        if (s && paneCount(s) > 1) localStorage.setItem(PANES_KEY + vid, JSON.stringify({ v: 1, state: s, primary: prim }));
        else localStorage.removeItem(PANES_KEY + vid);
      } catch {
        /* storage unavailable */
      }
    });
  });

  /** The book's saved split layout (pruned to existing notes), or null. */
  function savedLayout(vid: string): { state: PaneState; primary: string } | null {
    let raw: unknown = null;
    try {
      raw = JSON.parse(localStorage.getItem(PANES_KEY + vid) ?? 'null');
    } catch {
      raw = null;
    }
    const o = raw as { state?: unknown; primary?: unknown } | null;
    const parsed = o ? parsePaneState(o.state) : null;
    if (!parsed) return null;
    const ids = new Set(notes.list.map((n) => n.id));
    const pruned = pruneNotes(parsed, (n) => ids.has(n));
    if (!pruned || paneCount(pruned) < 2) return null;
    const prim = typeof o?.primary === 'string' && findLeaf(pruned.root, o.primary) ? o.primary : pruned.active;
    return { state: pruned, primary: prim };
  }

  // ---- opening a book (SPEC-PARTE2 §2) ---------------------------------------
  //
  // Once the book's list is in: its saved split layout, else its last
  // note (per device), else the calm home with the explorer floating.
  $effect(() => {
    const vid = vaults.selectedID;
    const ready = !!vid && notes.vaultID === vid && !notes.loadingList;
    if (!ready || plannedFor === vid) return;
    untrack(() => {
      if (uiState.pendingNote?.vault === vid) return; // the deep link decides
      const saved = savedLayout(vid!);
      const plan = planBookOpen({
        notes: notes.list,
        layoutNote: saved ? findLeaf(saved.state.root, saved.primary)!.note : null,
        last: lastNote(vid!),
      });
      plannedFor = vid;
      if (plan.kind === 'note') {
        if (plan.source === 'layout' && saved) {
          primaryLeaf = saved.primary;
          panes = saved.state;
        }
        noteHistory.visit(plan.note);
        pane = 'note';
        void notes.select(plan.note);
        void tick().then(() => focusPane(readerEl()));
      } else {
        pane = 'home';
        if (plan.explore && !fx && !overlayOpen()) openFloating({ auto: true });
      }
    });
  });

  // ---- links: one routing table (SPEC-PARTE2 §3) -----------------------------

  type OpenOpts = {
    /** The explorer row's name: it morphs into the note title. */
    from?: HTMLElement | null;
    /** false for H / L (walking the history itself). */
    history?: boolean;
    /** Close the floating explorer as part of the transition. */
    closeFx?: boolean;
  };

  /** Open note `id` in the current pane, or in a new split. */
  function openIn(id: string, where: OpenWhere, leaf: string = activeLeafId, o: OpenOpts = {}): void {
    // The layout moves under a still pointer: no card for a moment.
    hoverQuietUntil = Date.now() + 700;
    hoverIntent.hide();
    if (where !== 'current') {
      if (o.closeFx) fx = null;
      void splitWith(where === 'vsplit' ? 'row' : 'col', id, leaf);
      return;
    }
    if (multi && leaf !== primaryLeaf && panes) {
      if (o.closeFx) fx = null;
      panes = setNote(panes, leaf, id);
      return;
    }
    if (editMode) exitEdit();
    if (o.history !== false) noteHistory.visit(id);
    if (editorSettings.value.openIn === 'editing') {
      if (o.closeFx) fx = null;
      void editNote(id);
      return;
    }
    // Never wait for the network inside a transition: a body the
    // explorer preview already fetched paints at once, anything else
    // shows the reader skeleton until it arrives.
    const vid = vaults.selectedID;
    const hit = vid ? peekNote(vid, id) : null;
    const seed = hit && !hit.stale ? hit.content : null;
    const update = async () => {
      if (o.closeFx) fx = null;
      void notes.select(id, seed);
      pane = 'note';
      await tick();
    };
    const run = o.from && seed ? sharedTransition('note-title', o.from, update) : withViewTransition(update);
    // A canvas / board that already took focus on mount keeps it.
    void run.then(() => focusPane(readerEl()));
  }

  /** Follow an href found in the note at `fromPath`. */
  function followLink(href: string, where: OpenWhere, fromPath: string, wiki = false, leaf: string = activeLeafId): void {
    const t = classifyLink(notes.list, fromPath, href, wiki);
    switch (t.kind) {
      case 'note': openIn(t.note.id, where, leaf); return;
      case 'external': window.open(t.url, '_blank', 'noopener,noreferrer'); return;
      case 'missing': flash(`no note at ${t.path}`, 'warn'); return;
      case 'unsafe': flash('link not followed (unsupported scheme)', 'warn'); return;
      case 'anchor': return;
    }
  }

  /** Link clicks in rendered markdown: plain click = this pane,
   *  Cmd/Ctrl-click = vertical split, Shift-Cmd/Ctrl-click = horizontal. */
  function routeClick(href: string, e: MouseEvent, fromPath: string, leaf: string): void {
    if (href.startsWith('#')) return;
    const where = whereFromClick(e, MAC);
    if (!where) return; // middle / Alt-click: the browser's
    e.preventDefault();
    hoverIntent.hide();
    followLink(href, where, fromPath, false, leaf);
  }

  /** The reader's link target for gf / K / Ctrl-w f: the focused link,
   *  else the hovered one, else the first link in view. */
  function readerLinkTarget(root: HTMLElement | null = activeReaderRoot()): LinkAt | null {
    if (!root) return null;
    const a = document.activeElement;
    let el: Element | null = a instanceof HTMLAnchorElement && root.contains(a) ? a : null;
    if (!el && lastHoverEl && root.contains(lastHoverEl)) el = lastHoverEl;
    if (!el) {
      const r = root.getBoundingClientRect();
      el = Array.from(root.querySelectorAll('.md-body a[href]')).find((x) => {
        const b = x.getBoundingClientRect();
        return b.bottom > r.top && b.top < r.bottom && !(x.getAttribute('href') ?? '').startsWith('#');
      }) ?? null;
    }
    const href = el?.getAttribute('href');
    return href ? { href, wiki: false, from: 0, to: 0 } : null;
  }

  function activeReaderRoot(): HTMLElement | null {
    if (activeIsSecondary) return paneRefs[activeLeafId]?.element() ?? null;
    if (editMode && activePane === 'split') return splitRef?.previewElement() ?? null;
    return readerEl();
  }

  function linkElFor(root: HTMLElement | null, href: string): HTMLElement | null {
    if (!root) return null;
    return Array.from(root.querySelectorAll<HTMLElement>('a[href]')).find((x) => x.getAttribute('href') === href) ?? null;
  }

  // ---- hover link preview (SPEC-PARTE2 §4) -----------------------------------

  type HoverState = { target: HoverTarget; anchor: { left: number; top: number; bottom: number }; keyboard: boolean; leaf: string; returnTo: HTMLElement | null };
  let hover = $state<HoverState | null>(null);
  let lastHoverEl: Element | null = null;
  let hoverQuietUntil = 0;
  type HoverReq = { href: string; fromPath: string; leaf: string; el: HTMLElement; wiki: boolean };
  const hoverIntent = new HoverIntent<HoverReq>((r) => showHover(r, false), () => (hover = null));

  function hoverTargetFor(href: string, fromPath: string, wiki: boolean): HoverTarget | null {
    const t = classifyLink(notes.list, fromPath, href, wiki);
    if (t.kind === 'note') return { kind: 'note', note: t.note };
    if (t.kind === 'external') return { kind: 'external', url: t.url };
    if (t.kind === 'missing') return { kind: 'missing', path: t.path };
    return null;
  }

  function showHover(r: HoverReq, keyboard: boolean): void {
    const target = hoverTargetFor(r.href, r.fromPath, r.wiki);
    if (!target || !r.el.isConnected) {
      hoverIntent.hide();
      return;
    }
    const b = r.el.getBoundingClientRect();
    hover = { target, anchor: { left: b.left, top: b.top, bottom: b.bottom }, keyboard, leaf: r.leaf, returnTo: keyboard ? (document.activeElement as HTMLElement | null) : null };
  }

  /** `K`: the card for a link, without the hover delay. */
  function hoverKey(l: LinkAt | null, rect: { left: number; top: number; bottom: number } | null, fromPath: string, leaf = activeLeafId): void {
    if (!l) return flash('no link under the cursor', 'warn');
    const target = hoverTargetFor(l.href, fromPath, l.wiki);
    if (!target) return;
    const el = rect ? null : linkElFor(activeReaderRoot(), l.href);
    const b = rect ?? el?.getBoundingClientRect() ?? { left: 80, top: 80, bottom: 96 };
    hoverIntent.showNow({ href: l.href, fromPath, leaf, el: el ?? rootEl!, wiki: l.wiki }, 'k:' + l.href);
    hover = { target, anchor: { left: b.left, top: b.top, bottom: b.bottom }, keyboard: true, leaf, returnTo: document.activeElement as HTMLElement | null };
  }

  function closeHover(): void {
    const ret = hover?.returnTo;
    hoverIntent.hide();
    hover = null;
    ret?.focus?.({ preventScroll: true });
  }

  function openFromHover(where: OpenWhere): void {
    const h = hover;
    if (!h) return;
    closeHover();
    if (h.target.kind === 'note') openIn(h.target.note.id, where, h.leaf);
    else if (h.target.kind === 'external') window.open(h.target.url, '_blank', 'noopener,noreferrer');
  }

  function hoverLinkEl(t: EventTarget | null): HTMLElement | null {
    const el = t instanceof Element ? t.closest<HTMLElement>('a[href], [data-lp-note], [data-lp-href]') : null;
    if (!el || !el.closest('.md-body, .cm-editor') || el.closest('.hover-card, .fx')) return null;
    return el;
  }

  function onHoverOver(e: PointerEvent): void {
    if (e.pointerType === 'touch' || !editorSettings.value.hoverPreview || Date.now() < hoverQuietUntil) return;
    const el = hoverLinkEl(e.target);
    if (!el) return;
    const href = el.getAttribute('data-lp-note') ?? el.getAttribute('href') ?? el.getAttribute('data-lp-href') ?? '';
    if (!href || href.startsWith('#')) return;
    lastHoverEl = el;
    const host = el.closest<HTMLElement>('[data-leaf]');
    const leaf = host?.dataset.leaf ?? primaryLeaf;
    const fromPath = el.closest<HTMLElement>('[data-note-path]')?.dataset.notePath ?? leafPath(leaf);
    hoverIntent.enter({ href, fromPath, leaf, el, wiki: false }, `${leaf}|${fromPath}|${href}`);
  }

  function onHoverOut(e: PointerEvent): void {
    const el = hoverLinkEl(e.target);
    if (!el) return;
    if (e.relatedTarget instanceof Node && el.contains(e.relatedTarget)) return;
    if (lastHoverEl === el) lastHoverEl = null;
    if (!hover?.keyboard) hoverIntent.leave();
  }

  // ---- floating explorer (SPEC-PARTE2 §2) — the only navigation -------------------

  type FxState = { startNote: string | null; startDir: string; level: FxLevel; initial: FxInitial; key: number };
  let fx = $state<FxState | null>(null);
  /** The overlay's level as it walks (h at the book root → books). */
  let fxLevel = $state<FxLevel>('files');
  /** Folder the explorer last showed (it reopens there with no note). */
  let fxDir = '';
  let fxKey = 0;
  let fxLeaf: string | null = null;
  let yanked = $state<Entry | null>(null);

  /** Open the floating explorer: at the open note's folder, the last
   *  folder it showed, or the book root (`root`); at the books level
   *  with `level: 'books'`; running `initial` (a prompt) once open. */
  function openFloating(o: { level?: FxLevel; initial?: FxInitial; root?: boolean; dir?: string; auto?: boolean } = {}): void {
    hoverIntent.hide();
    fxLeaf = activeLeafId;
    const l = panes ? findLeaf(panes.root, activeLeafId) : null;
    const note = o.root || o.dir != null || pane !== 'note' ? null : (l?.note ?? notes.selectedID);
    fxLevel = o.level ?? 'files';
    fx = { startNote: note, startDir: o.root ? '' : (o.dir ?? fxDir), level: fxLevel, initial: o.initial ?? null, key: ++fxKey };
  }

  /** `gb`, the book button, palette "Switch book": books level. */
  function openBooks(): void {
    openFloating({ level: 'books' });
  }

  function closeFloating(dir?: string): void {
    if (dir != null) fxDir = dir;
    fx = null;
    fxLevel = 'files';
    // Focus returns to the note, or to the home.
    void tick().then(() => {
      const a = document.activeElement;
      if (a && a !== document.body && rootEl?.contains(a)) return;
      if (pane === 'note') focusLeaf(activeLeafId);
      else homeEl?.focus({ preventScroll: true });
    });
  }

  function fxOpen(id: string, where: OpenWhere, from?: HTMLElement | null): void {
    const leaf = fxLeaf ?? activeLeafId;
    const d = notes.list.find((n) => n.id === id);
    if (d) fxDir = dirOf(d.path);
    openIn(id, where, leaf, { from, closeFx: true });
  }

  function fxApp(a: ShellAction): void {
    closeFloating();
    runAction(a);
  }

  const fxOps: FxOps = {
    offline: () => structuralOffline,
    run: (p, plan, n) => runPlan(p, plan, n),
    remove: async (entry) => {
      if (entry.kind !== 'note') return;
      const wasOpen = pane === 'note' && notes.selectedID === entry.note.id;
      if (multi && wasOpen) closeLeaf(primaryLeaf);
      const vid = vaults.selectedID;
      if (!vid) return;
      if (notes.selectedID === entry.note.id) await notes.deleteSelected();
      else {
        await api.deleteNote(vid, entry.note.id);
        await notes.refresh();
      }
      if (wasOpen) rememberLastNote(vid, null);
    },
    paste: async (src, n) => {
      if (src.kind !== 'note') return;
      if (structuralOffline) throw new Error(OFFLINE_HINT);
      const vid = vaults.selectedID;
      if (!vid) return;
      const c = await api.getNoteContent(vid, src.note.id);
      const taken = new Set(notes.list.map((x) => x.title));
      const isCanvas = noteViewKind({ path: src.note.path, kind: src.note.kind ?? c.kind }) === 'canvas';
      await createNoteIn(n, copyTitle(src.note.title ?? src.name, taken), n.dir, c.body ?? '', isCanvas ? 'canvas' : undefined);
    },
    move: async (key, folder) => {
      const note = notes.list.find((n) => 'n:' + n.id === key);
      if (!note) return null;
      const file = normalizePath(note.path || note.id + '.md').split('/').pop()!;
      const path = `${folder.path}/${file}`;
      if (normalizePath(note.path) === path) return null;
      const updated = await notes.patch(note.id, { path });
      return updated ? `moved ${file} → ${folder.path}/` : null;
    },
    copyLink: (e) => copyLinkTo(e, pane === 'note' ? (notes.selected?.path ?? '') : ''),
    refresh: () => void notes.refresh(),
  };

  /** Run a create / rename / move plan against the explorer's state `n`. */
  async function runPlan(p: FxPrompt, plan: FxPlan, n: MillerNav): Promise<void> {
    if (plan.kind === 'error') throw new Error(plan.message);
    if (plan.kind === 'none') return;
    try {
      if (plan.kind === 'folder' && 'path' in plan) {
        n.addFolder(plan.path);
        n.goTo(plan.path);
        flash(`folder ${plan.path}/ — create a note in it to keep it (a)`);
      } else if (plan.kind === 'folder') {
        await moveFolder(plan.from, plan.to, n);
      } else if (plan.kind === 'note' && 'folder' in plan) {
        await createNoteIn(n, plan.title, plan.folder, '', plan.noteKind);
      } else if (plan.kind === 'note' && p.kind === 'rename' && p.entry.kind === 'note') {
        const input: { title?: string; path?: string } = {};
        if (plan.title) input.title = plan.title;
        if (plan.path) input.path = plan.path;
        const updated = await notes.patch(p.entry.note.id, input);
        if (updated && plan.path) {
          n.reveal(updated.id);
          flash(`moved to ${updated.path}`);
        }
      }
    } catch (e) {
      throw new Error(errText(e));
    }
  }

  // ---- deep links (SPEC-PARTE2 §8) --------------------------------------------

  // A pending #/b/<vault>/n/<note> opens once the book's notes are in.
  $effect(() => {
    const want = uiState.pendingNote;
    const vid = vaults.selectedID;
    const ready = notes.vaultID === vid && !notes.loadingList;
    if (!want || !vid || want.vault !== vid || !ready) return;
    untrack(() => {
      uiState.pendingNote = null;
      plannedFor = vid;
      const n = want.note
        ? notes.list.find((x) => x.id === want.note)
        : notes.list.find((x) => normalizePath(x.path) === normalizePath(want.path ?? ''));
      if (!n) {
        flash('that note is not in this book (deleted or moved?)', 'warn');
        if (pane === 'home' && !fx) openFloating({ auto: true });
        return;
      }
      panes = null;
      fx = null;
      openNote(n.id);
    });
  });

  // The URL follows the book / note (so it can be copied or targeted by
  // `lumi open`); replaceState, so Back is not flooded.
  $effect(() => {
    const vid = vaults.selectedID;
    const id = pane === 'note' ? notes.selectedID : null;
    if (!vid || uiState.pendingNote) return;
    const want = formatDeepLink({ vault: vid, note: id ?? undefined });
    try {
      if (window.location.hash !== want) replaceUrl(want);
    } catch {
      /* sandboxed */
    }
  });
  function replaceUrl(url: string): void {
    window.history.replaceState(window.history.state, '', url);
  }

  function copyDeepLink(): void {
    const vid = vaults.selectedID;
    if (!vid) return;
    const url = window.location.origin + window.location.pathname + formatDeepLink({ vault: vid, note: notes.selectedID ?? undefined });
    void navigator.clipboard?.writeText(url).then(() => flash('copied link'), () => flash('clipboard unavailable', 'warn'));
  }

  // ---- legend actions ------------------------------------------------------------

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

  function onLegendAction(it: LegendItem): void {
    const d = it.do;
    if (!d) return;
    const i = d.indexOf(':');
    const ns = d.slice(0, i);
    const arg = d.slice(i + 1);
    if (ns === 'shell') {
      runAction(SHELL_ALIASES[arg] ?? ({ kind: arg } as ShellAction));
      return;
    }
    if (ns === 'preview') {
      const a = PREVIEW_ALIASES[arg];
      if (a.kind === 'back') void focusPaneEl('editor', 'split');
      else if (a.kind === 'yank') void copyPreviewText();
      else splitRef?.run(a);
      return;
    }
    if (ns === 'vim' || ns === 'ex') {
      noteEditorRef?.run(d);
      return;
    }
    switch (arg) {
      case 'hints':
        hintRoot = legendCtx === 'preview' ? () => splitRef?.previewElement() ?? null : null;
        hintsOpen = true;
        return;
      case 'panes': navigatePane('w'); return;
      case 'vsplit': runWin('vsplit'); return;
      case 'hsplit': runWin('split'); return;
      case 'closePane': runWin('close'); return;
      case 'onlyPane': runWin('only'); return;
      case 'zoomPane': runWin('zoom'); return;
      case 'equalPanes': runWin('equal'); return;
      case 'explorer': openFloating(); return;
      case 'books': openBooks(); return;
      case 'readPreview': void focusPaneEl('split'); return;
      case 'menu': openMenuAtCursor(); return;
      case 'reading': exitEditAnimated(); return;
      case 'toggleMode': editorSettings.toggleEditMode(); return;
      case 'settings': uiState.openSettings('editor'); return;
    }
  }

  // ---- split preview -------------------------------------------------------------

  const splitOn = $derived(editorSettings.value.editMode === 'source' && editorSettings.value.previewSplit);

  function toggleSplit(): void {
    const s = editorSettings.value;
    if (s.editMode !== 'source') {
      editorSettings.update({ editMode: 'source', previewSplit: true });
      flash('Source mode + preview');
      return;
    }
    editorSettings.update({ previewSplit: !s.previewSplit });
  }

  function exitEditAnimated(): void {
    void withViewTransition(async () => {
      exitEdit();
      await tick();
    });
  }

  // ---- modals + editor ----------------------------------------------------

  async function enterEdit(): Promise<void> {
    const vaultID = vaults.selectedID;
    const noteID = notes.selectedID;
    if (!notes.content || !vaultID || !noteID) return;
    if (editorLoading || editSession) return;

    editorLoading = true;
    editError = null;
    try {
      // First edit per session pulls the CM6 + vim + y-codemirror.next
      // + yjs + y-websocket chunks, in parallel. The session uses the
      // ACTIVE BOOK's account (server, token, identity) and this note's
      // offline replica; another pane on the same note shares it
      // (lib/editor-boot.ts editorPool).
      //
      // Join rule (CRDT client protocol §2): the session starts from an
      // EMPTY doc and the server's SyncStep2 delivers the text — never a
      // seed from the REST body (that duplicated the note). Until the
      // session is `editable` the template shows a read-only preview.
      const [editorMod, sess] = await Promise.all([
        NoteEditor ? Promise.resolve(null) : import('../components/NoteEditor.svelte'),
        acquireEditorSession(vaultID, noteID),
      ]);
      if (editorMod) NoteEditor = editorMod.default;
      if (typeof sess === 'string') {
        editError = sess;
        return;
      }
      // The user may have moved on while the chunks loaded.
      if (notes.selectedID !== noteID || vaults.selectedID !== vaultID || editSession) {
        editorPool.release(sess);
        return;
      }
      editSession = sess;
      sync.setEditor(vaultID, sess);
      editMode = true;
      vimState = { mode: 'normal', pending: null };
      pane = 'note';
    } catch (e) {
      editError = `Failed to load editor: ${(e as Error).message}`;
    } finally {
      editorLoading = false;
    }
  }

  /** Leave edit mode and destroy the single-note session. */
  function exitEdit(): void {
    const sess = editSession;
    if (sess) {
      // Show the latest collaborative text in the preview right away;
      // the server mirrors it to disk ~500 ms later.
      if (sess.editable && !sess.isDestroyed && !sess.lineageConflict) {
        notes.applyLocalBody(sess.noteID, sess.ytext.toString());
      }
      sync.setEditor(sess.vaultID, null);
      editSession = null;
      // Shared with other panes on this note: the last one closes it.
      editorPool.release(sess);
    }
    editMode = false;
    editError = null;
    editorStats = null;
  }

  // Server-side mirror debounce (wsync.DefaultMirrorDebounce) + margin.
  const MIRROR_SETTLE_MS = 800;

  /**
   * Cmd/Ctrl+S. Every Yjs update is already persisted by the server
   * on receipt and mirrored to the markdown file after a 500 ms
   * debounce, so there is nothing to push. In particular we must NOT
   * POST the full text to /diff: the server diffs it against its
   * current state, which silently reverts concurrent remote edits we
   * have not received yet (last-writer-wins). Save just waits for the
   * mirror to settle and refreshes the list metadata.
   */
  async function saveEdit(): Promise<void> {
    const sess = editSession;
    if (saving || !sess) return;
    if (!sess.editable || !sess.liveSynced) {
      editError = 'Offline — your edits are kept locally and will sync when the connection returns.';
      return;
    }
    saving = true;
    editError = null;
    try {
      await new Promise((r) => setTimeout(r, MIRROR_SETTLE_MS));
      await notes.refresh();
    } finally {
      saving = false;
    }
  }

  function initialiseFromFile(): void {
    if (!editSession || !notes.content) return;
    editSession.initialiseFromFile(notes.content.body ?? '');
  }

  // Pre-compute the sanitised preview HTML on every content change.
  // marked is fast enough that we don't bother debouncing here; large
  // notes (10k+ lines) are the slice 4.4 / 4.6 perf concern.
  const previewBlocks = $derived(notes.content ? renderBlocks(notes.content.body ?? '') : []);
  const primaryMatch = $derived({ path: notes.selected?.path ?? notes.content?.path ?? '', kind: notes.content?.kind ?? notes.selected?.kind ?? null, frontmatter: notes.content?.frontmatter ?? null, body: notes.content?.body ?? '' });
  const primaryViews = $derived(viewsFor(primaryMatch));
  const primaryView = $derived(resolveView(primaryMatch, panes ? (findLeaf(panes.root, primaryLeaf)?.view ?? null) : null));
  const readingWords = $derived(notes.content ? countWords(notes.content.body ?? '') : 0);
  const readingMinutes = $derived(readingTime(readingWords));
  /** The body opens with `# <title>`: don't print the title twice. */
  const titleInBody = $derived(!!notes.content && startsWithTitle(notes.content.body ?? '', notes.selected?.title ?? ''));
  const noteFolder = $derived(notes.selected ? dirOf(notes.selected.path) : '');
  const noteCrumbs = $derived(noteFolder ? noteFolder.split('/') : []);

  function setEditMode(m: 'live' | 'source'): void {
    editorSettings.update({ editMode: m });
  }

  // ---- legend -------------------------------------------------------------------

  const eff = $derived(effectiveSettings(editorSettings.value));
  function vimModeLabel(m: string, sub?: string | null): string {
    if (m === 'visual') return sub === 'linewise' ? 'V-Line' : sub === 'blockwise' ? 'V-Block' : 'Visual';
    return m === 'insert' ? 'Insert' : m === 'replace' ? 'Replace' : 'Normal';
  }
  const legendCtx: LegendContext = $derived.by(() => {
    if (paletteMode) return 'palette';
    if (fx) return fxLevel === 'books' ? 'books' : 'float';
    if (hover?.keyboard) return 'hover';
    if (pane === 'home') return 'home';
    // A canvas / board has the keyboard: its own keys (Reading or Edit).
    const sf = structuredFocus.current;
    if (sf) return sf.kind === 'canvas' ? 'canvas' : 'board';
    if (activePane === 'leaf') return paneInfo[activeLeafId]?.editing ? (eff.vim ? contextForVimMode(vimState.mode) : 'insert') : 'reader';
    if (editMode && editSession && activePane === 'split') return 'preview';
    if (editMode && editSession) return eff.vim ? contextForVimMode(vimState.mode) : 'insert';
    return 'reader';
  });
  // The Ctrl-w prefix expires like vim's other pending keys.
  $effect(() => {
    if (!panePending) return;
    const t = setTimeout(() => (panePending = paneKeys.pending), PANE_CHORD_MS + 20);
    return () => clearTimeout(t);
  });
  const legendPending = $derived.by(() => {
    if (legendCtx === 'float' || legendCtx === 'books' || legendCtx === 'hover') return null;
    if (panePending) return '⌃w';
    if (legendCtx === 'preview') return previewPending;
    if (editMode && legendCtx !== 'reader') return vimState.pending === eff.leader ? eff.leader : vimState.pending;
    return shellPending;
  });
  const legendItems = $derived(
    legendFor(legendCtx, legendPending, {
      leader: eff.leader,
      escapeSequences: eff.escapeSequences,
      source: editMode && editorSettings.value.editMode === 'source',
      split: editMode && splitOn,
      panes: multiPane && editorSettings.value.paneNav,
      structuredMode: structuredFocus.current?.mode,
      leaderMaps: editMode
        ? appliedMappings()
            .filter((m) => m.lhs.startsWith(LEADER_TOKEN))
            .map((m) => ({ keys: m.lhs.slice(LEADER_TOKEN.length), rhs: m.rhs }))
        : [],
    }),
  );
  const legendMode = $derived(
    legendCtx === 'float' ? 'explorer'
    : legendCtx === 'hover' ? 'preview'
    : legendCtx === 'canvas' || legendCtx === 'board' ? (structuredFocus.current?.mode === 'edit' ? 'edit' : 'reading')
    : legendCtx,
  );

  // ---- palette ------------------------------------------------------------------

  const paletteCommands: PaletteCommand[] = $derived([
    // Canvas / board modes (SPEC-PARTE2 §5a) for the view that had the keyboard.
    ...(structuredFocus.last
      ? ([
          { id: 'structuredRead', title: `${structuredFocus.last.kind === 'canvas' ? 'Canvas' : 'Board'}: Reading mode`, keys: 'Esc', group: 'mode view read only canvas board kanban', run: () => structuredFocus.last?.set('read') },
          { id: 'structuredEdit', title: `${structuredFocus.last.kind === 'canvas' ? 'Canvas' : 'Board'}: Edit mode`, keys: 'e', group: 'mode edit canvas board kanban', run: () => structuredFocus.last?.set('edit') },
          ...(structuredFocus.last.source ? [{ id: 'structuredSource', title: `${structuredFocus.last.kind === 'canvas' ? 'Canvas' : 'Board'}: Source`, group: 'mode source json markdown raw canvas board kanban', run: () => structuredFocus.last?.source?.() }] : []),
        ] as PaletteCommand[])
      : []),
    { id: 'explorer', title: 'Open explorer', keys: '-', group: 'files browse yazi floating overlay open navigate', run: () => openFloating() },
    { id: 'books', title: 'Switch book…', keys: 'gb', group: 'navigate books vault accounts floating', run: openBooks },
    { id: 'root', title: 'Explorer at book root', keys: 'gh', group: 'navigate home files', run: () => openFloating({ root: true }) },
    { id: 'filter', title: 'Filter a folder…', keys: '- /', group: 'search files explorer', run: () => openFloating({ initial: 'filter' }) },
    { id: 'new', title: 'New note…', keys: 'a', group: 'create file', run: beginCreate },
    { id: 'new-canvas', title: 'New canvas…', keys: 'a name.canvas', group: 'create canvas json', run: beginCreateCanvas },
    { id: 'new-folder', title: 'New folder…', keys: 'a dir/', group: 'create directory', run: () => { if (structuralOffline) return showOfflineHint(); openFloating({ initial: 'newFolder' }); } },
    ...(pane === 'note'
      ? [
          { id: 'rename', title: 'Rename / move note…', keys: 'r', group: 'file', run: beginRename },
          { id: 'delete', title: 'Delete note…', keys: '- d', group: 'file remove', run: beginDelete },
          { id: 'close-note', title: 'Close note', keys: 'q', group: 'home book', run: closeNote },
        ]
      : []),
    { id: 'edit', title: editMode ? 'Reading view' : 'Edit note', keys: '⌘E', group: 'editor', run: () => { if (editMode) exitEdit(); else { const t = noteUnderFocus(); if (t) void editNote(t); } } },
    { id: 'live', title: editorSettings.value.editMode === 'live' ? 'Switch to Source mode' : 'Switch to Live Preview', keys: '⌘⇧E', group: 'editor', run: () => editorSettings.toggleEditMode() },
    { id: 'split', title: splitOn ? 'Hide preview beside source' : 'Show preview beside source', keys: '\\p ⌘⌥P', group: 'editor split side by side render', run: toggleSplit },
    { id: 'vsplit', title: 'Split vertically (:vsplit)', keys: '⌃w v', group: 'pane window side by side', run: () => runWin('vsplit') },
    { id: 'hsplit', title: 'Split horizontally (:split)', keys: '⌃w s', group: 'pane window stacked below', run: () => runWin('split') },
    ...(multi
      ? [
          { id: 'close-pane', title: 'Close pane', keys: '⌃w q', group: 'pane window', run: () => runWin('close') },
          { id: 'only-pane', title: 'Keep only this pane', keys: '⌃w o', group: 'pane window only', run: () => runWin('only') },
          { id: 'zoom-pane', title: zoomed ? 'Unzoom pane (:zoom)' : 'Zoom pane (:zoom)', keys: '⌃w z', group: 'pane window zoom maximize focus tmux', run: () => runWin('zoom') },
          { id: 'equal-panes', title: 'Equalize panes', keys: '⌃w =', group: 'pane window resize', run: () => runWin('equal') },
        ]
      : []),
    { id: 'back', title: 'Previous note', keys: 'H', group: 'history back navigate', run: () => runAction({ kind: 'historyBack' }) },
    { id: 'forward', title: 'Next note', keys: 'L', group: 'history forward navigate', run: () => runAction({ kind: 'historyForward' }) },
    { id: 'hover', title: editorSettings.value.hoverPreview ? 'Turn off hover link previews' : 'Turn on hover link previews', keys: 'K', group: 'preview link card', run: () => editorSettings.update({ hoverPreview: !editorSettings.value.hoverPreview }) },
    { id: 'deeplink', title: 'Copy link to this note', group: 'share url deep link lumi open', run: copyDeepLink },
    { id: 'hints', title: 'Hint mode (click by keyboard)', keys: 'F', group: 'navigate vimium labels', run: () => (hintsOpen = true) },
    { id: 'motion', title: editorSettings.value.reduceMotion ? 'Allow motion' : 'Reduce motion', group: 'view animation accessibility', run: () => editorSettings.update({ reduceMotion: !editorSettings.value.reduceMotion }) },
    { id: 'refresh', title: 'Refresh notes', keys: 'R', group: 'sync reload', run: () => void notes.refresh() },
    { id: 'next-book', title: 'Next book', keys: ']', group: 'navigate switch', run: () => cycleBook(1) },
    { id: 'prev-book', title: 'Previous book', keys: '[', group: 'navigate switch', run: () => cycleBook(-1) },
    { id: 'manage-books', title: 'Manage books…', group: 'books vault list rename remove', run: () => books.openPicker() },
    { id: 'settings', title: 'Settings', keys: ',', group: 'preferences', run: () => uiState.openSettings('editor') },
    { id: 'vim', title: 'Vim settings & .vimrc', group: 'preferences vimrc keys', run: () => uiState.openSettings('vim') },
    { id: 'appearance', title: 'Theme & appearance', group: 'preferences colour color dark light', run: () => uiState.openSettings('appearance') },
    { id: 'legend', title: editorSettings.value.legend ? 'Hide command legend' : 'Show command legend', group: 'view keys hints', run: () => editorSettings.update({ legend: !editorSettings.value.legend }) },
    { id: 'keys', title: 'Keyboard shortcuts', keys: '?', group: 'help', run: () => (uiState.helpOpen = true) },
    { id: 'book-settings', title: 'Book settings (members, roles)', group: 'vault admin', run: () => (showSettings = true) },
    { id: 'new-book', title: 'New book…', group: 'create vault', run: () => (uiState.createBookOpen = true) },
  ]);

  /** `:` lines typed in the palette (reader / home): the pane ex
   *  commands. true = handled. */
  function runExLine(line: string): boolean {
    const m = /^\s*(vs|vsp|vspl|vspli|vsplit|sp|spl|spli|split|on|onl|only|zo|zoo|zoom|clo|clos|close|q|quit|exp|expl|explo|explor|explore|Ex|books?)\b\s*(.*)$/.exec(line);
    if (!m) return false;
    const cmd = m[1];
    const arg = m[2].trim();
    if (cmd.startsWith('vs')) runWin('vsplit', { arg });
    else if (cmd.startsWith('sp')) runWin('split', { arg });
    else if (cmd.startsWith('on')) runWin('only');
    else if (cmd.startsWith('zo')) runWin('zoom');
    else if (cmd.startsWith('clo') || cmd === 'q' || cmd === 'quit') runWin('close');
    else if (cmd.startsWith('book')) openBooks();
    else openFloating();
    return true;
  }

  function fmtPath(): string {
    if (pane === 'note' && notes.selected) return normalizePath(notes.selected.path);
    return '/';
  }

  /** Top-bar crumb: the explorer at that folder. */
  function exploreCrumb(i: number): void {
    openFloating({ dir: noteCrumbs.slice(0, i + 1).join('/') });
  }
</script>

<!-- Hover previews are delegated: any rendered note link (reader,
     split preview, Live Preview, secondary panes) under this root. -->
<div class="vault-home" bind:this={rootEl} onpointerover={onHoverOver} onpointerout={onHoverOut} role="presentation" data-vim={editMode && eff.vim ? vimState.mode : 'none'} class:note-dragging={noteDragging}>
  <header class="topbar">
    <div class="top-left">
      <button class="book-btn" type="button" onclick={openBooks} title="Switch book (gb)" aria-label="Switch book: {books.active?.name ?? 'Book'}" data-testid="book-switcher">
        <span class="ui-wordmark alive"><span class="mark"></span></span>
        {#if activeStatus}<SyncDot state={activeStatus.state} pending={activeStatus.pending} vaultID={vaults.selectedID ?? undefined} />{/if}
        <span class="book-name">{books.active?.name ?? vaults.selected?.name ?? 'Book'}</span>
        <svg class="caret" viewBox="0 0 16 16" width="10" height="10" aria-hidden="true"><path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      {#if pane === 'note' && notes.selected}
        <nav class="breadcrumb" aria-label="Note location" data-testid="breadcrumb">
          {#each noteCrumbs as c, i (i)}
            <button class="crumb" type="button" onclick={() => exploreCrumb(i)} title="Explore {noteCrumbs.slice(0, i + 1).join('/')}/">{c}</button>
            <span class="sep" aria-hidden="true">/</span>
          {/each}
          <span class="crumb-kind" aria-hidden="true"><NoteIcon kind={noteIconKind(notes.selected, notes.content?.id === notes.selected.id ? notes.content : null)} size={12} /></span>
          <span class="crumb-note" aria-current="page">{notes.selected.title}</span>
        </nav>
      {/if}
    </div>
    <div class="topbar-right">
      <button class="ui-btn ghost sm explorer-btn" type="button" onclick={() => openFloating()} aria-label="Explorer" aria-haspopup="dialog" aria-expanded={!!fx} title="Explorer (-, {eff.leader}e, :explore)" data-testid="explorer-button">
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M1.75 4.25a1.5 1.5 0 0 1 1.5-1.5h3l1.5 1.75h5a1.5 1.5 0 0 1 1.5 1.5v6.25a1.5 1.5 0 0 1-1.5 1.5h-9.5a1.5 1.5 0 0 1-1.5-1.5z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>
        <span class="explorer-label">Explorer</span><kbd>-</kbd>
      </button>
      <SyncStatusPopover />
      <button class="ui-btn ghost sm icon" onclick={beginCreate} type="button" disabled={structuralOffline}
        title={structuralOffline ? OFFLINE_HINT : 'New note (a)'} aria-label="New note">
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
      </button>
      <button class="ui-btn ghost sm palette-btn" onclick={() => (paletteMode = 'all')} type="button" title="Command palette (space, {keyLabel('⌘K')})">
        <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="m10.5 10.5 3 3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
        <span class="palette-label">Search</span><kbd>{keyLabel('⌘K')}</kbd>
      </button>
      <button class="ui-btn ghost sm icon" onclick={() => uiState.openSettings('editor')} type="button" title="Settings (,)" aria-label="Settings">
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M2 4.5h7M12 4.5h2M2 11.5h2M7 11.5h7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><circle cx="10.5" cy="4.5" r="1.6" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="5.5" cy="11.5" r="1.6" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>
      </button>
    </div>
  </header>

  {#if offlineHint}
    <div class="banner" role="status" data-testid="offline-hint">{offlineHint}</div>
  {/if}
  {#if orphanConflicts.length > 0}
    <div class="banner conflict" role="status" data-testid="orphan-conflicts">
      <span>
        {orphanConflicts.length} {orphanConflicts.length === 1 ? 'cópia local' : 'cópias locais'} de notas apagadas no servidor
        ({orphanConflicts.map((c) => c.title || c.noteID).join(', ')}) não {orphanConflicts.length === 1 ? 'foi mesclada' : 'foram mescladas'}.
      </span>
      <span class="banner-actions">
        <button class="ui-btn sm" type="button" onclick={() => exportAllConflicts(orphanConflicts)}>Baixar</button>
        <button class="ui-btn sm ghost" type="button" onclick={() => { for (const c of orphanConflicts) void offline.discardConflict(c.id); }}>Descartar</button>
      </span>
    </div>
  {/if}
  {#each books.banners as b (b.id)}
    <div class="banner" role="status">
      <span>{b.text}</span>
      <button class="ui-btn sm ghost" type="button" onclick={() => books.dismissBanner(b.id)}>{b.kind === 'dedupe' ? 'Manter' : 'ok'}</button>
    </div>
  {/each}

  {#if activeRevoked && books.active}
    <div class="placeholder" data-testid="book-revoked">
      <p>Você não tem mais acesso a este livro.</p>
      <button class="ui-btn sm" type="button" onclick={() => books.active && books.removeFromList(books.active.id)}>Remover da lista</button>
    </div>
  {:else if activeStatus?.state === 'needs_login' && books.active}
    <div class="placeholder" data-testid="book-needs-login">
      <p>Entre em {serverLabel(books.active.server_url)} para sincronizar.</p>
      <button class="ui-btn sm primary" type="button" onclick={() => books.active && uiState.openSignIn(books.active.server_url, books.active.account)}>Entrar</button>
    </div>
  {:else if notes.listErrorStatus === 403}
    <!-- The vault IS in our list (we routed here from it) but its
         notes 403 — on a federated replica this usually means the
         home server hasn't granted this account access yet. -->
    <div class="placeholder">
      You don’t have access to this vault’s notes yet. If this is a
      federated replica, you may be awaiting an access grant from
      the home server — ask its operator, then refresh.
    </div>
  {:else if notes.listError}
    <div class="error">{notes.listError}</div>
  {:else if pane === 'home'}
    {@render bookHome()}
  {:else}
    <!-- Right-click on the open note: the note's menu. -->
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <main
      class="stage preview"
      class:split-host={editMode && splitOn && !multi}
      class:multi
      class:pane-focus={multiPane && activePane === 'main' && !multi}
      data-pane={multi ? undefined : 'main'}
      data-leaf={multi ? undefined : primaryLeaf}
      data-note-path={multi ? undefined : leafPath(primaryLeaf)}
      data-testid="stage"
      bind:this={previewEl}
      tabindex="-1"
      aria-label="Note"
      oncontextmenu={multi ? undefined : onReaderContext}
      ondragover={onStageDragOver}
      ondragleave={(e) => { if (!previewEl?.contains(e.relatedTarget as Node | null)) dropAt = null; }}
      ondrop={onStageDrop}
    >
      {#if multi && panes}
        {#if narrowView}
          <div class="pane-tabs" role="tablist" aria-label="Panes">
            {#each leafList as l (l.id)}
              <button type="button" role="tab" class="pane-tab" class:active={l.id === activeLeafId} aria-selected={l.id === activeLeafId}
                onclick={() => focusLeaf(l.id)}>{notes.list.find((n) => n.id === l.note)?.title ?? l.note}</button>
            {/each}
          </div>
          <div class="pane-stack">
            {#each leafList as l (l.id)}
              <div class="pane-slot" class:hidden={l.id !== activeLeafId}>{@render paneLeaf(l)}</div>
            {/each}
          </div>
        {:else}
          <div class="pane-host" data-testid="pane-host">
            <PaneTree
              node={panes.root}
              leaf={paneLeaf}
              {zoomed}
              onresize={(id, i, at) => { if (panes) panes = resizeSplit(panes, id, i, at); }}
              onequalize={() => { if (panes) panes = equalize(panes); }}
            />
          </div>
        {/if}
      {:else}
        {@render mainContent()}
      {/if}
      {#if dropAt}
        <!-- Where the dragged note will land (edge highlight). -->
        {@const st = previewEl?.getBoundingClientRect()}
        {@const r = dropAt.rect}
        <div class="drop-ghost" data-side={dropAt.t.side} aria-hidden="true"
          style="left: {r.left - (st?.left ?? 0)}px; top: {r.top - (st?.top ?? 0)}px; width: {r.width}px; height: {r.height}px"
        ><span class="drop-edge"></span><span class="drop-label">{dropAt.t.side === 'left' ? 'Open left' : dropAt.t.side === 'right' ? 'Open right' : dropAt.t.side === 'top' ? 'Open above' : 'Open below'}</span></div>
      {/if}
    </main>
  {/if}

  {#if editorSettings.value.legend}
    <CommandLegend items={legendItems} pending={legendPending} mode={editMode && editSession && eff.vim && !fx ? null : legendMode} onaction={onLegendAction} onmore={() => (uiState.helpOpen = true)} />
  {/if}

  <footer class="statusbar" data-testid="editor-status">
    {#if editMode && editSession && eff.vim}
      <ModePill mode={vimState.mode} label={vimModeLabel(vimState.mode, vimState.sub)} />
      {#if vimState.pending && !editorSettings.value.legend}<span class="sb-pending">{vimState.pending}</span>{/if}
    {/if}
    {#if zoomed}<button type="button" class="sb-zoom" onclick={() => toggleZoom()} title="Zoomed pane — ⌃w z or :zoom restores the layout" data-testid="status-zoom">zoomed</button>{/if}
    <span class="sb-path mono" title={fmtPath()}>{fmtPath()}</span>
    {#if !editMode}
      <span class="sb-item" aria-live="off">{notes.list.length} notes{notes.loadingMore ? '…' : ''}</span>
      {#if notes.stale}<span class="sb-item stale" data-testid="list-stale" title="Última lista conhecida; atualiza quando a conexão voltar.">lista offline{notes.staleAt ? ` de ${new Date(notes.staleAt).toLocaleString()}` : ''}</span>{/if}
      {#if yanked}<span class="sb-item">yanked {yanked.name}</span>{/if}
    {/if}
    {#if editMode && editSession}
      {#if editorStats}
        <span class="sb-item">{editorStats.words} {editorStats.words === 1 ? 'word' : 'words'}</span>
        <span class="sb-item">Ln {editorStats.line}, Col {editorStats.col}</span>
      {/if}
      <span class="sb-item">{editorSettings.value.editMode === 'live' ? 'Live Preview' : 'Source'}</span>
    {/if}
    <span class="sb-spacer"></span>
    {#if editMode && editSession}
      <span class="sb-item sync" class:pending={editSession.pending} class:offline={!editSession.pending && !editSession.liveSynced} data-testid="editor-sync-state" title={editSession.persistence
        ? 'Edits sync live; offline they are kept in this browser and sent when the connection returns.'
        : 'Edits sync live; the file on disk follows within ~500 ms.'}>
        {editSession.pending
          ? 'Pending sync…'
          : editSession.liveSynced
            ? 'Saved live'
            : editSession.persistence
              ? 'Offline — kept on this device'
              : 'Offline — kept in this tab'}
      </span>
    {/if}
    <button class="sb-help" type="button" onclick={() => (uiState.helpOpen = true)} title="Keyboard shortcuts (?)">?</button>
  </footer>

  <ToastStack />

  {#if paletteMode}
    <CommandPalette
      commands={paletteCommands}
      notes={notes.list}
      commandMode={paletteMode === 'command'}
      onex={runExLine}
      onnote={openNote}
      onclose={() => { paletteMode = null; }}
    />
  {/if}

  {#if menu}
    <ContextMenu x={menu.x} y={menu.y} items={menu.items} title={menu.title} onrun={runMenu} onclose={() => (menu = null)} />
  {/if}

  {#if fx && vaults.selectedID}
    {#key fx.key}
      <FloatingExplorer
        vaultID={vaults.selectedID}
        bookName={vaults.selected?.name ?? books.active?.name ?? 'Book'}
        startNote={fx.startNote}
        startDir={fx.startDir}
        level={fx.level}
        initial={fx.initial}
        ops={fxOps}
        bind:yanked
        onopen={fxOpen}
        ondragnote={(on) => { noteDragging = on; if (!on) dropAt = null; }}
        onedit={(id) => { closeFloating(); void editNote(id); }}
        onbook={(id) => { fx = null; books.setActive(id); }}
        onapp={fxApp}
        onlevel={(l) => (fxLevel = l)}
        onnewbook={() => (uiState.createBookOpen = true)}
        onmanage={() => books.openPicker()}
        onclose={closeFloating}
      />
    {/key}
  {/if}

  {#if hover && vaults.selectedID}
    <HoverCard
      target={hover.target}
      vaultID={vaults.selectedID}
      anchor={hover.anchor}
      keyboard={hover.keyboard}
      onopen={openFromHover}
      onclose={closeHover}
      onhold={() => hoverIntent.hold()}
      onleave={() => { if (!hover?.keyboard) hoverIntent.leave(); }}
    />
  {/if}

  {#if hintsOpen}
    <HintOverlay root={hintRoot ?? (() => rootEl)} onclose={() => { hintsOpen = false; hintRoot = null; }} />
  {/if}

  {#if uiState.helpOpen}
    <HelpOverlay leader={eff.leader} onclose={() => (uiState.helpOpen = false)} />
  {/if}

  {#if showSettings}
    <VaultSettingsModal onclose={() => (showSettings = false)} />
  {/if}

  {#if uiState.createBookOpen}
    <VaultCreateModal onclose={() => (uiState.createBookOpen = false)} onCreated={(id) => vaults.select(id)} />
  {/if}
</div>

{#snippet bookHome()}
  <!-- The book's calm home: shown when no note is open (SPEC-PARTE2 §2). -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <section class="stage home" bind:this={homeEl} tabindex="-1" aria-label="{vaults.selected?.name ?? 'Book'} home" data-testid="book-home">
    <!-- Ambient light: two slow, soft blooms of the theme's colours
         (CSS only, transform-animated, paused when the tab is hidden,
         absent under Reduce Motion). Calm: a full cycle is ~48 s. -->
    <div class="ambient" aria-hidden="true"><span class="bloom a"></span><span class="bloom b"></span><span class="grain"></span></div>
    <div class="home-inner">
      <p class="ui-eyebrow home-eyebrow">book</p>
      <h1 class="home-title">{books.active?.name ?? vaults.selected?.name ?? 'Book'}</h1>
      <p class="home-meta">
        {#if activeStatus}<SyncDot state={activeStatus.state} pending={activeStatus.pending} label vaultID={vaults.selectedID ?? undefined} />{/if}
        <span class="home-dot" aria-hidden="true">·</span>
        <span data-testid="home-count">{notes.loadingList && notes.list.length === 0 ? '…' : notes.list.length} {notes.list.length === 1 ? 'note' : 'notes'}</span>
        {#if books.active}<span class="home-dot" aria-hidden="true">·</span><span class="mono">{books.active.account}@{serverLabel(books.active.server_url)}</span>{/if}
      </p>
      <div class="home-actions">
        <button class="ui-btn primary" type="button" onclick={() => openFloating()} data-testid="home-explore">
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M1.75 4.25a1.5 1.5 0 0 1 1.5-1.5h3l1.5 1.75h5a1.5 1.5 0 0 1 1.5 1.5v6.25a1.5 1.5 0 0 1-1.5 1.5h-9.5a1.5 1.5 0 0 1-1.5-1.5z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>
          Explore <kbd class="on-primary">-</kbd>
        </button>
        <button class="ui-btn" type="button" onclick={beginCreate} disabled={structuralOffline}>New note <kbd>a</kbd></button>
        <button class="ui-btn ghost" type="button" onclick={openBooks}>Switch book <kbd>gb</kbd></button>
      </div>
      {#if notes.loadingList && notes.list.length === 0}
        <div class="home-skel" aria-hidden="true" data-testid="home-skeleton">
          {#each [0, 1, 2, 3, 4] as i (i)}<span class="skeleton" style="width: {88 - i * 9}%"></span>{/each}
        </div>
      {:else if recents.length > 0}
        <h2 class="home-h">Recent</h2>
        <ul class="home-recent" data-testid="home-recent">
          {#each recents as n, i (n.id)}
            <li style="--i: {i}">
              <button type="button" class="recent glow" data-recent={i} data-hint-target onclick={(e) => openNote(n.id, { from: (e.currentTarget as HTMLElement).querySelector<HTMLElement>('.recent-title') })} onfocus={() => (homeIndex = i)}>
                <span class="recent-title">{n.title}</span>
                <span class="recent-dir mono">{dirOf(n.path) || '/'}</span>
                <span class="recent-when">{updatedLabel(n.updated_at)}</span>
              </button>
            </li>
          {/each}
        </ul>
      {:else}
        <div class="home-empty">
          <p class="empty-title">This book is empty</p>
          <p>Press <kbd>a</kbd> to create a note — <span class="mono">ideas</span>, <span class="mono">work/plan</span>, or a folder <span class="mono">journal/</span>.</p>
        </div>
      {/if}
      <p class="home-keys" aria-hidden="true"><kbd>-</kbd> explore · <kbd>j</kbd><kbd>k</kbd> recent · <kbd>space</kbd> commands · <kbd>[</kbd><kbd>]</kbd> books · <kbd>?</kbd> keys</p>
    </div>
  </section>
{/snippet}

{#snippet paneLeaf(l: PaneLeaf)}
  {#if l.id === primaryLeaf}
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div
      class="preview primary-pane"
      class:split-host={editMode && splitOn}
      class:active={activeLeafId === l.id}
      class:pane-focus={activePane === 'main'}
      data-pane="main"
      data-leaf={l.id}
      data-note-path={leafPath(primaryLeaf)}
      data-testid="primary-pane"
      tabindex="-1"
      role="region"
      aria-label="Pane: {notes.selected?.title ?? 'note'}"
      bind:this={primaryWrapEl}
      oncontextmenu={onReaderContext}
      onpointerdown={() => { if (panes) panes = focusLeafState(panes, l.id); }}
    >
      {@render mainContent()}
    </div>
  {:else if vaults.selectedID}
    <NotePane
      bind:this={paneRefs[l.id]}
      leaf={l}
      vaultID={vaults.selectedID}
      active={activeLeafId === l.id}
      onfocus={() => { if (panes && panes.active !== l.id) panes = focusLeafState(panes, l.id); focusedPane = 'leaf'; }}
      onclose={() => closeLeaf(l.id)}
      zoomed={zoomed === l.id}
      onzoom={() => toggleZoom(l.id)}
      onfollow={(href, where, from, wiki) => followLink(href, where, from, wiki, l.id)}
      onlink={(href, e, from) => routeClick(href, e, from, l.id)}
      onhover={(link, rect, from) => hoverKey(link, rect, from, l.id)}
      onexplore={() => openFloating()}
      onwin={(cmd, o) => runWin(cmd, o)}
      onpane={navigatePane}
      onpanepending={(p) => (panePending = p)}
      onvimstate={(st) => (vimState = st)}
      onstate={(st) => (paneInfo = { ...paneInfo, [l.id]: st })}
      onview={(v) => { if (panes) panes = setView(panes, l.id, v); }}
    />
  {/if}
{/snippet}

{#snippet mainContent()}
      {#if !notes.selectedID}
        <div class="placeholder">No note open</div>
      {:else if notes.loadingContent && !notes.content}
        <!-- Skeleton shimmer while the body loads. -->
        <article class="rendered lumi-prose" aria-busy="true" data-testid="reader-skeleton">
          <h1 class="rendered-title" data-vt-target="note-title">{notes.selected?.title ?? ''}</h1>
          <div class="reader-skel" aria-hidden="true">
            {#each [94, 88, 97, 62, 0, 91, 85, 73] as w, i (i)}{#if w}<span class="skeleton" style="width: {w}%"></span>{:else}<span class="gap"></span>{/if}{/each}
          </div>
        </article>
      {:else if notes.contentError}
        <div class="error">{notes.contentError}</div>
      {:else if notes.content}
        {#each noteConflicts as c (c.id)}
          <div class="banner conflict" role="status" data-testid="conflict-copy">
            <span>
              Cópia local em conflito ({c.reason === 'deleted' ? 'a nota foi apagada no servidor' : c.reason === 'lineage' ? 'outra versão da nota' : 'acesso revogado'}),
              salva em {new Date(c.at).toLocaleString()}. Ela não foi mesclada.
            </span>
            <span class="banner-actions">
              <button class="ui-btn sm" type="button" onclick={() => exportConflict(c)}>Baixar</button>
              <button class="ui-btn sm" type="button" onclick={() => void copyConflict(c)}>Copiar</button>
              <button class="ui-btn sm ghost" type="button" onclick={() => void offline.discardConflict(c.id)}>Descartar</button>
            </span>
          </div>
        {/each}
        {#if primaryView !== MARKDOWN_VIEW && vaults.selectedID && notes.selectedID}
          <!-- The board / canvas brings its own title bar and Board ⇄ Source toggle. -->
          <div class="view-frame">
            <NoteViewHost
              view={primaryView}
              vaultID={vaults.selectedID}
              noteID={notes.selectedID}
              notePath={leafPath(primaryLeaf)}
              body={notes.content.body ?? ''}
              active={activeLeafId === primaryLeaf}
              openLink={(href, where) => followLink(href, where, leafPath(primaryLeaf), false, primaryLeaf)}
              acquireSession={() => acquireEditorSession(vaults.selectedID!, notes.selectedID!)}
              releaseSession={(x) => editorPool.release(x)}
              title={notes.selected?.title ?? ''}
              onsource={() => { setPrimaryView(MARKDOWN_VIEW); void enterEdit(); }}
              onlink={onMdLink}
            />
          </div>
        {:else if editMode && editSession && NoteEditor}
          <div class="editor-frame" class:split={splitOn} class:mode-edge={!multi || activeLeafId === primaryLeaf}>
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <header class="note-bar" data-testid="note-bar" ondblclick={(e) => { if (multi && !(e.target as Element).closest('button, input')) toggleZoom(primaryLeaf); }}>
              <div class="nb-lead">
                {#if zoomed === primaryLeaf}<span class="zoom-badge" data-testid="zoom-badge">zoomed</span>{/if}
                <span class="conn-dot conn-{editSession.status}" data-testid="conn-status" title="Live sync: {editSession.status}">{editSession.status}</span>
                {#if noteCrumbs.length > 0}
                  <span class="nb-crumbs" aria-hidden="true">{noteCrumbs.join(' / ')}<span class="nb-sep">/</span></span>
                {/if}
                <button type="button" class="nb-title" data-vt-target="note-title" onclick={beginRename} title="Rename or move (r)">{notes.selected?.title}</button>
                {#if editSession.peers.length > 0}
                  <span class="peers">
                    {#each editSession.peers as p (p.clientID)}
                      <span class="peer-chip" style="--peer-color: {p.color}" title="{p.name} is here" data-testid="peer-chip">{p.name.slice(0, 1).toUpperCase()}<span class="peer-live" aria-hidden="true"></span></span>
                    {/each}
                  </span>
                {/if}
              </div>
              <div class="nb-actions">
                {#if primaryViews.length > 1}
                  <div class="ui-seg nb-seg" role="group" aria-label="View">
                    {#each primaryViews.filter((v) => v.id !== MARKDOWN_VIEW) as v (v.id)}
                      <button type="button" onclick={() => { exitEdit(); setPrimaryView(null); }} title="Back to the {v.label.toLowerCase()}">{v.label}</button>
                    {/each}
                  </div>
                {/if}
                <div class="ui-seg nb-seg" role="group" aria-label="View mode" data-testid="view-mode">
                  <button type="button" onclick={exitEditAnimated} title="Reading view ({keyLabel('⌘E')})">Reading</button>
                  <button type="button" class:active={editorSettings.value.editMode === 'live'}
                    aria-pressed={editorSettings.value.editMode === 'live'}
                    onclick={() => setEditMode('live')} title="Live Preview ({keyLabel('⌘⇧E')})">Live</button>
                  <button type="button" class:active={editorSettings.value.editMode === 'source'}
                    aria-pressed={editorSettings.value.editMode === 'source'}
                    onclick={() => setEditMode('source')} title="Source ({keyLabel('⌘⇧E')})">Source</button>
                </div>
                <button class="ui-btn ghost sm icon nb-icon split-btn" type="button" onclick={toggleSplit}
                  aria-pressed={splitOn} aria-label="Preview beside source"
                  title="Preview beside source ({eff.leader}p · {keyLabel('⌘⌥P')} · :preview split)">
                  <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M8 3v10" stroke="currentColor" stroke-width="1.3"/><path d="M10 6h2.5M10 8.5h2.5M10 11h1.5" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" opacity=".7"/></svg>
                </button>
                <button class="ui-btn ghost sm icon nb-icon nb-settings" type="button" onclick={() => uiState.openSettings('editor')}
                  aria-label="Editor settings" title="Editor settings (:settings)">
                  <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path d="M2.5 4.5h6M11.5 4.5h2M2.5 11.5h2M7.5 11.5h6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><circle cx="10" cy="4.5" r="1.6" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="6" cy="11.5" r="1.6" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>
                </button>
{#if multi}
                  <button class="ui-btn ghost sm icon zoom-btn" class:on={zoomed === primaryLeaf} type="button" onclick={() => toggleZoom(primaryLeaf)} aria-pressed={zoomed === primaryLeaf} aria-label={zoomed === primaryLeaf ? 'Unzoom pane' : 'Zoom pane'} title="{zoomed === primaryLeaf ? 'Unzoom' : 'Zoom'} (⌃w z · :zoom · double-click the header)">
                    {#if zoomed === primaryLeaf}<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M6.5 2.5v4h-4M9.5 13.5v-4h4M2.5 2.5l4 4M13.5 13.5l-4-4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>{:else}<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M9.5 2.5h4v4M6.5 13.5h-4v-4M13.5 2.5l-4.5 4.5M2.5 13.5 7 9" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>{/if}
                  </button>
                {/if}
                <span class="nb-divider" aria-hidden="true"></span>
                <button class="ui-btn sm nb-done" onclick={exitEditAnimated} type="button" title="Done (:q, {keyLabel('⌘E')})">Done</button>
              </div>
            </header>
            {#if editError}<div class="error">{editError}</div>{/if}
            {#if editSession.lastError}<div class="error" data-testid="session-error">{editSession.lastError}</div>{/if}
            {#if !editSession.editable}
              <!-- Join rule: read-only preview until the server's
                   SyncStep2 has arrived. Never a local seed. -->
              <div class="editor-scroll">
                <div class="placeholder" data-testid="editor-syncing">
                  {editSession.stopped ? 'Live editing unavailable.' : 'Connecting to live editor… (read-only until synced)'}
                </div>
                <article class="rendered lumi-prose readonly-preview" data-prose={editorSettings.value.proseFont}>
                  <MarkdownView blocks={previewBlocks} onlink={onMdLink} />
                </article>
              </div>
            {:else if editSession.emptyAtSync && (notes.content.body ?? '') !== ''}
              <!-- Legacy note: server CRDT never initialised. Editing an
                   empty doc would overwrite the file on the next mirror,
                   so require an explicit action. -->
              <div class="editor-scroll">
                <div class="error" data-testid="editor-uninitialised">
                  The server has no live-editing state for this note yet. Load the
                  file's current contents into the shared document to start editing.
                  <button class="ui-btn sm" onclick={initialiseFromFile} type="button">Load file contents</button>
                </div>
                <article class="rendered lumi-prose readonly-preview" data-prose={editorSettings.value.proseFont}>
                  <MarkdownView blocks={previewBlocks} onlink={onMdLink} />
                </article>
              </div>
            {:else}
              <SourceSplit
                bind:this={splitRef}
                enabled={splitOn}
                focused={multiPane && (activePane === 'editor' || activePane === 'split') ? activePane : null}
                onnarrow={(n) => (splitNarrow = n)}
                ytext={editSession.ytext}
                editorView={() => noteEditorRef?.editorView() ?? null}
                ratio={editorSettings.value.previewRatio}
                prose={editorSettings.value.proseFont}
                onratio={(r) => editorSettings.update({ previewRatio: r })}
                ontoggletask={toggleTaskInEditor}
                onlink={onMdLink}
              >
                <NoteEditor
                  bind:this={noteEditorRef}
                  session={editSession}
                  settings={editorSettings.value}
                  onexit={exitEditAnimated}
                  onopensettings={() => uiState.openSettings('editor')}
                  ontogglemode={() => editorSettings.toggleEditMode()}
                  ontogglesplit={toggleSplit}
                  onstats={(st) => (editorStats = st)}
                  notes={() => notes.list}
                  notePath={() => notes.selected?.path ?? notes.content?.path ?? ''}
                  onopennote={openLinkedNote}
                  onvimstate={(st) => (vimState = st)}
                  onpane={navigatePane}
                  onpanepending={(p) => (panePending = p)}
                  onquit={() => (multi ? closeLeaf(primaryLeaf) : exitEditAnimated())}
                  onwin={(cmd, o) => runWin(cmd, o)}
                  onfollow={(l, where) => followLink(l.href, where, leafPath(primaryLeaf), l.wiki, primaryLeaf)}
                  onhover={(l, r) => hoverKey(l, r, leafPath(primaryLeaf), primaryLeaf)}
                  onexplore={openFloating}
                  onfocus={() => { if (panes) panes = focusLeafState(panes, primaryLeaf); }}
                />
              </SourceSplit>
            {/if}
          </div>
        {:else if editorLoading}
          <div class="reader-skel editor-skel" aria-busy="true" aria-label="Loading editor">
            {#each [70, 92, 85, 40, 96, 77] as w, i (i)}<span class="skeleton" style="width: {w}%"></span>{/each}
          </div>
        {:else}
          <article class="rendered lumi-prose" data-prose={editorSettings.value.proseFont}>
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <header class="reading-head" ondblclick={(e) => { if (multi && !(e.target as Element).closest('button, input')) toggleZoom(primaryLeaf); }}>
              {#if zoomed === primaryLeaf}<span class="zoom-badge" data-testid="zoom-badge">zoomed</span>{/if}
              {#if noteCrumbs.length > 0}
                <nav class="note-crumbs" aria-label="Note location">
                  {#each noteCrumbs as c, i (i)}{#if i > 0}<span class="crumb-sep" aria-hidden="true">/</span>{/if}<span class="crumb-part">{c}</span>{/each}
                </nav>
              {/if}
              <div class="rendered-actions">
                {#if primaryViews.length > 1}
                  <div class="ui-seg nb-seg" role="group" aria-label="View">
                    {#each primaryViews as v (v.id)}
                      <button type="button" class:active={primaryView === v.id} aria-pressed={primaryView === v.id} onclick={() => setPrimaryView(v.id === primaryViews[0].id ? null : v.id)}>{v.label}</button>
                    {/each}
                  </div>
                {/if}
                {#if notes.contentStale}<span class="stale" data-testid="content-stale">cópia local (offline)</span>{/if}
                <span class="reading-meta">{readingWords} {readingWords === 1 ? 'word' : 'words'} · {readingMinutes} min</span>
                <button class="ui-btn ghost sm icon" type="button" onclick={() => void splitWith('row', null, primaryLeaf)} aria-label="Split right" title="Split right (⌃w v · :vsplit)">
                  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M8 3v10" stroke="currentColor" stroke-width="1.3"/></svg>
                </button>
{#if multi}
                  <button class="ui-btn ghost sm icon zoom-btn" class:on={zoomed === primaryLeaf} type="button" onclick={() => toggleZoom(primaryLeaf)} aria-pressed={zoomed === primaryLeaf} aria-label={zoomed === primaryLeaf ? 'Unzoom pane' : 'Zoom pane'} title="{zoomed === primaryLeaf ? 'Unzoom' : 'Zoom'} (⌃w z · :zoom · double-click the header)">
                    {#if zoomed === primaryLeaf}<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M6.5 2.5v4h-4M9.5 13.5v-4h4M2.5 2.5l4 4M13.5 13.5l-4-4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>{:else}<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M9.5 2.5h4v4M6.5 13.5h-4v-4M13.5 2.5l-4.5 4.5M2.5 13.5 7 9" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>{/if}
                  </button>
                {/if}
                <button class="ui-btn sm nb-edit" onclick={() => void enterEdit()} disabled={editorLoading} type="button" title="Edit (e · {keyLabel('⌘E')})">{editorLoading ? 'Loading…' : 'Edit'}</button>
                <button class="ui-btn ghost sm icon danger-hover" onclick={beginDelete} type="button" aria-label="Delete note"
                  disabled={structuralOffline} title={structuralOffline ? OFFLINE_HINT : 'Delete (d)'}>
                  <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>
                </button>
              </div>
            </header>
            {#if !titleInBody}<h1 class="rendered-title" data-vt-target="note-title">{notes.selected?.title}</h1>{/if}
            <!-- DOMPurify-sanitised blocks, see lib/markdown.ts. -->
            <MarkdownView blocks={previewBlocks} onlink={onMdLink} ontoggletask={(i) => void toggleTaskFromReader(i)} />
          </article>
        {/if}
      {/if}
{/snippet}

<style>
  .vault-home {
    --mode: var(--mode-normal);
    height: 100vh;
    height: 100dvh;
    background: var(--surface-0);
    color: var(--color-text);
    display: flex;
    flex-direction: column;
  }
  .vault-home[data-vim='insert'] { --mode: var(--mode-insert); }
  .vault-home[data-vim='visual'] { --mode: var(--mode-visual); }
  .vault-home[data-vim='replace'] { --mode: var(--mode-replace); }
  .mono { font-family: var(--font-mono); }

  /* ── top bar ───────────────────────────────────────────── */
  .topbar {
    position: relative;
    z-index: 5;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-3);
    height: 44px;
    padding: 0 var(--sp-2) 0 var(--sp-3);
    background: color-mix(in oklch, var(--surface-1) 55%, var(--surface-0));
    box-shadow: 0 1px 0 var(--hairline-soft), 0 6px 16px -14px rgb(var(--shadow-rgb) / var(--shadow-a));
    flex: none;
  }
  .top-left { display: flex; align-items: center; gap: var(--sp-1); min-width: 0; flex: 1; }
  .book-btn {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    max-width: 260px;
    height: 30px;
    padding: 0 10px 0 7px;
    border: 1px solid transparent;
    border-radius: var(--radius);
    background: transparent;
    color: var(--color-text);
    font: inherit;
    font-size: var(--text-sm);
    font-weight: 600;
    letter-spacing: var(--tracking-ui);
    cursor: pointer;
    transition: background var(--dur-tap) var(--ease), border-color var(--dur-fade) var(--ease), transform var(--spring-snappy-ms) var(--spring-snappy);
  }
  .book-btn:hover { background: var(--tint-hover); border-color: var(--hairline-soft); }
  .book-btn:active { transform: scale(0.97); }
  .book-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .book-btn .caret { flex: none; color: var(--ink-3); transition: transform var(--spring-snappy-ms) var(--spring-snappy); }
  .book-btn:hover .caret { transform: translateY(1px); }
  .explorer-btn { gap: 6px; }
  .explorer-btn[aria-expanded='true'] { background: var(--accent-soft); color: var(--accent-ink); }
  .explorer-btn kbd { margin-left: 2px; }
  .topbar-right { display: flex; align-items: center; gap: var(--sp-1); flex: none; }
  .palette-btn {
    gap: 7px;
    color: var(--ink-3);
    border-color: var(--hairline-soft);
    background: var(--surface-sunk);
    min-width: 168px;
    justify-content: flex-start;
    box-shadow: inset 0 1px 2px rgb(var(--shadow-rgb) / calc(var(--shadow-a) * 0.25));
  }
  .palette-btn:hover { color: var(--ink-2); border-color: var(--hairline); background: var(--surface-1); }
  .palette-btn kbd { margin-left: auto; }
  .palette-label { font-weight: 400; }

  .breadcrumb {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 2px;
    overflow-x: auto;
    white-space: nowrap;
    font-size: var(--text-sm);
    scrollbar-width: none;
  }
  .breadcrumb::-webkit-scrollbar { display: none; }
  .crumb {
    background: transparent;
    border: none;
    color: var(--ink-3);
    font-size: inherit;
    cursor: pointer;
    padding: 3px 6px;
    border-radius: var(--radius-sm);
    transition: background var(--dur-tap) var(--ease), color var(--dur-fade) var(--ease);
  }
  .crumb:hover, .crumb:focus-visible { background: var(--tint-hover); color: var(--color-text); }
  .crumb-note { color: var(--color-text); font-weight: 550; overflow: hidden; text-overflow: ellipsis; padding: 0 4px; animation: crumb-in var(--spring-gentle-ms) var(--spring-gentle) both; }
  @keyframes crumb-in { from { opacity: 0; transform: translateX(-4px); } }
  .sep { color: var(--ink-4); }

  /* ── stage: the note (or the book's home) fills it ─────── */
  .stage { position: relative; flex: 1; min-height: 0; min-width: 0; }
  .stage.preview { view-transition-name: lumi-pane; }

  /* ── the book's home ───────────────────────────────────── */
  .home { position: relative; isolation: isolate; overflow-y: auto; outline: none; display: flex; justify-content: center; }
  /* Ambient light: two blooms of the theme's own colours drifting on a
     48 s cycle. Transform-only (compositor), large soft gradients (no
     blur filter), paused while the tab is hidden; none under Reduce
     Motion (the static light stays — calm, not empty). */
  .ambient { position: absolute; inset: 0; z-index: -1; overflow: hidden; pointer-events: none; contain: strict; }
  .bloom { position: absolute; border-radius: 50%; will-change: transform; }
  .bloom.a {
    width: 78vmax; height: 78vmax; left: -22vmax; top: -38vmax;
    background: radial-gradient(closest-side, color-mix(in oklch, var(--color-primary) 15%, transparent), color-mix(in oklch, var(--color-primary) 5%, transparent) 55%, transparent);
    animation: ambient-drift-a var(--dur-ambient) var(--ease-breath) infinite alternate;
  }
  .bloom.b {
    width: 64vmax; height: 64vmax; right: -24vmax; bottom: -34vmax;
    background: radial-gradient(closest-side, color-mix(in oklch, var(--color-secondary) 12%, transparent), color-mix(in oklch, var(--color-accent) 4%, transparent) 60%, transparent);
    animation: ambient-drift-b calc(var(--dur-ambient) * 1.27) var(--ease-breath) infinite alternate;
  }
  :global(:root[data-theme='light']) .bloom.a { opacity: 0.8; }
  /* A whisper of grain keeps big gradients from banding. */
  .grain {
    position: absolute;
    inset: 0;
    opacity: 0.035;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
    mix-blend-mode: overlay;
  }
  .home-inner { width: min(640px, 100%); padding: clamp(28px, 10vh, 112px) var(--sp-5) var(--sp-7); animation: home-in var(--spring-soft-ms) var(--spring-soft) both; }
  @keyframes home-in { from { opacity: 0; transform: translateY(10px); } }
  .home-eyebrow { margin: 0 0 var(--sp-2); }
  .home-title {
    margin: 0;
    font-size: clamp(2rem, 4vw, var(--text-3xl));
    line-height: 1.06;
    letter-spacing: -0.032em;
    font-weight: 720;
    color: var(--md-heading, var(--color-text));
    text-wrap: balance;
    background: linear-gradient(180deg, var(--color-text) 30%, color-mix(in oklch, var(--color-text) 72%, var(--color-primary)));
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
  }
  .home-meta { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; margin: var(--sp-3) 0 0; font-size: var(--text-sm); color: var(--ink-3); }
  .home-dot { color: var(--ink-4); }
  .home-actions { display: flex; flex-wrap: wrap; gap: var(--sp-2); margin: var(--sp-5) 0 var(--sp-6); }
  .home-actions .ui-btn { gap: 7px; height: 32px; padding: 0 14px; }
  .home-actions :global(kbd.on-primary) { background: color-mix(in oklch, black 18%, transparent); border-color: transparent; color: inherit; box-shadow: none; }
  .home-h { margin: 0 0 var(--sp-2); padding-left: 12px; font-family: var(--font-mono); font-size: var(--text-2xs); font-weight: 500; letter-spacing: var(--tracking-caps); text-transform: uppercase; color: var(--ink-3); }
  .home-recent { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 1px; }
  .home-recent li { animation: recent-in var(--spring-gentle-ms) var(--spring-gentle) both; animation-delay: calc(min(var(--i, 0), 8) * 22ms + 80ms); }
  @keyframes recent-in { from { opacity: 0; transform: translateY(6px); } }
  .recent {
    width: 100%;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    align-items: baseline;
    gap: var(--sp-3);
    padding: 10px 12px;
    border: none;
    border-radius: var(--radius);
    background: transparent;
    color: var(--color-text);
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition: background var(--dur-tap) var(--ease), transform var(--spring-snappy-ms) var(--spring-snappy), box-shadow var(--dur-fade) var(--ease);
  }
  .recent:hover { background: var(--surface-1); box-shadow: 0 0 0 1px var(--hairline-soft); }
  .recent:active { transform: scale(0.985); }
  .recent:focus-visible { outline: none; background: var(--accent-wash); box-shadow: inset 2px 0 0 var(--accent), 0 0 0 1px var(--accent-soft); }
  .recent-title { font-weight: 550; letter-spacing: var(--tracking-ui); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; transition: transform var(--spring-snappy-ms) var(--spring-snappy); }
  .recent:hover .recent-title { transform: translateX(2px); }
  .recent-dir { font-size: var(--text-2xs); color: var(--ink-4); max-width: 22ch; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .recent-when { font-size: var(--text-xs); color: var(--ink-3); font-variant-numeric: tabular-nums; }
  .home-empty { padding: var(--sp-5) 0; color: var(--ink-3); font-size: var(--text-sm); }
  .home-keys { margin-top: var(--sp-6); padding-left: 12px; font-size: var(--text-xs); color: var(--ink-4); }
  .home-keys kbd { margin: 0 1px; }
  .home-skel, .reader-skel { display: flex; flex-direction: column; gap: 12px; padding-top: var(--sp-2); }
  .home-skel .skeleton { height: 36px; border-radius: var(--radius); }
  .reader-skel .skeleton { height: 12px; border-radius: 6px; }
  .reader-skel .gap { height: 8px; }
  .editor-skel { max-width: calc(var(--md-measure) + 2px); margin: var(--sp-6) auto; padding: 0 var(--sp-5); }

  @media (max-width: 720px) {
    .book-btn { max-width: 46vw; }
    .book-btn .ui-wordmark { display: none; }
    .breadcrumb .crumb { display: none; }
    .breadcrumb .sep { display: none; }
    .palette-btn { min-width: 0; background: transparent; box-shadow: none; border-color: transparent; }
    .palette-label, .palette-btn kbd, .explorer-label, .explorer-btn kbd { display: none; }
    .preview { padding: var(--sp-5) var(--sp-4); }
    .sb-item:not(.sync):not(.stale) { display: none; }
    .recent { grid-template-columns: minmax(0, 1fr) auto; padding: 12px; }
    .recent-dir { display: none; }
    .home-keys { display: none; }
  }

  .preview {
    overflow-y: auto;
    padding: var(--sp-6) var(--sp-6) var(--sp-7);
    outline: none;
  }

  /* ── split note panes (SPEC-PARTE2 §3) ─────────────────── */
  .preview.multi { padding: 0; overflow: hidden; display: flex; flex-direction: column; background: var(--surface-sunk); }
  .pane-host { flex: 1; min-height: 0; display: flex; }
  .pane-host > :global(*) { flex: 1; min-width: 0; }
  .primary-pane {
    position: relative;
    height: 100%;
    min-width: 0;
    overflow-y: auto;
    outline: none;
    padding: var(--sp-6) clamp(16px, 4%, 40px) var(--sp-7);
    background: var(--surface-0);
  }
  .primary-pane:has(> .editor-frame), .primary-pane:has(> .view-frame) { padding: 0; overflow: hidden; }
  .pane-tabs {
    flex: none;
    display: flex;
    gap: 2px;
    padding: 4px var(--sp-2) 0;
    border-bottom: 1px solid var(--hairline);
    overflow-x: auto;
    scrollbar-width: none;
  }
  .pane-tab {
    flex: none;
    max-width: 46vw;
    padding: 6px 10px;
    border: none;
    border-bottom: 2px solid transparent;
    background: transparent;
    color: var(--ink-3);
    font-size: var(--text-xs);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: pointer;
    transition: color var(--dur-fade) var(--ease), border-color var(--spring-snappy-ms) var(--spring-snappy);
  }
  .pane-tab.active { color: var(--color-text); border-bottom-color: var(--accent); font-weight: 600; }
  .pane-stack { flex: 1; min-height: 0; display: flex; }
  .pane-slot { flex: 1; min-width: 0; min-height: 0; display: flex; }
  .pane-slot > :global(*) { flex: 1; min-width: 0; }
  .pane-slot.hidden { display: none; }
  .view-frame { display: flex; flex-direction: column; height: 100%; min-height: 0; }
  .view-frame > :global(:last-child) { flex: 1; min-height: 0; }
  .nb-title.static { cursor: default; }
  .nb-title.static:hover { background: transparent; }

  /* zoom (tmux): a badge in the pane header and the status line */
  .zoom-badge, .sb-zoom {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 18px;
    padding: 0 7px;
    border-radius: var(--radius-pill);
    background: var(--accent-soft);
    color: var(--accent-ink);
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    font-weight: 600;
    letter-spacing: 0.02em;
    animation: badge-in var(--spring-bouncy-ms) var(--spring-bouncy) both;
  }
  .zoom-badge::before, .sb-zoom::before { content: ''; width: 5px; height: 5px; border-radius: 50%; background: currentColor; box-shadow: 0 0 6px currentColor; }
  .sb-zoom { border: none; cursor: pointer; height: 16px; }
  @keyframes badge-in { from { opacity: 0; transform: scale(0.7); } }
  .zoom-btn.on { color: var(--accent-ink); background: var(--accent-soft); }
  .reading-head .zoom-badge { margin-right: var(--sp-2); }

  /* drag a note from the explorer onto a pane edge */
  .drop-ghost {
    position: absolute;
    z-index: 30;
    pointer-events: none;
    display: flex;
    animation: ui-fade var(--dur-fade) var(--ease);
  }
  .drop-edge {
    position: absolute;
    border-radius: var(--radius-lg);
    background: linear-gradient(var(--accent-soft), var(--accent-wash));
    box-shadow: inset 0 0 0 1.5px var(--accent-line), 0 0 40px -8px var(--accent-glow);
    transition: inset var(--spring-glide-ms) var(--spring-glide);
    inset: 8px 8px 8px 50%;
  }
  .drop-ghost[data-side='left'] .drop-edge { inset: 8px 50% 8px 8px; }
  .drop-ghost[data-side='top'] .drop-edge { inset: 8px 8px 50% 8px; }
  .drop-ghost[data-side='bottom'] .drop-edge { inset: 50% 8px 8px 8px; }
  .drop-label {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    padding: 5px 11px;
    border-radius: var(--radius-pill);
    background: var(--glass-bg-strong);
    -webkit-backdrop-filter: var(--glass-blur);
    backdrop-filter: var(--glass-blur);
    box-shadow: var(--elev-2);
    color: var(--accent-ink);
    font-size: var(--text-xs);
    font-weight: 600;
  }
  .drop-ghost[data-side='left'] .drop-label { left: 25%; }
  .drop-ghost[data-side='right'] .drop-label { left: 75%; }
  .drop-ghost[data-side='top'] .drop-label { top: 25%; }
  .drop-ghost[data-side='bottom'] .drop-label { top: 75%; }

  /* ── reading view ──────────────────────────────────────── */
  /* Typeface, size and leading come from .lumi-prose (app.css), shared
     with the split preview and Live Preview. */
  .rendered {
    max-width: calc(var(--md-measure) + 2px);
    margin: 0 auto;
    padding-bottom: 20vh;
  }
  .split-btn[aria-pressed='true'] { color: var(--accent-ink); background: var(--accent-soft); }
  .reading-head {
    position: sticky;
    top: calc(-1 * var(--sp-6));
    z-index: 2;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-3);
    min-height: 30px;
    margin: calc(-1 * var(--sp-6)) 0 var(--sp-5);
    padding: var(--sp-3) 0;
    font-family: var(--font-ui);
    font-size: var(--text-md);
    line-height: 1.4;
    background: linear-gradient(to bottom, var(--surface-0) 70%, transparent);
  }
  .note-crumbs {
    display: flex;
    align-items: baseline;
    gap: 6px;
    min-width: 0;
    font-size: var(--text-sm);
    color: var(--ink-3);
    overflow: hidden;
    white-space: nowrap;
  }
  .crumb-part { overflow: hidden; text-overflow: ellipsis; }
  .crumb-sep { color: var(--ink-4); }
  .rendered-actions { display: flex; gap: var(--sp-1); align-items: center; margin-left: auto; }
  .reading-meta { color: var(--ink-3); font-size: var(--text-xs); font-variant-numeric: tabular-nums; margin-right: var(--sp-2); }
  .rendered-title {
    margin: 0 0 0.6em;
    font-size: 2.05em;
    line-height: 1.12;
    font-weight: 720;
    letter-spacing: -0.028em;
    color: var(--md-heading);
    text-wrap: balance;
  }
  .rendered :global(.md-body) { animation: resolve-in var(--spring-gentle-ms) var(--spring-gentle) both; }
  .danger-hover:hover { color: var(--color-error); }

  /* ── states ────────────────────────────────────────────── */
  .placeholder,
  .error {
    padding: var(--sp-6) var(--sp-4);
    color: var(--ink-3);
    text-align: center;
    font-size: var(--text-sm);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--sp-3);
  }
  .error { color: var(--color-error); }
  .empty-title { color: var(--color-text); font-weight: 650; font-size: var(--text-lg); letter-spacing: var(--tracking-ui); }
  .stale { color: var(--color-warning); font-size: var(--text-xs); }
  .banner {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--sp-3);
    flex-wrap: wrap;
    margin: var(--sp-2) var(--sp-3) 0;
    padding: var(--sp-2) var(--sp-3);
    background: var(--accent-wash);
    border: 1px solid var(--accent-soft);
    border-radius: var(--radius);
    font-size: var(--text-xs);
    animation: settle-in var(--spring-gentle-ms) var(--spring-gentle) both;
  }
  .banner.conflict {
    background: color-mix(in oklch, var(--color-warning) 10%, transparent);
    border-color: color-mix(in oklch, var(--color-warning) 40%, transparent);
  }
  .preview .banner { margin: 0 auto var(--sp-3); max-width: calc(var(--md-measure) + 2px); }
  .banner-actions { display: inline-flex; gap: var(--sp-1); flex-wrap: wrap; }

  /* ── editor ────────────────────────────────────────────── */
  /* The pane is the editor: a slim note bar on top, the writing
     column below (centred by the editor itself), the scrollbar at the
     pane edge. */
  .preview:has(> .editor-frame) { padding: 0; overflow: hidden; }
  .preview:has(> .view-frame) { padding: 0; overflow: hidden; }
  .editor-frame {
    position: relative;
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }
  /* Mode edge: the editing pane's left edge carries the vim mode's
     colour (normal = accent, insert = cyan, visual = violet, replace =
     red), fading downwards. Colour transitions only — never on the
     key path's critical work (it is one 2px layer). */
  .editor-frame.mode-edge::after {
    content: '';
    position: absolute;
    left: 0;
    top: 44px;
    bottom: 0;
    width: 2px;
    background-color: var(--mode);
    -webkit-mask-image: linear-gradient(to bottom, black, transparent 75%);
    mask-image: linear-gradient(to bottom, black, transparent 75%);
    opacity: 0.85;
    pointer-events: none;
    transition: background-color var(--dur-fade) var(--ease);
  }
  .vault-home[data-vim='none'] .editor-frame.mode-edge::after { opacity: 0.35; }
  .editor-frame > .error { flex: none; padding: var(--sp-3) var(--sp-4); }
  .editor-scroll { flex: 1; min-height: 0; overflow-y: auto; padding: var(--sp-5) var(--sp-5) 0; }
  .note-bar {
    position: relative;
    flex: none;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-3);
    height: 44px;
    padding: 0 var(--sp-3) 0 var(--sp-4);
    border-bottom: 1px solid var(--hairline-soft);
    background: color-mix(in oklch, var(--surface-1) 40%, var(--surface-0));
  }
  /* The mode also tints the bar's bottom edge (a soft line of light). */
  .editor-frame.mode-edge > .note-bar::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    bottom: -1px;
    height: 1px;
    background-color: var(--mode);
    -webkit-mask-image: linear-gradient(to right, black, transparent 60%);
    mask-image: linear-gradient(to right, black, transparent 60%);
    opacity: 0.6;
    transition: background-color var(--dur-fade) var(--ease);
  }
  .nb-lead { display: flex; gap: var(--sp-2); align-items: center; min-width: 0; flex: 1; }
  .nb-crumbs {
    flex: none;
    max-width: 30%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--ink-3);
    font-size: var(--text-sm);
  }
  .nb-sep { margin-left: 6px; color: var(--ink-4); }
  .nb-title {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    margin: 0 -6px;
    padding: 3px 6px;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text);
    font-size: var(--text-sm);
    font-weight: 600;
    letter-spacing: var(--tracking-ui);
    cursor: text;
    transition: background var(--dur-tap) var(--ease);
  }
  .nb-title:hover { background: var(--tint-hover); }
  .nb-actions { flex: none; display: flex; gap: 2px; align-items: center; }
  .nb-seg { margin-right: var(--sp-1); }
  .nb-seg button { height: 22px; padding: 0 10px; }
  .nb-icon { color: var(--ink-3); }
  .nb-icon:hover { color: var(--color-text); }
  .nb-divider { width: 1px; height: 16px; margin: 0 var(--sp-2); background: var(--hairline); }
  .nb-done { height: 26px; padding: 0 12px; }
  .conn-dot {
    position: relative;
    flex: none;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--ink-4);
    font-size: 0;
    color: transparent;
    transition: background var(--dur-fade) var(--ease), box-shadow var(--spring-gentle-ms) var(--spring-gentle);
  }
  .conn-connected { background: var(--color-accent); box-shadow: 0 0 0 3px color-mix(in oklch, var(--color-accent) 16%, transparent), 0 0 8px color-mix(in oklch, var(--color-accent) 50%, transparent); }
  .conn-connecting { background: var(--color-warning); animation: sync-breathe 1.6s var(--ease-breath) infinite; }
  .conn-disconnected { background: var(--color-error); }
  /* Presence: collaborators as living avatars — a ring in their colour,
     a breathing live dot, and a pop when they arrive. */
  .peers { display: flex; margin-left: var(--sp-1); padding-left: 4px; }
  .peer-chip {
    position: relative;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    font-size: 10px;
    font-weight: 700;
    color: var(--color-background);
    background:
      radial-gradient(circle at 30% 25%, color-mix(in oklch, white 35%, transparent), transparent 60%),
      var(--peer-color, var(--color-secondary));
    box-shadow: 0 0 0 2px var(--surface-0), 0 0 0 3.5px color-mix(in oklch, var(--peer-color) 45%, transparent), 0 2px 8px -2px color-mix(in oklch, var(--peer-color) 70%, transparent);
    margin-left: -5px;
    animation: peer-in var(--spring-bouncy-ms) var(--spring-bouncy) both;
    transition: transform var(--spring-snappy-ms) var(--spring-snappy);
  }
  .peer-chip:hover { transform: translateY(-2px) scale(1.08); z-index: 1; }
  .peer-live {
    position: absolute;
    right: -1px;
    bottom: -1px;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--ok);
    box-shadow: 0 0 0 2px var(--surface-0);
  }
  .peer-live::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: 50%;
    background: var(--ok);
    animation: presence-breathe var(--dur-breath) var(--ease-breath) infinite;
  }
  @keyframes peer-in { from { opacity: 0; transform: scale(0.4); } }
  @media (max-width: 720px) {
    .note-bar { padding: 0 var(--sp-2) 0 var(--sp-3); gap: var(--sp-2); }
    .nb-crumbs, .nb-divider, .nb-settings { display: none; }
    .nb-seg button { padding: 0 8px; }
  }

  /* ── status bar ────────────────────────────────────────── */
  .statusbar {
    flex: none;
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    height: var(--bar-h);
    padding: 0 0 0 var(--sp-3);
    border-top: 1px solid var(--hairline-soft);
    background: color-mix(in oklch, var(--surface-1) 50%, var(--surface-0));
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    color: var(--ink-3);
    white-space: nowrap;
    overflow: hidden;
    font-variant-numeric: tabular-nums;
  }
  .sb-pending { color: var(--color-warning); font-weight: 600; }
  .sync::before {
    content: '';
    display: inline-block;
    width: 6px;
    height: 6px;
    margin-right: 6px;
    border-radius: 50%;
    background: var(--color-accent);
    box-shadow: 0 0 6px color-mix(in oklch, var(--color-accent) 60%, transparent);
    vertical-align: 1px;
    transition: background var(--dur-fade) var(--ease);
  }
  .sync.pending::before { background: var(--color-warning); animation: sync-breathe 1.6s var(--ease-breath) infinite; }
  .sync.offline::before { background: var(--ink-4); box-shadow: none; }
  .sb-path { color: var(--ink-2); overflow: hidden; text-overflow: ellipsis; min-width: 0; max-width: 40%; }
  .sb-spacer { flex: 1; }
  .sb-help {
    align-self: stretch;
    width: 28px;
    border: none;
    border-left: 1px solid var(--hairline-soft);
    background: transparent;
    color: var(--ink-3);
    font-family: var(--font-mono);
    cursor: pointer;
    transition: background var(--dur-tap) var(--ease), color var(--dur-fade) var(--ease);
  }
  .sb-help:hover { color: var(--color-text); background: var(--tint-hover); }
</style>
