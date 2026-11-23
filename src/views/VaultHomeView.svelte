<script lang="ts">
  import { onMount, onDestroy, untrack, tick } from 'svelte';
  import { vaults } from '../lib/vaults.svelte.ts';
  import { notes } from '../lib/notes.svelte.ts';
  import { renderBlocks, taskToggle, startsWithTitle } from '../lib/markdown.ts';
  import { keyLabel } from '../lib/platform.ts';
  import { ApiError } from '../lib/types.ts';
  import * as api from '../lib/api.ts';
  import { offline, bundleMarkdown, downloadText, exportFilename } from '../lib/offline.svelte.ts';
  import { planSession, startSession, loadEditorSession, flushPending, toggleTaskHeadless } from '../lib/editor-boot.ts';
  import type { ConflictCopy } from '../lib/offline-store.ts';
  import { uiState } from '../lib/uistate.svelte.ts';
  import { books } from '../lib/books.svelte.ts';
  import { sync } from '../lib/sync.svelte.ts';
  import { serverLabel } from '../lib/serverurl.ts';
  import { isEditableTarget } from '../lib/shortcuts.ts';
  import { ShellKeymap, CHORD_TIMEOUT_MS, type ShellAction } from '../lib/shell-keymap.ts';
  import { MillerNav } from '../lib/miller.svelte.ts';
  import { breadcrumb, parentDir, dirOf, normalizePath, type Entry } from '../lib/notetree.ts';
  import { planCreate, planRename, planFolderRename, movedPath, copyTitle, type CreatePlan, type RenamePlan, type FolderRenamePlan } from '../lib/fileops.ts';
  import { findNoteByHref, markdownLink } from '../lib/links.ts';
  import { legendFor, contextForVimMode, type LegendContext, type LegendItem } from '../lib/legend.ts';
  import { PaneKeys, paneLayout, paneTarget, fallsThroughWithoutTarget, PANE_CHORD_MS, type PaneId, type PaneDir } from '../lib/pane-nav.ts';
  import { PreviewKeymap, type PreviewAction } from '../lib/preview-keys.ts';
  import { menuFor, type MenuItem } from '../lib/context-actions.ts';
  import { withViewTransition, animate } from '../lib/motion.ts';
  import { effectiveSettings, appliedMappings, LEADER_TOKEN } from '../lib/vim-config.ts';
  import { selectorOrder } from '../lib/books-model.ts';
  import type { PaletteCommand } from '../lib/palette.ts';
  import MillerColumn from '../components/MillerColumn.svelte';
  import VaultSettingsModal from '../components/VaultSettingsModal.svelte';
  import VaultCreateModal from '../components/VaultCreateModal.svelte';
  import BookSwitcher from '../components/BookSwitcher.svelte';
  import SyncStatusPopover from '../components/SyncStatusPopover.svelte';
  import CommandLegend from '../components/CommandLegend.svelte';
  import CommandPalette from '../components/CommandPalette.svelte';
  import HelpOverlay from '../components/HelpOverlay.svelte';
  import MarkdownView from '../components/MarkdownView.svelte';
  import SourceSplit from '../components/SourceSplit.svelte';
  import ContextMenu from '../components/ContextMenu.svelte';
  import HintOverlay from '../components/HintOverlay.svelte';
  import { editorSettings } from '../lib/editor-settings.svelte.ts';
  import { countWords, readingTime, type EditorStats } from '../lib/textstats.ts';

  let showSettings = $state(false);
  // Editor + Yjs runtime is lazy-loaded on first edit; types stay
  // static so the rest of the view keeps its existing typing.
  import type { EditorSession as EditorSessionT } from '../lib/editor-session.svelte.ts';

  type NoteEditorComp = typeof import('../components/NoteEditor.svelte').default;

  // Yazi/miller browser: parent | current | preview columns derived
  // from note paths. Keymap: lib/shell-keymap.ts (Apple parity).
  const nav = new MillerNav(() => notes.list);
  /** 'browse' = walking columns; 'note' = the open note owns the main
   *  pane (Enter/l on a note), parent column hidden. */
  let pane = $state<'browse' | 'note'>('browse');
  let showPreview = $state(true); // zp
  let filterOpen = $state(false);
  let filterFocused = $state(false);
  let filterInput = $state<HTMLInputElement | null>(null);
  let currentColEl = $state<HTMLElement | null>(null);
  let currentCol = $state<{ pageRows(): number } | null>(null);
  let previewEl = $state<HTMLElement | null>(null);
  const crumbs = $derived(breadcrumb(nav.dir));
  const openKey = $derived(notes.selectedID ? 'n:' + notes.selectedID : null);
  const liveMsg = $derived(
    `${nav.dir === '' ? (vaults.selected?.name ?? 'Book') + ' root' : nav.dir}, ${nav.entries.length} items` +
      (nav.filter ? `, filtered by “${nav.filter}”` : ''),
  );

  // ---- keymap + legend state ----------------------------------------------
  const keymap = new ShellKeymap();
  let shellPending = $state<string | null>(null);
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;
  let vimState = $state<{ mode: string; pending: string | null; sub?: string | null }>({ mode: 'normal', pending: null });
  let paletteMode = $state<null | 'all' | 'command'>(null);
  let hintsOpen = $state(false);
  let menu = $state<{ x: number; y: number; items: MenuItem[]; entry: Entry | null; title: string } | null>(null);
  let homeEl = $state<HTMLElement | null>(null);
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

  // ---- explorer prompt (a / r), inline delete confirm, yank -----------------
  type Prompt = { kind: 'create'; text: string } | { kind: 'rename'; text: string; entry: Entry };
  let prompt = $state<Prompt | null>(null);
  let promptInput = $state<HTMLInputElement | null>(null);
  let promptErr = $state<string | null>(null);
  let busy = $state(false);
  let pendingDelete = $state<Entry | null>(null);
  let yanked = $state<Entry | null>(null);
  let toast = $state<{ text: string; tone: 'info' | 'warn' | 'error' } | null>(null);
  let toastTimer: ReturnType<typeof setTimeout> | null = null;

  function flash(text: string, tone: 'info' | 'warn' | 'error' = 'info'): void {
    toast = { text, tone };
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast = null), tone === 'error' ? 6000 : 3500);
  }

  const promptPlan: CreatePlan | RenamePlan | FolderRenamePlan | null = $derived.by(() => {
    const p = prompt;
    if (!p || !p.text.trim()) return null;
    if (p.kind === 'create') return planCreate(nav.dir, p.text);
    if (p.entry.kind === 'folder') return planFolderRename(p.entry.path, p.text);
    return planRename(p.entry.path, p.entry.note.title ?? p.entry.name, p.text);
  });
  const promptPreview = $derived.by(() => {
    const pl = promptPlan;
    if (!pl) return prompt?.kind === 'create' ? 'name · a/b/name · dir/' : 'new name · dir/name · dir/';
    switch (pl.kind) {
      case 'error': return pl.message;
      case 'none': return 'unchanged';
      case 'folder':
        return 'path' in pl ? `folder ${pl.path}/` : `move folder → ${pl.to}/`;
      case 'note':
        if ('folder' in pl) return `note “${pl.title}” in ${pl.folder ? pl.folder + '/' : 'book root'}`;
        return [pl.title ? `title “${pl.title}”` : '', pl.path ? `→ ${pl.path}` : ''].filter(Boolean).join(' · ');
    }
    return '';
  });

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

  function showOfflineHint(): void {
    offlineHint = OFFLINE_HINT;
    if (hintTimer) clearTimeout(hintTimer);
    hintTimer = setTimeout(() => (offlineHint = null), 4000);
  }

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

  let creating = false;

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

  // Hydrate notes whenever the active vault changes. The notes store
  // is idempotent on a no-op vaultID transition so this is safe. The
  // full list fetched here is the book's catch-up baseline (cursor =
  // the head known now; later heads trigger GET /changes).
  $effect(() => {
    const vid = vaults.selectedID;
    untrack(() => {
      if (notes.vaultID !== vid) {
        nav.reset();
        pane = 'browse';
        filterOpen = false;
        prompt = null;
        pendingDelete = null;
        yanked = null;
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

  // The preview follows the cursor (yazi): a note under the cursor is
  // loaded into the preview column, a folder clears the selection.
  // Rapid j/k is debounced so holding a key does not fire one content
  // request per row; clicks and jumps select immediately.
  const PREVIEW_DEBOUNCE_MS = 120;
  let debounceNext = false;
  let selTimer: ReturnType<typeof setTimeout> | null = null;
  // A primitive, so the effect below re-runs when the cursor moves to
  // another row — not when the tree is merely re-derived (refresh,
  // feed changes) with the cursor still on the same row.
  const cursorNoteID = $derived(nav.current?.kind === 'note' ? nav.current.note.id : null);
  const cursorKey = $derived(nav.current?.key ?? null);
  $effect(() => {
    void cursorKey;
    const id = cursorNoteID;
    untrack(() => {
      if (selTimer) clearTimeout(selTimer);
      selTimer = null;
      if (id === notes.selectedID) return;
      // Never yank the note out from under an active editor or a note
      // being created.
      if (editSession || creating) return;
      if (debounceNext) {
        selTimer = setTimeout(() => {
          selTimer = null;
          if (!editSession) void notes.select(id);
        }, PREVIEW_DEBOUNCE_MS);
      } else {
        void notes.select(id);
      }
      debounceNext = false;
    });
  });

  // A note selected from elsewhere (created, opened via a link) is
  // revealed in its folder.
  $effect(() => {
    const id = notes.selectedID;
    void notes.list; // re-run once a just-created note reaches the list
    untrack(() => {
      // A pending debounced preview means the user is moving away; a
      // note being created is revealed once it reached its folder.
      if (id && !selTimer && !creating) nav.reveal(id);
    });
  });

  // Leaving a note that no longer exists returns to browsing.
  $effect(() => {
    if (pane === 'note' && !notes.selectedID) untrack(() => (pane = 'browse'));
  });

  onMount(() => {
    window.addEventListener('keydown', handleKey);
    window.addEventListener('focusin', onFocusIn);
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
      window.removeEventListener('keydown', handleKey);
      window.removeEventListener('focusin', onFocusIn);
      mq?.removeEventListener?.('change', onmq);
    };
  });

  /** Which pane holds keyboard focus (click focuses panes too). */
  function onFocusIn(e: FocusEvent): void {
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
      narrow: narrowView,
      splitNarrow,
      pane,
      editing: editMode && !!editSession,
      split: editMode && editorSettings.value.editMode === 'source' && editorSettings.value.previewSplit && !!editSession?.editable,
      mainHasNote: !!notes.selectedID && !!notes.content && !(pane === 'browse' && (nav.current?.kind === 'folder' || !showPreview)),
    }),
  );
  /** The focused pane when it is on screen; else the pane the current
   *  mode implies. */
  const activePane: PaneId = $derived.by(() => {
    const all = [...layout.order, ...(layout.stack ?? [])];
    if (focusedPane && all.includes(focusedPane)) return focusedPane;
    if (editMode && editSession) return 'editor';
    return pane === 'note' ? 'main' : 'explorer';
  });
  const multiPane = $derived(layout.order.length + (layout.stack ? 1 : 0) > 1);

  /** Move focus `dir`; false when no pane lies that way. */
  function navigatePane(dir: PaneDir): boolean {
    const from = activePane;
    const to = paneTarget(layout, from, dir, prevPane);
    if (!to || to === from) return false;
    void focusPaneEl(to, from);
    return true;
  }

  async function focusPaneEl(to: PaneId, from: PaneId | null = activePane): Promise<void> {
    switch (to) {
      case 'explorer':
        await focusColumn(true);
        return;
      case 'main':
        previewEl?.focus({ preventScroll: true });
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
    if (selTimer) clearTimeout(selTimer);
    if (hintTimer) clearTimeout(hintTimer);
    if (toastTimer) clearTimeout(toastTimer);
    if (pendingTimer) clearTimeout(pendingTimer);
    void offline.watchConflicts(null);
    // Tear the editor session down (socket + Y.Doc) — e.g. on logout
    // App.svelte unmounts this view while an editor is open.
    if (editSession) {
      editSession.destroy();
      sync.setEditor(editSession.vaultID, null);
      editSession = null;
    }
    // Drop the per-vault cache so the next vault load starts clean.
    void notes.openVault(null);
  });

  function back(): void {
    books.openPicker();
  }

  function overlayOpen(): boolean {
    return !!(uiState.accountModal || uiState.createBookOpen || showSettings || uiState.settings || uiState.helpOpen || uiState.themePickerOpen || paletteMode || hintsOpen || menu);
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

    if (overlayOpen()) return;

    // A component (CodeMirror/vim, a form control) already handled it.
    if (e.defaultPrevented) return;
    // A task checkbox (focused by a click or a hint) is not text entry:
    // the reader keys keep working around it.
    const taskBox = (e.target as HTMLElement | null)?.matches?.('input[type="checkbox"][data-task]') ?? false;
    if (isEditableTarget(e.target) && !taskBox) return;

    // Inline delete confirmation owns y/n/Enter/Esc.
    if (pendingDelete) {
      e.preventDefault();
      if (e.key === 'y' || e.key === 'Y' || e.key === 'Enter') void confirmDelete();
      else if (e.key === 'n' || e.key === 'N' || e.key === 'Escape' || e.key === 'q') pendingDelete = null;
      return;
    }

    // Pane navigation: Ctrl-h/j/k/l, Ctrl-w h/j/k/l/w/p. (The editor
    // routes its own, vim-mode aware, see NoteEditor.)
    const pk = paneKeys.feed(e, { ctrlHjkl: editorSettings.value.paneNav });
    panePending = paneKeys.pending;
    if (pk) {
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
    // Mod-Enter, Mod-E, vim :q) — never a stray Esc. The explorer
    // column keeps its keys while the editor is open.
    if (editMode && activePane !== 'explorer') return;

    const action = keymap.feed(e, shellContext());
    syncPending();
    if (!action) return;
    e.preventDefault();
    if (action.kind === 'pending') return;
    runAction(action);
  }

  /** Explorer keys or reader keys, by the focused pane. */
  function shellContext(): 'explorer' | 'reader' {
    if (activePane === 'explorer') return 'explorer';
    if (activePane === 'main') return 'reader';
    return pane === 'note' ? 'reader' : 'explorer';
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

  /** Note id the next action applies to: the open note in the reader,
   *  else the note under the browser cursor. */
  function noteUnderFocus(): string | null {
    if (pane === 'note' && activePane !== 'explorer') return notes.selectedID;
    if (activePane === 'main' && notes.selectedID) return notes.selectedID;
    const cur = nav.current;
    return cur?.kind === 'note' ? cur.note.id : null;
  }

  function runAction(a: ShellAction): void {
    const reader = shellContext() === 'reader';
    const page = currentCol?.pageRows() ?? 10;
    switch (a.kind) {
      case 'move':
        if (reader) scrollNote(60 * a.n);
        else { debounceNext = Math.abs(a.n) === 1; nav.move(a.n); }
        return;
      case 'halfPage':
        if (reader) scrollNote(a.dir > 0 ? 'half' : '-half');
        else { debounceNext = true; nav.move(a.dir * Math.ceil(page / 2)); }
        return;
      case 'page':
        if (reader) scrollNote(a.dir > 0 ? 'page' : '-page');
        else { debounceNext = true; nav.move(a.dir * page); }
        return;
      case 'top':
        if (reader) scrollNote('top');
        else nav.top();
        return;
      case 'bottom':
        if (reader) scrollNote('bottom');
        else nav.bottom();
        return;
      case 'parent':
        if (reader) leaveNote();
        else { nav.left(); void focusColumn(); }
        return;
      case 'open':
        if (!reader) activate();
        return;
      case 'historyBack':
        if (reader) leaveNote();
        nav.historyBack();
        void focusColumn();
        return;
      case 'historyForward':
        if (reader) leaveNote();
        nav.historyForward();
        void focusColumn();
        return;
      case 'home':
        goHome();
        return;
      case 'filter':
        void openFilter();
        return;
      case 'nextMatch':
      case 'prevMatch':
        debounceNext = true;
        if (!nav.findNext(a.kind === 'nextMatch' ? 1 : -1)) flash('no filter yet — / to filter');
        return;
      case 'clearOrBack':
        if (reader) leaveNote();
        else if (nav.filter) { nav.setFilter(''); filterOpen = false; }
        // Explorer beside an open note / editor: back to the note.
        else if (pane === 'note') void focusPaneEl(editMode && editSession ? 'editor' : 'main');
        else back();
        return;
      case 'close':
        leaveNote();
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
        if (reader) void copyNoteText();
        else yank();
        return;
      case 'paste':
        void paste();
        return;
      case 'toggleHidden':
        nav.toggleHidden();
        flash(nav.showHidden ? 'showing hidden files' : 'hiding dot-files');
        return;
      case 'togglePreview':
        showPreview = !showPreview;
        return;
      case 'refresh':
        void notes.refresh();
        flash('refreshing…');
        return;
      case 'edit': {
        const target = noteUnderFocus();
        if (target && editMode && editSession?.noteID === target) void focusPaneEl('editor');
        else if (target) void editNote(target);
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
        books.openPicker();
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
    }
  }

  function cycleBook(dir: 1 | -1): void {
    const order = selectorOrder(books.list);
    if (order.length < 2) return;
    const i = Math.max(0, order.findIndex((b) => b.id === books.activeID));
    books.setActive(order[(i + dir + order.length) % order.length].id);
  }

  // ---- browser actions ---------------------------------------------------

  /** l / Enter / → : descend into a folder, or open the note. */
  function activate(): void {
    const note = nav.right();
    if (note) void openNote(note.note.id);
    else focusColumn();
  }

  async function openNote(id: string): Promise<void> {
    // Per-device preference: open straight into the editor.
    if (editorSettings.value.openIn === 'editing') return editNote(id);
    if (notes.selectedID !== id) void notes.select(id);
    await withViewTransition(async () => {
      pane = 'note';
      await tick();
    });
    previewEl?.focus();
  }

  function leaveNote(): void {
    if (pane === 'browse') return void focusColumn();
    void withViewTransition(async () => {
      pane = 'browse';
      await tick();
    });
    void focusColumn();
  }

  function goHome(): void {
    pane = 'browse';
    nav.home();
    void focusColumn();
  }

  async function focusColumn(force = false): Promise<void> {
    await tick();
    // Do not steal focus from a dialog or form control.
    const a = document.activeElement as HTMLElement | null;
    if (!force && a && a !== document.body && isEditableTarget(a)) return;
    currentColEl?.focus({ preventScroll: true });
  }

  async function openFilter(): Promise<void> {
    filterOpen = true;
    await tick();
    filterInput?.focus();
    filterInput?.select();
  }

  function onFilterKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      nav.setFilter('');
      filterOpen = false;
      void focusColumn(true);
    } else if (e.key === 'Enter') {
      // Keep the filter, hand the keys back to the column.
      e.preventDefault();
      filterOpen = nav.filter !== '';
      void focusColumn(true);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      nav.move(e.key === 'ArrowDown' ? 1 : -1);
    }
  }

  function scrollNote(by: number | 'top' | 'bottom' | 'half' | '-half' | 'page' | '-page'): void {
    const el = previewEl;
    if (!el) return;
    const h = el.clientHeight;
    const smooth = (top: number) => {
      if (typeof el.scrollTo === 'function') el.scrollTo({ top, behavior: reducedMotion() ? 'auto' : 'smooth' });
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

  function reducedMotion(): boolean {
    try {
      return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    } catch {
      return false;
    }
  }

  async function editNote(id: string): Promise<void> {
    if (notes.selectedID !== id) await notes.select(id);
    if (notes.selectedID !== id) return;
    pane = 'note';
    await enterEdit();
  }

  // Pointer: current column — folder enters, note previews; double
  // click opens. Parent column — jump there. Preview column (folder
  // children) — enter the folder with that child selected.
  function pickCurrent(i: number, e: Entry): void {
    nav.setCursor(i);
    if (e.kind === 'folder') nav.right();
    void focusColumn();
  }

  function openCurrent(i: number, e: Entry): void {
    nav.setCursor(i);
    if (e.kind === 'note') void openNote(e.note.id);
  }

  function pickParent(_i: number, e: Entry): void {
    pane = 'browse';
    if (e.kind === 'folder') nav.goTo(e.path);
    else nav.goTo(parentDir(nav.dir) ?? '', e.key);
    void focusColumn();
  }

  function pickPreview(_i: number, e: Entry): void {
    const cur = nav.current;
    if (cur?.kind !== 'folder') return;
    nav.goTo(cur.path, e.key);
    void focusColumn();
  }

  function pickCrumb(path: string): void {
    pane = 'browse';
    nav.goTo(path);
    void focusColumn();
  }

  // ---- file operations (a / r / d / y / p) -------------------------------

  function errText(e: unknown): string {
    return e instanceof ApiError ? (e.detail ?? e.code) : (e as Error).message;
  }

  async function openPrompt(p: Prompt, caretAtStart = false): Promise<void> {
    prompt = p;
    promptErr = null;
    await tick();
    promptInput?.focus();
    if (caretAtStart) promptInput?.setSelectionRange(0, 0);
    else promptInput?.select();
  }

  function beginCreate(): void {
    if (structuralOffline) return showOfflineHint();
    if (pane === 'note') leaveNote();
    void openPrompt({ kind: 'create', text: '' });
  }

  function beginRename(): void {
    const cur = pane === 'note' ? nav.entries.find((x) => x.kind === 'note' && x.note.id === notes.selectedID) : nav.current;
    if (!cur) return;
    if (structuralOffline && !(cur.kind === 'folder' && cur.virtual)) return showOfflineHint();
    void openPrompt({ kind: 'rename', entry: cur, text: cur.kind === 'folder' ? cur.name : (cur.note.title ?? cur.name) });
  }

  function beginDelete(): void {
    const cur = pane === 'note' ? nav.entries.find((x) => x.kind === 'note' && x.note.id === notes.selectedID) : nav.current;
    if (!cur) return;
    if (cur.kind === 'folder') {
      if (cur.virtual) {
        nav.removeFolder(cur.path);
        flash(`removed empty folder ${cur.name}/`);
      } else {
        flash('delete the notes inside to remove a folder', 'warn');
      }
      return;
    }
    if (structuralOffline) return showOfflineHint();
    pendingDelete = cur;
  }

  function cancelPrompt(): void {
    prompt = null;
    promptErr = null;
    void focusColumn(true);
  }

  function onPromptKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      cancelPrompt();
    }
  }

  async function submitPrompt(): Promise<void> {
    const p = prompt;
    const plan = promptPlan;
    if (!p || !plan || busy) return;
    if (plan.kind === 'error') {
      promptErr = plan.message;
      return;
    }
    if (plan.kind === 'none') return cancelPrompt();
    busy = true;
    promptErr = null;
    try {
      if (plan.kind === 'folder' && 'path' in plan) {
        // `a dir/`: folders exist on the server only through notes, so
        // keep it client-side until a note lands in it.
        nav.addFolder(plan.path);
        nav.goTo(plan.path);
        prompt = null;
        flash(`folder ${plan.path}/ — create a note in it to keep it (a)`);
      } else if (plan.kind === 'folder') {
        await moveFolder(plan.from, plan.to);
        prompt = null;
      } else if (plan.kind === 'note' && 'folder' in plan) {
        await createNote(plan.title, plan.folder);
        prompt = null;
      } else if (plan.kind === 'note' && p.kind === 'rename' && p.entry.kind === 'note') {
        const input: { title?: string; path?: string } = {};
        if (plan.title) input.title = plan.title;
        if (plan.path) input.path = plan.path;
        const updated = await notes.patch(p.entry.note.id, input);
        prompt = null;
        if (updated && plan.path) {
          nav.reveal(updated.id);
          flash(`moved to ${updated.path}`);
        }
      }
      void focusColumn(true);
    } catch (e) {
      promptErr = errText(e);
    } finally {
      busy = false;
    }
  }

  /** POST (always at the book root), then PATCH the path into `folder`. */
  async function createNote(title: string, folder: string, body = ''): Promise<void> {
    creating = true;
    try {
      const created = await notes.create({ title, body });
      if (!created) return;
      let final = created;
      if (folder) {
        const file = normalizePath(created.path || created.id + '.md').split('/').pop()!;
        final = (await notes.patch(created.id, { path: `${folder}/${file}` })) ?? created;
        nav.removeFolder(folder); // real now
      }
      nav.reveal(final.id);
    } finally {
      creating = false;
    }
  }

  async function moveFolder(from: string, to: string): Promise<void> {
    if (nav.extraDirs.has(from) && !notes.list.some((n) => movedPath(n.path, from, to))) {
      nav.removeFolder(from);
      nav.addFolder(to);
      nav.goTo(dirOf(to), 'd:' + to);
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
    nav.goTo(dirOf(to), 'd:' + to);
    flash(`moved ${moves.length} ${moves.length === 1 ? 'note' : 'notes'} to ${to}/`);
  }

  async function confirmDelete(): Promise<void> {
    const entry = pendingDelete;
    pendingDelete = null;
    if (!entry || entry.kind !== 'note') return;
    try {
      if (notes.selectedID !== entry.note.id) await notes.select(entry.note.id);
      await notes.deleteSelected();
      flash(`deleted ${entry.name}`);
      if (pane === 'note') leaveNote();
    } catch (e) {
      flash(errText(e), 'error');
    }
  }

  function yank(): void {
    const cur = nav.current;
    if (cur?.kind !== 'note') return flash('y works on notes', 'warn');
    yanked = cur;
    flash(`yanked ${cur.name} — p to paste a copy`);
  }

  async function paste(): Promise<void> {
    const y = yanked;
    if (!y || y.kind !== 'note') return flash('nothing yanked — y on a note first');
    if (structuralOffline) return showOfflineHint();
    const vid = vaults.selectedID;
    if (!vid) return;
    try {
      const src = await api.getNoteContent(vid, y.note.id);
      const taken = new Set(notes.list.map((n) => n.title));
      await createNote(copyTitle(y.note.title ?? y.name, taken), nav.dir, src.body ?? '');
      flash(`pasted a copy of ${y.name}`);
    } catch (e) {
      flash(errText(e), 'error');
    }
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

  // ---- links -----------------------------------------------------------------

  /** Open a relative note link from the open note (reader click or
   *  Live Preview Mod-click). */
  function openLinkedNote(href: string): void {
    const from = notes.selected?.path ?? notes.content?.path ?? '';
    const target = findNoteByHref(notes.list, from, href);
    if (!target) return flash(`no note at ${href}`, 'warn');
    if (editMode) exitEdit();
    void notes.select(target.id).then(() => {
      nav.reveal(target.id);
      pane = 'note';
    });
  }

  /** Link clicks inside rendered markdown (in-note `#` anchors are
   *  handled by MarkdownView). */
  function onMdLink(href: string, e: MouseEvent): void {
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//')) {
      // External: never navigate the app away.
      e.preventDefault();
      if (/^(https?|mailto):/i.test(href)) window.open(href, '_blank', 'noopener,noreferrer');
      return;
    }
    if (href.startsWith('#')) return;
    e.preventDefault();
    openLinkedNote(href);
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

  // ---- context menu, hints, drag & drop ------------------------------------------

  function entryForOpenNote(): Entry | null {
    return nav.entries.find((x) => x.kind === 'note' && x.note.id === notes.selectedID) ?? null;
  }

  function openMenu(x: number, y: number, entry: Entry | null, reader = false): void {
    const items = menuFor(entry, { offline: structuralOffline, canPaste: !!yanked, reader });
    const title = entry ? (entry.kind === 'note' ? (entry.note.title ?? entry.name) : entry.name + '/') : (nav.dir || (vaults.selected?.name ?? 'book'));
    menu = { x, y, items, entry, title };
  }

  function onRowContext(i: number, e: Entry, ev: MouseEvent): void {
    pane = 'browse';
    nav.setCursor(i);
    openMenu(ev.clientX, ev.clientY, e);
  }

  function onReaderContext(ev: MouseEvent): void {
    const t = ev.target as HTMLElement | null;
    // Keep the browser menu on links, images, selections and fields.
    if (pane !== 'note' || editMode || t?.closest('a, img, input, textarea, [contenteditable]') || window.getSelection?.()?.toString()) return;
    const entry = entryForOpenNote();
    if (!entry) return;
    ev.preventDefault();
    openMenu(ev.clientX, ev.clientY, entry, true);
  }

  function onColumnContext(ev: MouseEvent): void {
    // Empty space in the current column (rows handle their own).
    if ((ev.target as HTMLElement | null)?.closest('[role="option"]')) return;
    ev.preventDefault();
    openMenu(ev.clientX, ev.clientY, null);
  }

  function openMenuAtCursor(): void {
    if (pane === 'note') {
      const entry = entryForOpenNote();
      const r = previewEl?.getBoundingClientRect();
      if (entry) openMenu((r?.left ?? 0) + 48, (r?.top ?? 0) + 48, entry, true);
      return;
    }
    const row = currentColEl?.querySelector<HTMLElement>('.row.cursor');
    const r = row?.getBoundingClientRect() ?? currentColEl?.getBoundingClientRect();
    openMenu((r?.left ?? 0) + 24, (r?.bottom ?? 0) + 2, nav.current ?? null);
  }

  function runMenu(it: MenuItem): void {
    const reader = pane === 'note';
    switch (it.action) {
      case 'copyLink': {
        const e = menu?.entry ?? (reader ? entryForOpenNote() : nav.current);
        if (e?.kind !== 'note') return;
        const from = reader ? (notes.selected?.path ?? '') : '';
        const link = markdownLink(e.note.title ?? e.name, from, e.note.path || e.note.id + '.md');
        void navigator.clipboard?.writeText(link).then(() => flash('copied ' + link), () => flash('clipboard unavailable', 'warn'));
        return;
      }
      case 'newFolder':
        if (structuralOffline) return showOfflineHint();
        void openPrompt({ kind: 'create', text: '/' }, true);
        return;
      default:
        runAction({ kind: it.action } as ShellAction);
    }
  }

  /** Drag a note onto a folder row: move it there (PATCH path). */
  async function dropNote(noteKey: string, target: Entry): Promise<void> {
    if (target.kind !== 'folder') return;
    if (structuralOffline) return showOfflineHint();
    const note = notes.list.find((n) => 'n:' + n.id === noteKey);
    if (!note) return;
    const file = normalizePath(note.path || note.id + '.md').split('/').pop()!;
    const path = `${target.path}/${file}`;
    if (normalizePath(note.path) === path) return;
    try {
      const updated = await notes.patch(note.id, { path });
      if (updated) {
        nav.removeFolder(target.path);
        flash(`moved ${file} → ${target.path}/`);
      }
    } catch (e) {
      flash(errText(e), 'error');
    }
  }

  // Miller columns slide a little in the direction of travel.
  let lastDir = untrack(() => nav.dir);
  $effect(() => {
    const d = nav.dir;
    untrack(() => {
      if (d === lastDir) return;
      const deeper = d.length > lastDir.length && d.startsWith(lastDir);
      lastDir = d;
      animate(currentColEl, [{ transform: `translateX(${deeper ? 14 : -14}px)`, opacity: 0.55 }, { transform: 'none', opacity: 1 }], 170);
    });
  });

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
      case 'readPreview': void focusPaneEl('split'); return;
      case 'menu': openMenuAtCursor(); return;
      case 'reading': exitEditAnimated(); return;
      case 'toggleMode': editorSettings.toggleEditMode(); return;
      case 'settings': uiState.openSettings('editor'); return;
      case 'confirm': void confirmDelete(); return;
      case 'submit':
        if (prompt) void submitPrompt();
        else if (filterOpen) { filterOpen = nav.filter !== ''; void focusColumn(true); }
        return;
      case 'cancel':
        if (pendingDelete) pendingDelete = null;
        else if (prompt) cancelPrompt();
        else if (filterOpen) { nav.setFilter(''); filterOpen = false; void focusColumn(true); }
        return;
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
      // + yjs + y-websocket chunks, in parallel.
      const [editorMod, Ctor] = await Promise.all([
        NoteEditor ? Promise.resolve(null) : import('../components/NoteEditor.svelte'),
        loadEditorSession(),
      ]);
      if (editorMod) NoteEditor = editorMod.default;
      // The editor uses the ACTIVE BOOK's account: its server, token and
      // identity — never another account's. It also loads this note's
      // offline replica, when one exists for that account.
      const plan = await planSession(vaultID, noteID);
      // The user may have moved on while the chunks loaded.
      if (notes.selectedID !== noteID || vaults.selectedID !== vaultID || editSession) return;
      if (typeof plan === 'string') {
        editError = plan;
        return;
      }

      // Join rule (CRDT client protocol §2): start from an EMPTY doc
      // and let the server's SyncStep2 deliver the text. Seeding the
      // Y.Text with the REST body here duplicated the whole note,
      // because the server's doc already holds that text under a
      // different clientID. Until the session is `editable` (first
      // SyncStep2, or a replica of THIS note persisted after an earlier
      // SyncStep2 was restored) the template shows a read-only preview.
      editSession = startSession(Ctor, plan);
      sync.setEditor(vaultID, editSession);
      editMode = true;
      vimState = { mode: 'normal', pending: null };
      pane = 'note'; // the editor gets the wide pane
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
      sess.destroy();
      sync.setEditor(sess.vaultID, null);
      editSession = null;
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
    if (pendingDelete) return 'confirm';
    if (prompt) return 'prompt';
    if (filterFocused) return 'filter';
    if (editMode && editSession && activePane === 'split') return 'preview';
    if (editMode && editSession && activePane !== 'explorer') return eff.vim ? contextForVimMode(vimState.mode) : 'insert';
    return shellContextFor(activePane);
  });
  // The Ctrl-w prefix expires like vim's other pending keys.
  $effect(() => {
    if (!panePending) return;
    const t = setTimeout(() => (panePending = paneKeys.pending), PANE_CHORD_MS + 20);
    return () => clearTimeout(t);
  });
  function shellContextFor(p: PaneId): 'explorer' | 'reader' {
    if (p === 'explorer') return 'explorer';
    if (p === 'main') return 'reader';
    return pane === 'note' ? 'reader' : 'explorer';
  }
  const legendPending = $derived.by(() => {
    if (panePending) return '⌃w';
    if (legendCtx === 'preview') return previewPending;
    if (editMode && legendCtx !== 'explorer' && legendCtx !== 'filter') return vimState.pending === eff.leader ? eff.leader : vimState.pending;
    return shellPending;
  });
  const legendItems = $derived(
    legendFor(legendCtx, legendPending, {
      leader: eff.leader,
      escapeSequences: eff.escapeSequences,
      source: editMode && editorSettings.value.editMode === 'source',
      split: editMode && splitOn,
      panes: multiPane && editorSettings.value.paneNav,
      leaderMaps: editMode
        ? appliedMappings()
            .filter((m) => m.lhs.startsWith(LEADER_TOKEN))
            .map((m) => ({ keys: m.lhs.slice(LEADER_TOKEN.length), rhs: m.rhs }))
        : [],
    }),
  );
  const legendMode = $derived(
    legendCtx === 'explorer' ? 'files' : legendCtx === 'filter' ? 'filter' : legendCtx === 'prompt' ? (prompt?.kind === 'rename' ? 'rename' : 'new') : legendCtx,
  );

  // ---- palette ------------------------------------------------------------------

  const paletteCommands: PaletteCommand[] = $derived([
    { id: 'new', title: 'New note…', keys: 'a', group: 'create file', run: beginCreate },
    { id: 'new-folder', title: 'New folder…', keys: 'a dir/', group: 'create directory', run: () => { if (structuralOffline) return showOfflineHint(); void openPrompt({ kind: 'create', text: '/' }, true); } },
    { id: 'rename', title: 'Rename / move…', keys: 'r', group: 'file', run: beginRename },
    { id: 'delete', title: 'Delete note', keys: 'd', group: 'file remove', run: beginDelete },
    { id: 'yank', title: 'Yank (copy) note', keys: 'y', group: 'file duplicate', run: yank },
    { id: 'paste', title: 'Paste copy here', keys: 'p', group: 'file duplicate', run: () => void paste() },
    { id: 'edit', title: editMode ? 'Reading view' : 'Edit note', keys: '⌘E', group: 'editor', run: () => { if (editMode) exitEdit(); else { const t = noteUnderFocus(); if (t) void editNote(t); } } },
    { id: 'live', title: editorSettings.value.editMode === 'live' ? 'Switch to Source mode' : 'Switch to Live Preview', keys: '⌘⇧E', group: 'editor', run: () => editorSettings.toggleEditMode() },
    { id: 'split', title: splitOn ? 'Hide preview beside source' : 'Show preview beside source', keys: '\\p ⌘⌥P', group: 'editor split side by side render', run: toggleSplit },
    { id: 'hints', title: 'Hint mode (click by keyboard)', keys: 'F', group: 'navigate vimium labels', run: () => (hintsOpen = true) },
    { id: 'motion', title: editorSettings.value.reduceMotion ? 'Allow motion' : 'Reduce motion', group: 'view animation accessibility', run: () => editorSettings.update({ reduceMotion: !editorSettings.value.reduceMotion }) },
    { id: 'filter', title: 'Filter this folder', keys: '/', group: 'search', run: () => void openFilter() },
    { id: 'preview', title: showPreview ? 'Hide preview column' : 'Show preview column', keys: 'zp', group: 'view', run: () => (showPreview = !showPreview) },
    { id: 'hidden', title: nav.showHidden ? 'Hide dot-files' : 'Show hidden files', keys: '.', group: 'view', run: () => nav.toggleHidden() },
    { id: 'root', title: 'Go to book root', keys: 'gh', group: 'navigate home', run: goHome },
    { id: 'refresh', title: 'Refresh notes', keys: 'R', group: 'sync reload', run: () => void notes.refresh() },
    { id: 'books', title: 'All books', keys: 'gb', group: 'navigate switch', run: () => books.openPicker() },
    { id: 'next-book', title: 'Next book', keys: ']', group: 'navigate switch', run: () => cycleBook(1) },
    { id: 'prev-book', title: 'Previous book', keys: '[', group: 'navigate switch', run: () => cycleBook(-1) },
    { id: 'settings', title: 'Settings', keys: ',', group: 'preferences', run: () => uiState.openSettings('editor') },
    { id: 'vim', title: 'Vim settings & .vimrc', group: 'preferences vimrc keys', run: () => uiState.openSettings('vim') },
    { id: 'appearance', title: 'Theme & appearance', group: 'preferences colour color dark light', run: () => uiState.openSettings('appearance') },
    { id: 'legend', title: editorSettings.value.legend ? 'Hide command legend' : 'Show command legend', group: 'view keys hints', run: () => editorSettings.update({ legend: !editorSettings.value.legend }) },
    { id: 'keys', title: 'Keyboard shortcuts', keys: '?', group: 'help', run: () => (uiState.helpOpen = true) },
    { id: 'book-settings', title: 'Book settings (members, roles)', group: 'vault admin', run: () => (showSettings = true) },
    { id: 'new-book', title: 'New book…', group: 'create vault', run: () => (uiState.createBookOpen = true) },
  ]);

  function openFromPalette(id: string): void {
    pane = 'browse';
    nav.reveal(id);
    void openNote(id);
  }

  function fmtPath(): string {
    if (pane === 'note' && notes.selected) return normalizePath(notes.selected.path);
    return nav.dir ? nav.dir + '/' : '/';
  }
</script>

<div class="vault-home" bind:this={homeEl}>
  <header class="topbar">
    <div class="top-left">
      <button class="home-mark" type="button" onclick={back} title="All books (gb)" aria-label="All books">
        <span class="ui-wordmark"><span class="mark"></span></span>
      </button>
      <div class="switcher-slot"><BookSwitcher /></div>
      <nav class="breadcrumb" aria-label="Folder path" data-testid="breadcrumb">
        {#if pane === 'note'}
          <button class="crumb back" type="button" onclick={leaveNote} aria-label="Back to folder">←</button>
        {/if}
        {#each crumbs as c, i (c.path)}
          {#if i > 0}<span class="sep" aria-hidden="true">/</span>{/if}
          <button
            class="crumb"
            type="button"
            aria-current={i === crumbs.length - 1 && pane === 'browse' ? 'location' : undefined}
            onclick={() => pickCrumb(c.path)}
          >{i === 0 ? (vaults.selected?.name ?? '/') : c.name}</button>
        {/each}
        {#if pane === 'note' && notes.selected}
          <span class="sep" aria-hidden="true">/</span>
          <span class="crumb-note" aria-current="page">{notes.selected.title}</span>
        {/if}
      </nav>
    </div>
    <div class="topbar-right">
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
  <div class="ui-sr-only" aria-live="polite" data-testid="nav-live">{liveMsg}</div>

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
  {:else if notes.loadingList && notes.list.length === 0}
    <div class="placeholder"><span class="spinner" aria-hidden="true"></span>Loading…</div>
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
  {:else if notes.list.length === 0 && nav.extraDirs.size === 0 && !prompt}
    <div class="placeholder empty-book">
      <p class="empty-title">This book is empty</p>
      <p>Press <kbd>a</kbd> to create a note — <span class="mono">ideas</span>, <span class="mono">work/plan</span>, or a folder <span class="mono">journal/</span>.</p>
      <button class="ui-btn sm primary" type="button" onclick={beginCreate} disabled={structuralOffline}>New note</button>
    </div>
  {:else}
  <div
    class="miller"
    class:note-mode={pane === 'note'}
    class:no-preview={!showPreview && pane === 'browse'}
    data-testid="miller"
  >
    <section class="col col-parent" aria-label="Parent folder" data-pane="explorer">
      {#if nav.parent != null}
        <MillerColumn
          entries={nav.parentEntries}
          cursor={nav.parentCursor}
          label="Parent folder {nav.parent === '' ? (vaults.selected?.name ?? 'root') : nav.parent}"
          idPrefix="parent"
          onpick={pickParent}
          ondropnote={(k, t) => void dropNote(k, t)}
        />
      {:else}
        <div class="col-empty">
          <span class="ui-eyebrow">book</span>
          <span class="col-empty-name">{vaults.selected?.name ?? 'Book'}</span>
          <span class="col-empty-meta">{notes.list.length} notes</span>
        </div>
      {/if}
    </section>

    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <section class="col col-current" class:pane-focus={multiPane && activePane === 'explorer'} aria-label="Current folder" data-pane="explorer" oncontextmenu={onColumnContext}>
      {#if filterOpen || nav.filter}
        <div class="filter-row">
          <span class="filter-slash" aria-hidden="true">/</span>
          <input
            class="filter-input"
            type="search"
            placeholder="filter this folder"
            aria-label="Filter current folder"
            value={nav.filter}
            bind:this={filterInput}
            oninput={(e) => nav.setFilter(e.currentTarget.value)}
            onkeydown={onFilterKey}
            onfocus={() => (filterFocused = true)}
            onblur={() => (filterFocused = false)}
          />
          <span class="filter-count">{nav.entries.length}</span>
        </div>
      {/if}
      <MillerColumn
        bind:this={currentCol}
        bind:element={currentColEl}
        entries={nav.entries}
        cursor={nav.cursor}
        label="Folder {nav.dir === '' ? (vaults.selected?.name ?? 'root') : nav.dir}"
        idPrefix="cur"
        active
        {openKey}
        yankedKey={yanked?.key ?? null}
        emptyText={nav.filter ? 'No matches' : 'Empty folder — a to create'}
        onpick={pickCurrent}
        onopen={openCurrent}
        oncontext={onRowContext}
        ondropnote={(k, t) => void dropNote(k, t)}
      />
    </section>

    <!-- Right-click on the open note: the same menu as its row. -->
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <main class="col col-preview preview" class:split-host={editMode && splitOn} class:pane-focus={multiPane && activePane === 'main'} data-pane="main" bind:this={previewEl} tabindex="-1" aria-label="Preview" oncontextmenu={onReaderContext}>
      {#if pane === 'browse' && nav.current?.kind === 'folder' && nav.previewEntries}
        <MillerColumn
          entries={nav.previewEntries}
          cursor={nav.previewCursor}
          label="Contents of {nav.current.path}"
          idPrefix="preview"
          emptyText={nav.current.virtual ? 'New folder — a to create a note in it' : 'Empty folder'}
          onpick={pickPreview}
          ondropnote={(k, t) => void dropNote(k, t)}
        />
      {:else if !notes.selectedID}
        <div class="placeholder hints">
          <div class="hint-grid">
            <span><kbd>j</kbd><kbd>k</kbd> move</span>
            <span><kbd>h</kbd><kbd>l</kbd> folders</span>
            <span><kbd>⏎</kbd> open</span>
            <span><kbd>a</kbd> new</span>
            <span><kbd>/</kbd> filter</span>
            <span><kbd>?</kbd> all keys</span>
          </div>
        </div>
      {:else if notes.loadingContent}
        <div class="placeholder"><span class="spinner" aria-hidden="true"></span>Loading…</div>
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
        {#if editMode && editSession && NoteEditor}
          <div class="editor-frame" class:split={splitOn}>
            <header class="note-bar" data-testid="note-bar">
              <div class="nb-lead">
                <span class="conn-dot conn-{editSession.status}" data-testid="conn-status" title="Live sync: {editSession.status}">{editSession.status}</span>
                {#if noteCrumbs.length > 0}
                  <span class="nb-crumbs" aria-hidden="true">{noteCrumbs.join(' / ')}<span class="nb-sep">/</span></span>
                {/if}
                <button type="button" class="nb-title" onclick={beginRename} title="Rename or move (r)">{notes.selected?.title}</button>
                {#if editSession.peers.length > 0}
                  <span class="peers">
                    {#each editSession.peers as p (p.clientID)}
                      <span class="peer-chip" style="--peer-color: {p.color}" title={p.name}>{p.name.slice(0, 1).toUpperCase()}</span>
                    {/each}
                  </span>
                {/if}
              </div>
              <div class="nb-actions">
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
                />
              </SourceSplit>
            {/if}
          </div>
        {:else if editorLoading}
          <div class="placeholder"><span class="spinner" aria-hidden="true"></span>Loading editor…</div>
        {:else}
          <article class="rendered lumi-prose" data-prose={editorSettings.value.proseFont}>
            <header class="reading-head">
              {#if noteCrumbs.length > 0}
                <nav class="note-crumbs" aria-label="Note location">
                  {#each noteCrumbs as c, i (i)}{#if i > 0}<span class="crumb-sep" aria-hidden="true">/</span>{/if}<span class="crumb-part">{c}</span>{/each}
                </nav>
              {/if}
              <div class="rendered-actions">
                {#if notes.contentStale}<span class="stale" data-testid="content-stale">cópia local (offline)</span>{/if}
                <span class="reading-meta">{readingWords} {readingWords === 1 ? 'word' : 'words'} · {readingMinutes} min</span>
                <button class="ui-btn sm nb-edit" onclick={() => void enterEdit()} disabled={editorLoading} type="button" title="Edit (e · {keyLabel('⌘E')})">{editorLoading ? 'Loading…' : 'Edit'}</button>
                <button class="ui-btn ghost sm icon danger-hover" onclick={beginDelete} type="button" aria-label="Delete note"
                  disabled={structuralOffline} title={structuralOffline ? OFFLINE_HINT : 'Delete (d)'}>
                  <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>
                </button>
              </div>
            </header>
            {#if !titleInBody}<h1 class="rendered-title">{notes.selected?.title}</h1>{/if}
            <!-- DOMPurify-sanitised blocks, see lib/markdown.ts. -->
            <MarkdownView blocks={previewBlocks} onlink={onMdLink} ontoggletask={(i) => void toggleTaskFromReader(i)} />
          </article>
        {/if}
      {/if}
    </main>
  </div>
  {/if}

  {#if prompt}
    <form class="prompt-form" onsubmit={(e) => { e.preventDefault(); void submitPrompt(); }} data-testid="prompt">
      <span class="prompt-label">{prompt.kind === 'create' ? 'new' : 'rename'}</span>
      <span class="prompt-dir mono">{prompt.kind === 'create' ? (nav.dir ? nav.dir + '/' : '/') : ''}</span>
      <input
        class="prompt-input mono"
        bind:this={promptInput}
        bind:value={prompt.text}
        onkeydown={onPromptKey}
        onblur={() => { if (!busy) setTimeout(() => { if (prompt && document.activeElement !== promptInput) cancelPrompt(); }, 120); }}
        aria-label={prompt.kind === 'create' ? 'New note or folder (end with / for a folder)' : 'New name or path'}
        autocomplete="off"
        spellcheck="false"
        disabled={busy}
      />
      <span class="prompt-preview" class:err={promptPlan?.kind === 'error' || !!promptErr}>{promptErr ?? promptPreview}</span>
    </form>
  {/if}

  {#if pendingDelete}
    <div class="confirm-bar" role="alertdialog" aria-label="Confirm delete" data-testid="delete-confirm">
      <span>Delete <strong>{pendingDelete.name}</strong>? The markdown file is removed from the book.</span>
      <span class="confirm-actions">
        <button class="ui-btn sm ghost" type="button" onclick={() => (pendingDelete = null)}>Cancel <kbd>n</kbd></button>
        <button class="ui-btn sm danger solid" type="button" onclick={() => void confirmDelete()}>Delete <kbd>y</kbd></button>
      </span>
    </div>
  {/if}

  {#if editorSettings.value.legend}
    <CommandLegend items={legendItems} pending={legendPending} mode={editMode && editSession && eff.vim ? null : legendMode} onaction={onLegendAction} onmore={() => (uiState.helpOpen = true)} />
  {/if}

  <footer class="statusbar" data-testid="editor-status">
    {#if editMode && editSession && eff.vim}
      <span class="sb-mode" data-mode={vimState.mode} data-testid="vim-mode">{vimModeLabel(vimState.mode, vimState.sub)}</span>
      {#if vimState.pending && !editorSettings.value.legend}<span class="sb-pending">{vimState.pending}</span>{/if}
    {/if}
    <span class="sb-path mono" title={fmtPath()}>{fmtPath()}</span>
    {#if !editMode}
      <span class="sb-item" aria-live="off">
        {notes.list.length} notes{notes.loadingMore ? '…' : ''}{nav.filter ? ` · ${nav.entries.length} match` : ''}
      </span>
      {#if notes.stale}<span class="sb-item stale" data-testid="list-stale" title="Última lista conhecida; atualiza quando a conexão voltar.">lista offline{notes.staleAt ? ` de ${new Date(notes.staleAt).toLocaleString()}` : ''}</span>{/if}
      {#if nav.showHidden}<span class="sb-item">hidden shown</span>{/if}
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
    {#if toast}<span class="sb-toast {toast.tone}" role="status">{toast.text}</span>{/if}
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

  {#if paletteMode}
    <CommandPalette
      commands={paletteCommands}
      notes={notes.list}
      commandMode={paletteMode === 'command'}
      onnote={openFromPalette}
      onclose={() => { paletteMode = null; void focusColumn(true); }}
    />
  {/if}

  {#if menu}
    <ContextMenu x={menu.x} y={menu.y} items={menu.items} title={menu.title} onrun={runMenu} onclose={() => (menu = null)} />
  {/if}

  {#if hintsOpen}
    <HintOverlay root={hintRoot ?? (() => homeEl)} onclose={() => { hintsOpen = false; hintRoot = null; }} />
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

<style>
  .vault-home {
    height: 100vh;
    height: 100dvh;
    background: var(--color-background);
    color: var(--color-text);
    display: flex;
    flex-direction: column;
  }
  .mono { font-family: var(--font-mono); }

  /* ── top bar ───────────────────────────────────────────── */
  .topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-3);
    height: 44px;
    padding: 0 var(--sp-2) 0 var(--sp-3);
    border-bottom: 1px solid var(--hairline);
    flex: none;
  }
  .top-left { display: flex; align-items: center; gap: var(--sp-1); min-width: 0; flex: 1; }
  .home-mark {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    cursor: pointer;
    flex: none;
  }
  .home-mark:hover { background: var(--tint-hover); }
  .switcher-slot { flex: none; max-width: 220px; }
  .topbar-right { display: flex; align-items: center; gap: var(--sp-1); flex: none; }
  .palette-btn { gap: 6px; color: var(--color-text-dim); border-color: var(--hairline); min-width: 150px; justify-content: flex-start; }
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
    color: var(--color-text-dim);
    font-size: inherit;
    cursor: pointer;
    padding: 3px 6px;
    border-radius: var(--radius-sm);
  }
  .crumb:hover, .crumb:focus-visible { background: var(--tint-hover); color: var(--color-text); }
  .crumb[aria-current='location'] { color: var(--color-text); font-weight: 550; }
  .crumb.back { color: var(--color-text); }
  .crumb-note { color: var(--color-text); font-weight: 550; overflow: hidden; text-overflow: ellipsis; padding: 0 4px; }
  .sep { color: var(--color-text-dim); opacity: 0.5; }

  /* ── miller columns ────────────────────────────────────── */
  .miller {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(150px, 0.9fr) minmax(220px, 1.3fr) minmax(0, 3fr);
    transition: grid-template-columns 160ms var(--ease);
  }
  .miller.no-preview { grid-template-columns: minmax(150px, 1fr) minmax(0, 3fr) 0; }
  .miller.no-preview .col-preview { display: none; }
  .miller.note-mode { grid-template-columns: 0 minmax(200px, 0.9fr) minmax(0, 3.6fr); }
  .miller.note-mode .col-parent { display: none; }
  /* Explicit tracks: a hidden column must not shift the others. */
  .col-parent { grid-column: 1; grid-row: 1; }
  .col-current { grid-column: 2; grid-row: 1; }
  /* Focused pane (Ctrl-h/j/k/l): a quiet accent line along the top. */
  .col.pane-focus { box-shadow: inset 0 2px 0 color-mix(in srgb, var(--color-primary) 50%, transparent); }
  .col-preview { grid-column: 3; grid-row: 1; }
  .col {
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    border-right: 1px solid var(--hairline);
  }
  /* Block (not flex): the article centres itself with max-width. */
  .col-preview { border-right: none; display: block; }
  .col-parent { background: color-mix(in srgb, var(--color-overlay-bg) 35%, var(--color-background)); }
  .col-empty {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: var(--sp-4) var(--sp-3);
  }
  .col-empty-name { font-weight: 600; font-size: var(--text-md); }
  .col-empty-meta { font-size: var(--text-xs); color: var(--color-text-dim); }
  .filter-row {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    height: 34px;
    padding: 0 var(--sp-3);
    border-bottom: 1px solid var(--hairline);
    background: var(--tint-primary);
  }
  .filter-slash { font-family: var(--font-mono); color: var(--color-primary); font-weight: 700; }
  .filter-input {
    flex: 1;
    min-width: 0;
    background: transparent;
    border: none;
    outline: none;
    color: var(--color-text);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
  }
  .filter-input::-webkit-search-cancel-button { display: none; }
  .filter-count { font-family: var(--font-mono); font-size: var(--text-2xs); color: var(--color-text-dim); }

  /* Narrow screens: one column at a time + breadcrumb. */
  @media (max-width: 720px) {
    .home-mark { display: none; }
    .switcher-slot { max-width: 34vw; }
    /* Keep the trail (it is the only "up" affordance on touch); at the
       root it would only repeat the switcher's book name. */
    .breadcrumb > .crumb:only-of-type { display: none; }
    .palette-btn { min-width: 0; }
    .palette-label, .palette-btn kbd { display: none; }
    .miller,
    .miller.no-preview,
    .miller.note-mode { grid-template-columns: minmax(0, 1fr); }
    .miller .col-parent { display: none; }
    .col-current, .col-preview { grid-column: 1; }
    .miller:not(.note-mode) .col-preview { display: none; }
    .miller.note-mode .col-current { display: none; }
    .miller.note-mode .col-preview { display: block; }
    .preview { padding: var(--sp-5) var(--sp-4); }
    .sb-item:not(.sync):not(.stale) { display: none; }
  }

  .preview {
    overflow-y: auto;
    padding: var(--sp-6) var(--sp-6) var(--sp-7);
    outline: none;
  }
  .miller:not(.note-mode) .col-preview:has(> :global(.miller-col)) { padding: 0; }

  /* ── reading view ──────────────────────────────────────── */
  /* Typeface, size and leading come from .lumi-prose (app.css), shared
     with the split preview and Live Preview. */
  .rendered {
    max-width: calc(var(--md-measure) + 2px);
    margin: 0 auto;
    padding-bottom: 20vh;
  }
  /* The pane that changes between explorer / reader / editor. */
  .col-preview { view-transition-name: lumi-pane; }
  .split-btn[aria-pressed='true'] { color: var(--color-primary); background: var(--tint-active); }
  .reading-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-3);
    min-height: 30px;
    margin-bottom: var(--sp-5);
    font-family: var(--font-ui);
    font-size: var(--text-md);
    line-height: 1.4;
  }
  .note-crumbs {
    display: flex;
    align-items: baseline;
    gap: 6px;
    min-width: 0;
    font-size: var(--text-sm);
    color: var(--color-text-dim);
    overflow: hidden;
    white-space: nowrap;
  }
  .crumb-part { overflow: hidden; text-overflow: ellipsis; }
  .crumb-sep { opacity: 0.45; }
  .rendered-actions { display: flex; gap: var(--sp-2); align-items: center; margin-left: auto; }
  .reading-meta { color: var(--color-text-dim); font-size: var(--text-xs); font-variant-numeric: tabular-nums; margin-right: var(--sp-1); }
  .rendered-title {
    margin: 0 0 0.6em;
    font-size: 1.875em;
    line-height: 1.18;
    font-weight: 700;
    letter-spacing: -0.022em;
    color: var(--md-heading);
    text-wrap: balance;
  }
  .rendered :global(.md-body) { animation: reader-in 200ms var(--ease); }
  @keyframes reader-in { from { opacity: 0; transform: translateY(4px); } }
  .danger-hover:hover { color: var(--color-error); }

  /* ── states ────────────────────────────────────────────── */
  .placeholder,
  .error {
    padding: var(--sp-6) var(--sp-4);
    color: var(--color-text-dim);
    text-align: center;
    font-size: var(--text-sm);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--sp-3);
  }
  .error { color: var(--color-error); }
  .empty-book { margin: auto; max-width: 420px; }
  .empty-title { color: var(--color-text); font-weight: 600; font-size: var(--text-lg); }
  .hints { height: 100%; justify-content: center; }
  .hint-grid {
    display: grid;
    grid-template-columns: repeat(3, auto);
    gap: var(--sp-3) var(--sp-5);
    font-size: var(--text-xs);
  }
  .hint-grid span { display: inline-flex; gap: 4px; align-items: center; }
  .spinner {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    border: 2px solid var(--hairline);
    border-top-color: var(--color-primary);
    animation: spin 0.7s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  .stale { color: var(--color-warning); font-size: var(--text-xs); }
  .banner {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--sp-3);
    flex-wrap: wrap;
    margin: var(--sp-2) var(--sp-3) 0;
    padding: var(--sp-2) var(--sp-3);
    background: var(--tint-primary);
    border: 1px solid color-mix(in srgb, var(--color-primary) 30%, transparent);
    border-radius: var(--radius);
    font-size: var(--text-xs);
  }
  .banner.conflict {
    background: color-mix(in srgb, var(--color-warning) 10%, transparent);
    border-color: color-mix(in srgb, var(--color-warning) 40%, transparent);
  }
  .preview .banner { margin: 0 auto var(--sp-3); max-width: calc(var(--md-measure) + 2px); }
  .banner-actions { display: inline-flex; gap: var(--sp-1); flex-wrap: wrap; }

  /* ── editor ────────────────────────────────────────────── */
  /* The pane is the editor: a slim note bar on top, the writing
     column below (centred by the editor itself), the scrollbar at the
     pane edge. */
  .preview:has(> .editor-frame) { padding: 0; overflow: hidden; }
  .editor-frame {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }
  .editor-frame > .error { flex: none; padding: var(--sp-3) var(--sp-4); }
  .editor-scroll { flex: 1; min-height: 0; overflow-y: auto; padding: var(--sp-5) var(--sp-5) 0; }
  .note-bar {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-3);
    height: 44px;
    padding: 0 var(--sp-3) 0 var(--sp-4);
    border-bottom: 1px solid color-mix(in srgb, var(--hairline) 55%, transparent);
  }
  .nb-lead { display: flex; gap: var(--sp-2); align-items: center; min-width: 0; flex: 1; }
  .nb-crumbs {
    flex: none;
    max-width: 30%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--color-text-dim);
    font-size: var(--text-sm);
  }
  .nb-sep { margin-left: 6px; opacity: 0.45; }
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
    letter-spacing: -0.005em;
    cursor: text;
    transition: background 120ms var(--ease);
  }
  .nb-title:hover { background: var(--tint-hover); }
  .nb-actions { flex: none; display: flex; gap: 2px; align-items: center; }
  .nb-seg { margin-right: var(--sp-1); background: transparent; border-color: color-mix(in srgb, var(--hairline) 70%, transparent); }
  .nb-seg button { height: 22px; padding: 0 10px; }
  .nb-seg button.active { background: var(--tint-active); color: var(--color-text); box-shadow: none; }
  .nb-icon { color: var(--color-text-dim); }
  .nb-icon:hover { color: var(--color-text); }
  .nb-divider { width: 1px; height: 16px; margin: 0 var(--sp-2); background: var(--hairline); }
  .nb-done { height: 26px; padding: 0 12px; }
  .conn-dot {
    flex: none;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--color-text-dim);
    font-size: 0;
    color: transparent;
    overflow: hidden;
    transition: background 200ms var(--ease), box-shadow 200ms var(--ease);
  }
  .conn-connected { background: var(--color-accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-accent) 16%, transparent); }
  .conn-connecting { background: var(--color-warning); }
  .conn-disconnected { background: var(--color-error); }
  .peers { display: flex; margin-left: var(--sp-1); }
  .peer-chip {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    font-size: 10px;
    font-weight: 700;
    color: var(--color-background);
    background: var(--peer-color, var(--color-secondary));
    border: 2px solid var(--color-background);
    margin-left: -4px;
  }
  @media (max-width: 720px) {
    .note-bar { padding: 0 var(--sp-2) 0 var(--sp-3); gap: var(--sp-2); }
    .nb-crumbs, .nb-divider, .nb-settings { display: none; }
    .nb-seg button { padding: 0 8px; }
  }

  /* ── prompt / confirm bars ─────────────────────────────── */
  .prompt-form, .confirm-bar {
    flex: none;
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    height: 38px;
    padding: 0 var(--sp-3);
    border-top: 1px solid var(--hairline);
    background: color-mix(in srgb, var(--color-overlay-bg) 60%, var(--color-background));
    animation: ui-rise 120ms var(--ease);
  }
  .prompt-label {
    flex: none;
    padding: 2px 8px;
    border-radius: 4px;
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    background: var(--color-primary);
    color: var(--color-background);
  }
  .prompt-dir { color: var(--color-text-dim); font-size: var(--text-sm); flex: none; }
  .prompt-input {
    flex: 1;
    min-width: 80px;
    border: none;
    outline: none;
    background: transparent;
    color: var(--color-text);
    font-size: var(--text-sm);
  }
  .prompt-preview {
    flex: none;
    max-width: 45%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-xs);
    color: var(--color-text-dim);
  }
  .prompt-preview.err { color: var(--color-error); }
  .confirm-bar { justify-content: space-between; font-size: var(--text-sm); background: color-mix(in srgb, var(--color-error) 8%, var(--color-background)); }
  .confirm-actions { display: inline-flex; gap: var(--sp-2); flex: none; }
  .confirm-bar kbd { background: transparent; border-color: currentColor; color: inherit; opacity: 0.8; }

  /* ── status bar ────────────────────────────────────────── */
  .statusbar {
    flex: none;
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    height: var(--bar-h);
    padding: 0 0 0 var(--sp-3);
    border-top: 1px solid var(--hairline);
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    color: var(--color-text-dim);
    white-space: nowrap;
    overflow: hidden;
    font-variant-numeric: tabular-nums;
  }
  .sb-mode {
    flex: none;
    align-self: center;
    margin-left: calc(-1 * var(--sp-1));
    padding: 1px 7px;
    border-radius: 4px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    background: color-mix(in srgb, var(--m) 16%, transparent);
    color: var(--m);
    --m: var(--color-primary);
    transition: background 120ms var(--ease), color 120ms var(--ease);
  }
  .sb-mode[data-mode='insert'] { --m: var(--color-accent); }
  .sb-mode[data-mode='visual'] { --m: var(--color-secondary); }
  .sb-mode[data-mode='replace'] { --m: var(--color-error); }
  .sb-mode[data-mode='plain'] { display: none; }
  .sb-pending { color: var(--color-warning); font-weight: 600; }
  .sync::before {
    content: '';
    display: inline-block;
    width: 6px;
    height: 6px;
    margin-right: 6px;
    border-radius: 50%;
    background: var(--color-accent);
    vertical-align: 1px;
  }
  .sync.pending::before { background: var(--color-warning); }
  .sync.offline::before { background: var(--color-text-dim); }
  .sb-path { color: var(--color-text); overflow: hidden; text-overflow: ellipsis; min-width: 0; max-width: 40%; }
  .sb-spacer { flex: 1; }
  .sb-toast { padding: 1px 8px; border-radius: 4px; background: var(--tint-active); color: var(--color-text); overflow: hidden; text-overflow: ellipsis; }
  .sb-toast.warn { background: color-mix(in srgb, var(--color-warning) 16%, transparent); }
  .sb-toast.error { background: color-mix(in srgb, var(--color-error) 18%, transparent); }
  .sb-help {
    align-self: stretch;
    width: 28px;
    border: none;
    border-left: 1px solid var(--hairline);
    background: transparent;
    color: var(--color-text-dim);
    font-family: var(--font-mono);
    cursor: pointer;
  }
  .sb-help:hover { color: var(--color-text); background: var(--tint-hover); }
</style>
