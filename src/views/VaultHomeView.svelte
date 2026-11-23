<script lang="ts">
  import { onMount, onDestroy, untrack, tick } from 'svelte';
  import { vaults } from '../lib/vaults.svelte.ts';
  import { notes } from '../lib/notes.svelte.ts';
  import { renderMarkdown } from '../lib/markdown.ts';
  import { ApiError } from '../lib/types.ts';
  import * as api from '../lib/api.ts';
  import { offline, bundleMarkdown, downloadText, exportFilename } from '../lib/offline.svelte.ts';
  import { planSession, startSession, loadEditorSession, flushPending } from '../lib/editor-boot.ts';
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
  import { findNoteByHref } from '../lib/links.ts';
  import { legendFor, contextForVimMode, type LegendContext } from '../lib/legend.ts';
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
  import { editorSettings } from '../lib/editor-settings.svelte.ts';
  import { countWords, type EditorStats } from '../lib/textstats.ts';

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
  let vimState = $state<{ mode: string; pending: string | null }>({ mode: 'normal', pending: null });
  let paletteMode = $state<null | 'all' | 'command'>(null);

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
    return () => window.removeEventListener('keydown', handleKey);
  });

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
    return !!(uiState.accountModal || uiState.createBookOpen || showSettings || uiState.settings || uiState.helpOpen || uiState.themePickerOpen || paletteMode);
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

    // Cmd/Ctrl+Shift+, : settings (editor section), from anywhere.
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.code === 'Comma') {
      e.preventDefault();
      if (uiState.settings) uiState.closeSettings();
      else uiState.openSettings(editMode ? 'vim' : 'editor');
      return;
    }
    if (overlayOpen()) return;

    // A component (CodeMirror/vim, a form control) already handled it.
    if (e.defaultPrevented) return;
    if (isEditableTarget(e.target)) return;

    // Inline delete confirmation owns y/n/Enter/Esc.
    if (pendingDelete) {
      e.preventDefault();
      if (e.key === 'y' || e.key === 'Y' || e.key === 'Enter') void confirmDelete();
      else if (e.key === 'n' || e.key === 'N' || e.key === 'Escape' || e.key === 'q') pendingDelete = null;
      return;
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
    if (editMode) return;

    const action = keymap.feed(e, pane === 'note' ? 'reader' : 'explorer');
    syncPending();
    if (!action) return;
    e.preventDefault();
    if (action.kind === 'pending') return;
    runAction(action);
  }

  /** Note id the next action applies to: the open note in the reader,
   *  else the note under the browser cursor. */
  function noteUnderFocus(): string | null {
    if (pane === 'note') return notes.selectedID;
    const cur = nav.current;
    return cur?.kind === 'note' ? cur.note.id : null;
  }

  function runAction(a: ShellAction): void {
    const reader = pane === 'note';
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
        if (target) void editNote(target);
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
    pane = 'note';
    await tick();
    previewEl?.focus();
  }

  function leaveNote(): void {
    pane = 'browse';
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

  function onReaderClick(e: MouseEvent): void {
    const a = (e.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
    if (!a) return;
    const href = a.getAttribute('href') ?? '';
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
  let previewHtml = $derived(notes.content ? renderMarkdown(notes.content.body) : '');
  const readingWords = $derived(notes.content ? countWords(notes.content.body ?? '') : 0);
  const noteFolder = $derived(notes.selected ? dirOf(notes.selected.path) : '');
  const noteCrumbs = $derived(noteFolder ? noteFolder.split('/') : []);

  function setEditMode(m: 'live' | 'source'): void {
    editorSettings.update({ editMode: m });
  }

  // ---- legend -------------------------------------------------------------------

  const eff = $derived(effectiveSettings(editorSettings.value));
  const legendCtx: LegendContext = $derived.by(() => {
    if (paletteMode) return 'palette';
    if (pendingDelete) return 'confirm';
    if (prompt) return 'prompt';
    if (editMode && editSession) return eff.vim ? contextForVimMode(vimState.mode) : 'insert';
    if (filterFocused) return 'filter';
    return pane === 'note' ? 'reader' : 'explorer';
  });
  const legendPending = $derived(editMode ? (vimState.pending === eff.leader ? eff.leader : vimState.pending) : shellPending);
  const legendItems = $derived(
    legendFor(legendCtx, legendPending, {
      leader: eff.leader,
      escapeSequences: eff.escapeSequences,
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

<div class="vault-home">
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
      <button class="ui-btn ghost sm palette-btn" onclick={() => (paletteMode = 'all')} type="button" title="Command palette (space, ⌘K)">
        <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="m10.5 10.5 3 3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
        <span class="palette-label">Search</span><kbd>⌘K</kbd>
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
    <section class="col col-parent" aria-label="Parent folder">
      {#if nav.parent != null}
        <MillerColumn
          entries={nav.parentEntries}
          cursor={nav.parentCursor}
          label="Parent folder {nav.parent === '' ? (vaults.selected?.name ?? 'root') : nav.parent}"
          idPrefix="parent"
          onpick={pickParent}
        />
      {:else}
        <div class="col-empty">
          <span class="ui-eyebrow">book</span>
          <span class="col-empty-name">{vaults.selected?.name ?? 'Book'}</span>
          <span class="col-empty-meta">{notes.list.length} notes</span>
        </div>
      {/if}
    </section>

    <section class="col col-current" aria-label="Current folder">
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
      />
    </section>

    <!-- Link clicks inside the rendered note are routed in-app; the
         keyboard path to the same links is the browser's own. -->
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
    <main class="col col-preview preview" bind:this={previewEl} tabindex="-1" aria-label="Preview" onclick={onReaderClick}>
      {#if pane === 'browse' && nav.current?.kind === 'folder' && nav.previewEntries}
        <MillerColumn
          entries={nav.previewEntries}
          cursor={nav.previewCursor}
          label="Contents of {nav.current.path}"
          idPrefix="preview"
          emptyText={nav.current.virtual ? 'New folder — a to create a note in it' : 'Empty folder'}
          onpick={pickPreview}
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
          <div class="editor-frame" class:readable={editorSettings.value.readableWidth}>
            <div class="editor-bar">
              <div class="editor-meta">
                <span class="conn-dot conn-{editSession.status}" data-testid="conn-status" title="Live sync: {editSession.status}">{editSession.status}</span>
                <span class="editor-title">{notes.selected?.title}</span>
                {#if editSession.peers.length > 0}
                  <span class="peers">
                    {#each editSession.peers as p (p.clientID)}
                      <span class="peer-chip" style="--peer-color: {p.color}" title={p.name}>{p.name.slice(0, 1).toUpperCase()}</span>
                    {/each}
                  </span>
                {/if}
              </div>
              <div class="editor-actions">
                <div class="ui-seg view-seg" role="group" aria-label="View mode" data-testid="view-mode">
                  <button type="button" onclick={exitEdit} title="Reading view (Cmd/Ctrl+E)">Reading</button>
                  <button type="button" class:active={editorSettings.value.editMode === 'live'}
                    aria-pressed={editorSettings.value.editMode === 'live'}
                    onclick={() => setEditMode('live')} title="Live Preview (Cmd/Ctrl+Shift+E)">Live</button>
                  <button type="button" class:active={editorSettings.value.editMode === 'source'}
                    aria-pressed={editorSettings.value.editMode === 'source'}
                    onclick={() => setEditMode('source')} title="Source mode (Cmd/Ctrl+Shift+E)">Source</button>
                </div>
                <button class="ui-btn ghost sm" onclick={saveEdit} disabled={saving || !editSession.editable} type="button" title="Sync now (⌘S)">{saving ? 'Saving…' : 'Save'}</button>
                <button class="ui-btn sm" onclick={exitEdit} type="button">Done</button>
              </div>
            </div>
            {#if editError}<div class="error">{editError}</div>{/if}
            {#if editSession.lastError}<div class="error" data-testid="session-error">{editSession.lastError}</div>{/if}
            {#if !editSession.editable}
              <!-- Join rule: read-only preview until the server's
                   SyncStep2 has arrived. Never a local seed. -->
              <div class="placeholder" data-testid="editor-syncing">
                {editSession.stopped ? 'Live editing unavailable.' : 'Connecting to live editor… (read-only until synced)'}
              </div>
              <article class="rendered readonly-preview" data-prose={editorSettings.value.proseFont}>
                {@html previewHtml}
              </article>
            {:else if editSession.emptyAtSync && (notes.content.body ?? '') !== ''}
              <!-- Legacy note: server CRDT never initialised. Editing an
                   empty doc would overwrite the file on the next mirror,
                   so require an explicit action. -->
              <div class="error" data-testid="editor-uninitialised">
                The server has no live-editing state for this note yet. Load the
                file's current contents into the shared document to start editing.
                <button class="ui-btn sm" onclick={initialiseFromFile} type="button">Load file contents</button>
              </div>
              <article class="rendered readonly-preview" data-prose={editorSettings.value.proseFont}>
                {@html previewHtml}
              </article>
            {:else}
              <NoteEditor
                session={editSession}
                settings={editorSettings.value}
                onexit={exitEdit}
                onopensettings={() => uiState.openSettings('vim')}
                ontogglemode={() => editorSettings.toggleEditMode()}
                onstats={(st) => (editorStats = st)}
                notes={() => notes.list}
                notePath={() => notes.selected?.path ?? notes.content?.path ?? ''}
                onopennote={openLinkedNote}
                onvimstate={(st) => (vimState = st)}
              />
            {/if}
          </div>
        {:else if editorLoading}
          <div class="placeholder"><span class="spinner" aria-hidden="true"></span>Loading editor…</div>
        {:else}
          <article class="rendered" data-prose={editorSettings.value.proseFont}>
            <div class="reading-head">
              {#if noteCrumbs.length > 0}
                <nav class="note-crumbs" aria-label="Note location">
                  {#each noteCrumbs as c, i (i)}{#if i > 0}<span class="crumb-sep" aria-hidden="true">/</span>{/if}<span class="crumb-part">{c}</span>{/each}
                </nav>
              {/if}
              <div class="rendered-actions">
                {#if notes.contentStale}<span class="stale" data-testid="content-stale">cópia local (offline)</span>{/if}
                <span class="reading-meta">{readingWords} {readingWords === 1 ? 'word' : 'words'}</span>
                <button class="ui-btn sm" onclick={() => void enterEdit()} disabled={editorLoading} type="button" title="Edit (e or Cmd/Ctrl+E)">{editorLoading ? 'Loading…' : 'Edit'}</button>
                <button class="ui-btn ghost sm icon danger-hover" onclick={beginDelete} type="button" aria-label="Delete note"
                  disabled={structuralOffline} title={structuralOffline ? OFFLINE_HINT : 'Delete (d)'}>
                  <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>
                </button>
              </div>
            </div>
            <h1 class="rendered-title">{notes.selected?.title}</h1>
            <!-- DOMPurify-sanitised HTML, see lib/markdown.ts. -->
            {@html previewHtml}
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
    <CommandLegend items={legendItems} pending={legendPending} mode={legendMode} />
  {/if}

  <footer class="statusbar" data-testid="editor-status">
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
      <span class="sb-item">{editorSettings.value.editMode === 'live' ? 'Live Preview' : 'Source'}{eff.vim ? ' · vim' : ''}</span>
    {/if}
    <span class="sb-spacer"></span>
    {#if toast}<span class="sb-toast {toast.tone}" role="status">{toast.text}</span>{/if}
    {#if editMode && editSession}
      <span class="sb-item sync" data-testid="editor-sync-state" title={editSession.persistence
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
    .switcher-slot { max-width: 40vw; }
    .breadcrumb { display: none; }
    .palette-btn { min-width: 0; }
    .palette-label, .palette-btn kbd { display: none; }
    .miller,
    .miller.no-preview,
    .miller.note-mode { grid-template-columns: minmax(0, 1fr); }
    .miller .col-parent { display: none; }
    .miller:not(.note-mode) .col-preview { display: none; }
    .miller.note-mode .col-current { display: none; }
    .miller.note-mode .col-preview { display: block; }
    .preview { padding: var(--sp-4); }
    .sb-item:not(.sync):not(.stale) { display: none; }
  }

  .preview {
    overflow-y: auto;
    padding: var(--sp-6) var(--sp-6) var(--sp-7);
    outline: none;
  }
  .miller:not(.note-mode) .col-preview:has(> :global(.miller-col)) { padding: 0; }

  /* ── reading view ──────────────────────────────────────── */
  .rendered {
    max-width: 44rem;
    margin: 0 auto;
    font-family: var(--font-sans);
    font-size: 15.5px;
    line-height: 1.7;
    color: var(--color-text);
  }
  .rendered[data-prose='serif'] { font-family: var(--font-serif); font-size: 17px; }
  .rendered[data-prose='mono'] { font-family: var(--font-mono); font-size: 14px; }
  .reading-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-3);
    min-height: 28px;
    margin-bottom: var(--sp-3);
  }
  .note-crumbs {
    display: flex;
    align-items: baseline;
    gap: 4px;
    min-width: 0;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--color-text-dim);
    overflow: hidden;
    white-space: nowrap;
  }
  .crumb-part { overflow: hidden; text-overflow: ellipsis; }
  .crumb-sep { opacity: 0.5; }
  .rendered-actions { display: flex; gap: var(--sp-2); align-items: center; margin-left: auto; }
  .reading-meta { color: var(--color-text-dim); font-size: var(--text-xs); font-family: var(--font-mono); }
  .rendered-title {
    margin: 0 0 var(--sp-4);
    font-size: 2rem;
    line-height: 1.2;
    font-weight: 700;
    letter-spacing: -0.02em;
    color: var(--color-text);
  }
  .danger-hover:hover { color: var(--color-error); }

  /* Inline markdown styling, scoped to the rendered article so it
     doesn't leak. CSS variables let theming work without re-render. */
  :global(.rendered h1),
  :global(.rendered h2),
  :global(.rendered h3),
  :global(.rendered h4) {
    color: var(--color-text);
    line-height: 1.3;
    letter-spacing: -0.01em;
  }
  :global(.rendered h1) { font-size: 1.6rem; margin: 2rem 0 0.6rem; }
  :global(.rendered h2) { font-size: 1.3rem; margin: 1.8rem 0 0.5rem; }
  :global(.rendered h3) { font-size: 1.1rem; margin: 1.4rem 0 0.4rem; }
  :global(.rendered p)  { margin: 0.7rem 0; }
  :global(.rendered ul), :global(.rendered ol) { padding-left: 1.4rem; margin: 0.6rem 0; }
  :global(.rendered li) { margin: 0.2rem 0; }
  :global(.rendered li::marker) { color: var(--color-text-dim); }
  :global(.rendered a)  {
    color: var(--color-primary);
    text-decoration: underline;
    text-decoration-color: color-mix(in srgb, var(--color-primary) 40%, transparent);
    text-underline-offset: 3px;
  }
  :global(.rendered a:hover) { text-decoration-color: currentColor; }
  :global(.rendered a:not([href*=':'])) { text-decoration-style: dotted; }
  :global(.rendered code) {
    font-family: var(--font-mono);
    background: var(--tint-hover);
    color: var(--color-accent);
    padding: 0.1rem 0.35rem;
    border-radius: 4px;
    font-size: 0.86em;
  }
  :global(.rendered pre) {
    background: color-mix(in srgb, var(--color-overlay-bg) 70%, var(--color-background));
    padding: 0.9rem 1rem;
    overflow-x: auto;
    border-radius: var(--radius);
    border: 1px solid var(--hairline);
    line-height: 1.55;
  }
  :global(.rendered pre code) {
    background: transparent;
    color: var(--color-text);
    padding: 0;
  }
  :global(.rendered blockquote) {
    border-left: 2px solid var(--color-primary);
    padding-left: 1rem;
    color: var(--color-text-dim);
    margin: 1rem 0;
  }
  :global(.rendered img),
  :global(.rendered iframe),
  :global(.rendered video) {
    max-width: 100%;
    border-radius: var(--radius);
  }
  :global(.rendered table) {
    border-collapse: collapse;
    margin: 1rem 0;
    font-size: 0.92em;
  }
  :global(.rendered th),
  :global(.rendered td) {
    border-bottom: 1px solid var(--hairline);
    padding: 0.4rem 0.8rem;
    text-align: left;
  }
  :global(.rendered th) { color: var(--color-text-dim); font-weight: 600; }
  :global(.rendered hr) {
    border: none;
    border-top: 1px solid var(--hairline);
    margin: 2rem 0;
  }
  :global(.rendered input[type='checkbox']) { accent-color: var(--color-primary); margin-right: 0.4rem; }

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
  .preview .banner { margin: 0 auto var(--sp-3); max-width: 44rem; }
  .banner-actions { display: inline-flex; gap: var(--sp-1); flex-wrap: wrap; }

  /* ── editor ────────────────────────────────────────────── */
  .editor-frame {
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: var(--sp-2);
    height: 100%;
  }
  .editor-frame.readable { max-width: 52rem; }
  .preview:has(.editor-frame) { padding-top: var(--sp-3); padding-bottom: 0; }
  .editor-bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--sp-3);
    flex-wrap: wrap;
    padding: 0 var(--sp-1) var(--sp-2);
    border-bottom: 1px solid var(--hairline);
  }
  .editor-meta { display: flex; gap: var(--sp-2); align-items: center; min-width: 0; }
  .editor-title {
    color: var(--color-text);
    font-weight: 600;
    font-size: var(--text-sm);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .conn-dot {
    flex: none;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--color-text-dim);
    font-size: 0;
    color: transparent;
    overflow: hidden;
  }
  .conn-connected { background: var(--color-primary); box-shadow: 0 0 0 3px var(--tint-primary); }
  .conn-connecting { background: var(--color-warning); }
  .conn-disconnected { background: var(--color-error); }
  .peers { display: flex; }
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
  .editor-actions { display: flex; gap: var(--sp-1); align-items: center; }
  .view-seg button.active { background: var(--color-background); color: var(--color-text); }

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
