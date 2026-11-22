<script lang="ts">
  import { onMount, onDestroy, untrack, tick } from 'svelte';
  import { vaults } from '../lib/vaults.svelte.ts';
  import { notes } from '../lib/notes.svelte.ts';
  import { renderMarkdown } from '../lib/markdown.ts';
  import { ApiError } from '../lib/types.ts';
  import { isAuthFailure, createNoteWsTicket } from '../lib/api.ts';
  import { uiState } from '../lib/uistate.svelte.ts';
  import { books } from '../lib/books.svelte.ts';
  import { accounts } from '../lib/accounts.svelte.ts';
  import { sync } from '../lib/sync.svelte.ts';
  import { serverLabel } from '../lib/serverurl.ts';
  import { GChord, isEditableTarget } from '../lib/shortcuts.ts';
  import { MillerNav } from '../lib/miller.svelte.ts';
  import { breadcrumb, parentDir, type Entry } from '../lib/notetree.ts';
  import MillerColumn from '../components/MillerColumn.svelte';
  import VaultSettingsModal from '../components/VaultSettingsModal.svelte';
  import VaultCreateModal from '../components/VaultCreateModal.svelte';
  import BookSwitcher from '../components/BookSwitcher.svelte';
  import SyncStatusPopover from '../components/SyncStatusPopover.svelte';

  let showSettings = $state(false);
  // Editor + Yjs runtime is lazy-loaded on first edit; types stay
  // static so the rest of the view keeps its existing typing.
  import type { EditorSession as EditorSessionT } from '../lib/editor-session.svelte.ts';

  type NoteEditorComp = typeof import('../components/NoteEditor.svelte').default;
  type EditorSessionCtor = typeof import('../lib/editor-session.svelte.ts').EditorSession;

  // Yazi/miller browser (wave 3): parent | current | preview columns
  // derived from note paths. Grammar mirrors tui-client/ui/keys_tree.go.
  const nav = new MillerNav(() => notes.list);
  /** 'browse' = walking columns; 'note' = the open note owns the main
   *  pane (Enter/l on a note), parent column hidden. */
  let pane = $state<'browse' | 'note'>('browse');
  let showPreview = $state(true); // zp
  let filterOpen = $state(false);
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

  // Slice 4.3 — modals.
  type Modal = null | 'new-note' | 'delete-confirm';
  let modal = $state<Modal>(null);
  let modalErr = $state<string | null>(null);
  let newNoteTitle = $state('');

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
  let EditorSession = $state<EditorSessionCtor | null>(null);

  let lastDelete = $state(0); // 'dd' double-tap timestamp
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

  // g1–g9 / gb / gg chords + ⌃⌘1–9 on macOS (SPEC-LIVROS §5).
  const chord = new GChord(Date.now, { nav: true });

  function handleKey(e: KeyboardEvent): void {
    // Cmd/Ctrl+S: refresh after the live save, regardless of focus.
    if (editMode && (e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      void saveEdit();
      return;
    }

    if (modal != null) {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeModal();
      }
      return; // let the input handle other keys
    }

    // A component (CodeMirror/vim, a form control) already handled it.
    if (e.defaultPrevented) return;
    if (isEditableTarget(e.target)) return;

    // In edit mode, leaving is an explicit command only (Done button,
    // Mod-Enter, vim :q) — never a stray Esc.
    if (editMode) return;
    if (uiState.accountModal || uiState.createBookOpen || showSettings) return;

    const c = chord.feed(e);
    if (c) {
      e.preventDefault();
      if (c.kind === 'book') books.openShortcut(c.n);
      else if (c.kind === 'picker') books.openPicker();
      else if (c.kind === 'top') pane === 'note' ? scrollNote('top') : nav.top();
      else if (c.kind === 'home') goHome();
      else if (c.kind === 'preview') showPreview = !showPreview;
      return;
    }

    // Shared by both panes.
    if (e.key === 'n' && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      openNewNote();
      return;
    }
    if (e.key === 'r' && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      void notes.refresh();
      return;
    }
    if (e.key === 'e' && !e.ctrlKey && !e.metaKey) {
      const target = noteUnderFocus();
      if (target) {
        e.preventDefault();
        void editNote(target);
      }
      return;
    }
    if (e.key === 'd' && !e.ctrlKey && !e.metaKey) {
      // Delete: 'dd' double-tap, on the note under the cursor.
      const target = noteUnderFocus();
      if (!target) return;
      e.preventDefault();
      const now = Date.now();
      if (now - lastDelete < 500) {
        lastDelete = 0;
        void notes.select(target).then(() => {
          if (notes.selectedID === target) modal = 'delete-confirm';
        });
      } else {
        lastDelete = now;
      }
      return;
    }

    if (pane === 'note') return handleNoteKey(e);
    handleBrowseKey(e);
  }

  /** Note id the next action applies to: the open note in the reader,
   *  else the note under the browser cursor. */
  function noteUnderFocus(): string | null {
    if (pane === 'note') return notes.selectedID;
    const cur = nav.current;
    return cur?.kind === 'note' ? cur.note.id : null;
  }

  function handleBrowseKey(e: KeyboardEvent): void {
    const k = e.key;
    const page = currentCol?.pageRows() ?? 10;
    let handled = true;
    if (k === 'j' || k === 'ArrowDown') { debounceNext = true; nav.move(1); }
    else if (k === 'k' || k === 'ArrowUp') { debounceNext = true; nav.move(-1); }
    // (No Ctrl-f/Ctrl-b: those stay with the browser's find/back.)
    else if (k === 'PageDown') { debounceNext = true; nav.move(page); }
    else if (k === 'PageUp') { debounceNext = true; nav.move(-page); }
    else if (e.ctrlKey && k === 'd') { debounceNext = true; nav.move(Math.ceil(page / 2)); }
    else if (e.ctrlKey && k === 'u') { debounceNext = true; nav.move(-Math.ceil(page / 2)); }
    else if (k === 'Home') nav.top();
    else if (k === 'G' || k === 'End') nav.bottom();
    else if (k === 'h' || k === 'ArrowLeft') { nav.left(); focusColumn(); }
    else if (k === 'l' || k === 'ArrowRight' || k === 'Enter') activate();
    else if (k === 'H') { nav.historyBack(); focusColumn(); }
    else if (k === 'L') { nav.historyForward(); focusColumn(); }
    else if (k === '/') void openFilter();
    else if (k === 'Escape') {
      if (nav.filter) { nav.setFilter(''); filterOpen = false; }
      else back();
    } else handled = false;
    if (handled) e.preventDefault();
  }

  function handleNoteKey(e: KeyboardEvent): void {
    const k = e.key;
    let handled = true;
    if (k === 'h' || k === 'ArrowLeft' || k === 'Escape') leaveNote();
    else if (k === 'j' || k === 'ArrowDown') scrollNote(60);
    else if (k === 'k' || k === 'ArrowUp') scrollNote(-60);
    else if (e.ctrlKey && k === 'd') scrollNote('half');
    else if (e.ctrlKey && k === 'u') scrollNote('-half');
    else if (k === 'G' || k === 'End') scrollNote('bottom');
    else if (k === 'Home') scrollNote('top');
    else if (k === 'H') { leaveNote(); nav.historyBack(); }
    else handled = false;
    if (handled) e.preventDefault();
  }

  // ---- browser actions ---------------------------------------------------

  /** l / Enter / → : descend into a folder, or open the note. */
  function activate(): void {
    const note = nav.right();
    if (note) void openNote(note.note.id);
    else focusColumn();
  }

  async function openNote(id: string): Promise<void> {
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

  function scrollNote(by: number | 'top' | 'bottom' | 'half' | '-half'): void {
    const el = previewEl;
    if (!el) return;
    if (by === 'top') el.scrollTop = 0;
    else if (by === 'bottom') el.scrollTop = el.scrollHeight;
    else if (by === 'half') el.scrollTop += el.clientHeight / 2;
    else if (by === '-half') el.scrollTop -= el.clientHeight / 2;
    else el.scrollTop += by;
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

  // ---- modals + actions --------------------------------------------------

  function closeModal(): void {
    modal = null;
    modalErr = null;
    newNoteTitle = '';
  }

  function openNewNote(): void {
    modal = 'new-note';
    modalErr = null;
    newNoteTitle = '';
  }

  async function submitNewNote(): Promise<void> {
    const t = newNoteTitle.trim();
    if (!t) return;
    // The server creates notes at the book root; move it into the
    // folder being browsed.
    const folder = nav.dir;
    creating = true;
    try {
      const created = await notes.create({ title: t, body: '' });
      if (created && folder && notes.selectedID === created.id) {
        await notes.update({ path: `${folder}/${created.path.split('/').pop()}` });
      }
      closeModal();
      if (created) nav.reveal(created.id);
    } catch (e) {
      modalErr = e instanceof ApiError ? (e.detail ?? e.code) : (e as Error).message;
    } finally {
      creating = false;
    }
  }

  async function confirmDelete(): Promise<void> {
    try {
      await notes.deleteSelected();
      closeModal();
    } catch (e) {
      modalErr = e instanceof ApiError ? (e.detail ?? e.code) : (e as Error).message;
    }
  }

  async function enterEdit(): Promise<void> {
    const vaultID = vaults.selectedID;
    const noteID = notes.selectedID;
    // The editor uses the ACTIVE BOOK's account: its server, token and
    // identity — never another account's.
    const book = vaultID ? books.bookForVault(vaultID) : null;
    const key = book ? books.accountKeyOf(book) : null;
    const acct = key ? accounts.get(key) : null;
    const user = key ? accounts.user(key) : null;
    if (!notes.content || !user || !vaultID || !noteID || !key || !acct) return;
    const token = accounts.tokenFor(key);
    if (!token) {
      editError = `Entre em ${serverLabel(acct.server_url)} para editar.`;
      return;
    }
    if (editorLoading || editSession) return;

    editorLoading = true;
    editError = null;
    try {
      // First edit per session pulls the CM6 + vim + y-codemirror.next
      // + yjs + y-websocket chunks, in parallel.
      if (!NoteEditor || !EditorSession) {
        const [editorMod, sessionMod] = await Promise.all([
          import('../components/NoteEditor.svelte'),
          import('../lib/editor-session.svelte.ts'),
        ]);
        NoteEditor = editorMod.default;
        EditorSession = sessionMod.EditorSession;
      }
      // The user may have moved on while the chunk loaded.
      if (notes.selectedID !== noteID || vaults.selectedID !== vaultID || editSession) return;

      // Join rule (CRDT client protocol §2): start from an EMPTY doc
      // and let the server's SyncStep2 deliver the text. Seeding the
      // Y.Text with the REST body here duplicated the whole note,
      // because the server's doc already holds that text under a
      // different clientID. Until the session reports `synced`, the
      // template shows a read-only preview instead of the editor.
      const client = accounts.client(key);
      editSession = new EditorSession(vaultID, noteID, token, user, {
        serverUrl: acct.server_url,
        probeAuth: async () => {
          try {
            await client.me();
            return 'ok';
          } catch (e) {
            return isAuthFailure(e) ? 'unauthorized' : 'unknown';
          }
        },
        onAuthFailure: () => accounts.markNeedsLogin(key, 'sessão expirada'),
        // Fresh single-use ticket per (re)connect; 404 → ?token= fallback.
        fetchTicket: () => createNoteWsTicket(vaultID, noteID),
        getToken: () => accounts.tokenFor(key),
      });
      sync.setEditor(vaultID, editSession);
      editMode = true;
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
      if (sess.synced && !sess.isDestroyed) {
        notes.applyLocalBody(sess.noteID, sess.ytext.toString());
      }
      sess.destroy();
      sync.setEditor(sess.vaultID, null);
      editSession = null;
    }
    editMode = false;
    editError = null;
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
    if (!sess.synced || sess.status !== 'connected') {
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

  function fmtDate(s: string): string {
    return s.replace('T', ' ').slice(0, 16);
  }
</script>

<div class="vault-home">
  <header class="topbar">
    <button class="link-button" onclick={back} type="button">← Livros</button>
    <div class="title">
      <span class="vault-name">{vaults.selected?.name}</span>
      <span class="vault-slug">{vaults.selected?.slug}</span>
    </div>
    <div class="topbar-right">
      <SyncStatusPopover />
      <button class="link-button" onclick={openNewNote} type="button">+ New</button>
      <button class="link-button" onclick={() => void notes.refresh()} type="button">Refresh</button>
      <button class="link-button" onclick={() => (showSettings = true)} type="button">Settings</button>
      <button class="link-button" onclick={() => uiState.openThemePicker()} type="button">Theme</button>
    </div>
  </header>

  <div class="nav-bar">
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
    <span class="note-count" aria-live="off">
      {notes.list.length} notes{notes.loadingMore ? '…' : ''}
    </span>
  </div>
  {#each books.banners as b (b.id)}
    <div class="banner" role="status">
      {b.text}
      <button class="link-button" type="button" onclick={() => books.dismissBanner(b.id)}>{b.kind === 'dedupe' ? 'Manter' : 'ok'}</button>
    </div>
  {/each}
  <div class="sr-only" aria-live="polite" data-testid="nav-live">{liveMsg}</div>

  {#if activeRevoked && books.active}
    <div class="placeholder" data-testid="book-revoked">
      Você não tem mais acesso a este livro.
      <button class="link-button" type="button" onclick={() => books.active && books.removeFromList(books.active.id)}>Remover da lista</button>
    </div>
  {:else if activeStatus?.state === 'needs_login' && books.active}
    <div class="placeholder" data-testid="book-needs-login">
      Entre em {serverLabel(books.active.server_url)} para sincronizar.
      <button class="link-button" type="button" onclick={() => books.active && uiState.openSignIn(books.active.server_url, books.active.account)}>Entrar</button>
    </div>
  {:else if notes.loadingList && notes.list.length === 0}
    <div class="placeholder">Loading…</div>
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
  {:else if notes.list.length === 0}
    <div class="placeholder">No notes yet. Press <kbd>n</kbd> to create one.</div>
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
        <div class="col-empty">{vaults.selected?.name ?? 'Book'}</div>
      {/if}
    </section>

    <section class="col col-current" aria-label="Current folder">
      {#if filterOpen || nav.filter}
        <div class="filter-row">
          <span aria-hidden="true">/</span>
          <input
            class="filter-input"
            type="search"
            placeholder="filter this folder"
            aria-label="Filter current folder"
            value={nav.filter}
            bind:this={filterInput}
            oninput={(e) => nav.setFilter(e.currentTarget.value)}
            onkeydown={onFilterKey}
          />
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
        emptyText={nav.filter ? 'No matches' : 'Empty folder'}
        onpick={pickCurrent}
        onopen={openCurrent}
      />
    </section>

    <main class="col col-preview preview" bind:this={previewEl} tabindex="-1" aria-label="Preview">
      {#if pane === 'browse' && nav.current?.kind === 'folder' && nav.previewEntries}
        <MillerColumn
          entries={nav.previewEntries}
          cursor={nav.previewCursor}
          label="Contents of {nav.current.path}"
          idPrefix="preview"
          onpick={pickPreview}
        />
      {:else if !notes.selectedID}
        <div class="placeholder">
          <kbd>j</kbd>/<kbd>k</kbd> move, <kbd>h</kbd>/<kbd>l</kbd> walk folders,
          <kbd>Enter</kbd> opens, <kbd>H</kbd>/<kbd>L</kbd> history, <kbd>/</kbd> filter,
          <kbd>gh</kbd> book root, <kbd>zp</kbd> preview, <kbd>r</kbd> refresh.
        </div>
      {:else if notes.loadingContent}
        <div class="placeholder">Loading…</div>
      {:else if notes.contentError}
        <div class="error">{notes.contentError}</div>
      {:else if notes.content}
        {#if editMode && editSession && NoteEditor}
          <div class="editor-frame">
            <div class="editor-bar">
              <div class="editor-meta">
                <span class="editor-title">Editing {notes.selected?.title}</span>
                <span class="conn-pill conn-{editSession.status}" data-testid="conn-status">{editSession.status}</span>
                {#if editSession.peers.length > 0}
                  <span class="peers">
                    {#each editSession.peers as p (p.clientID)}
                      <span class="peer-chip" style="--peer-color: {p.color}" title={p.name}>{p.name}</span>
                    {/each}
                  </span>
                {/if}
              </div>
              <div class="editor-actions">
                <button class="primary-button" onclick={saveEdit} disabled={saving || !editSession.synced} type="button">
                  {saving ? 'Saving…' : 'Save'}
                </button>
                <button class="link-button" onclick={exitEdit} type="button">Done</button>
              </div>
            </div>
            {#if editError}<div class="error">{editError}</div>{/if}
            {#if editSession.lastError}<div class="error" data-testid="session-error">{editSession.lastError}</div>{/if}
            {#if !editSession.synced}
              <!-- Join rule: read-only preview until the server's
                   SyncStep2 has arrived. Never a local seed. -->
              <div class="placeholder" data-testid="editor-syncing">
                {editSession.stopped ? 'Live editing unavailable.' : 'Connecting to live editor… (read-only until synced)'}
              </div>
              <article class="rendered readonly-preview">
                {@html previewHtml}
              </article>
            {:else if editSession.emptyAtSync && (notes.content.body ?? '') !== ''}
              <!-- Legacy note: server CRDT never initialised. Editing an
                   empty doc would overwrite the file on the next mirror,
                   so require an explicit action. -->
              <div class="error" data-testid="editor-uninitialised">
                The server has no live-editing state for this note yet. Load the
                file's current contents into the shared document to start editing.
                <button class="link-button" onclick={initialiseFromFile} type="button">Load file contents</button>
              </div>
              <article class="rendered readonly-preview">
                {@html previewHtml}
              </article>
            {:else}
              <NoteEditor session={editSession} onexit={exitEdit} />
            {/if}
            <div class="hint">
              Edits are saved continuously and sync live to other peers; the file on
              disk follows within ~500 ms.
              <kbd>Cmd/Ctrl</kbd>+<kbd>Enter</kbd>, vim <kbd>:q</kbd> or <em>Done</em> closes the editor.
            </div>
          </div>
        {:else if editorLoading}
          <div class="placeholder">Loading editor…</div>
        {:else}
          <article class="rendered">
            <h1 class="rendered-title">{notes.selected?.title}</h1>
            <div class="rendered-actions">
              <button class="link-button" onclick={() => void enterEdit()} disabled={editorLoading} type="button">
                {editorLoading ? 'Loading…' : 'Edit'}
              </button>
              <button class="link-button danger" onclick={() => (modal = 'delete-confirm')} type="button">Delete</button>
            </div>
            <!-- DOMPurify-sanitised HTML, see lib/markdown.ts. -->
            {@html previewHtml}
          </article>
        {/if}
      {/if}
    </main>
  </div>
  {/if}

  {#if modal === 'new-note'}
    <div
      class="modal-overlay"
      role="presentation"
      onclick={closeModal}
      onkeydown={(e) => { if (e.key === 'Escape') closeModal(); }}
    >
      <div
        class="modal-panel"
        role="dialog"
        aria-modal="true"
        tabindex="-1"
        aria-label="New note"
        onclick={(e) => e.stopPropagation()}
        onkeydown={(e) => e.stopPropagation()}
      >
        <form onsubmit={(e) => { e.preventDefault(); void submitNewNote(); }} class="modal-form">
          <h2>New note</h2>
          <!-- svelte-ignore a11y_autofocus -->
          <input
            class="login-input"
            type="text"
            placeholder="Title"
            bind:value={newNoteTitle}
            autofocus
          />
          {#if modalErr}<div class="error">{modalErr}</div>{/if}
          <div class="modal-actions">
            <button class="primary-button" type="submit">Create</button>
            <button class="link-button" type="button" onclick={closeModal}>Cancel</button>
          </div>
        </form>
      </div>
    </div>
  {/if}

  {#if modal === 'delete-confirm'}
    <div
      class="modal-overlay"
      role="presentation"
      onclick={closeModal}
      onkeydown={(e) => { if (e.key === 'Escape') closeModal(); }}
    >
      <div
        class="modal-panel"
        role="dialog"
        aria-modal="true"
        tabindex="-1"
        onclick={(e) => e.stopPropagation()}
        onkeydown={(e) => e.stopPropagation()}
      >
        <h2>Delete this note?</h2>
        <p class="modal-body">
          <strong>{notes.selected?.title}</strong> will be removed from the vault. The
          markdown file is unlinked but its CRDT history stays in the
          server's log until vault deletion.
        </p>
        {#if modalErr}<div class="error">{modalErr}</div>{/if}
        <div class="modal-actions">
          <button class="primary-button danger" type="button" onclick={confirmDelete}>Delete</button>
          <button class="link-button" type="button" onclick={closeModal}>Cancel</button>
        </div>
      </div>
    </div>
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

  .topbar {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    padding: 0.6rem 1rem;
    border-bottom: 1px solid var(--color-separator, var(--color-border));
  }
  .topbar-right {
    justify-self: end;
  }
  .title {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.1rem;
  }
  .vault-name {
    font-weight: 600;
    color: var(--color-text);
  }
  .vault-slug {
    font-size: 0.72rem;
    color: var(--color-text-dim, var(--color-muted));
  }

  .nav-bar {
    display: flex;
    align-items: stretch;
    gap: 0.5rem;
    border-bottom: 1px solid var(--color-separator, var(--color-border));
    min-height: 2.4rem;
  }
  .switcher-slot {
    width: 240px;
    flex: none;
    border-right: 1px solid var(--color-separator, var(--color-border));
  }
  .breadcrumb {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 0.15rem;
    overflow-x: auto;
    white-space: nowrap;
    font-size: 0.85rem;
  }
  .crumb {
    background: transparent;
    border: none;
    color: var(--color-secondary);
    font-family: inherit;
    font-size: inherit;
    cursor: pointer;
    padding: 0.15rem 0.3rem;
    border-radius: 3px;
  }
  .crumb:hover,
  .crumb:focus-visible { background: var(--color-selected-bg, var(--color-overlay-bg)); }
  .crumb[aria-current='location'] { color: var(--color-text); font-weight: 600; }
  .crumb-note { color: var(--color-text); font-weight: 600; overflow: hidden; text-overflow: ellipsis; }
  .sep { color: var(--color-text-dim, var(--color-muted)); }
  .note-count {
    align-self: center;
    padding-right: 1rem;
    font-size: 0.72rem;
    color: var(--color-text-dim, var(--color-muted));
    white-space: nowrap;
  }

  /* Miller columns: parent | current | preview. */
  .miller {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(140px, 1fr) minmax(220px, 1.4fr) minmax(0, 3fr);
  }
  .miller.no-preview {
    grid-template-columns: minmax(140px, 1fr) minmax(0, 3fr) 0;
  }
  .miller.no-preview .col-preview { display: none; }
  .miller.note-mode {
    grid-template-columns: 0 minmax(200px, 1fr) minmax(0, 3.5fr);
  }
  .miller.note-mode .col-parent { display: none; }
  .col {
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    border-right: 1px solid var(--color-separator, var(--color-border));
  }
  /* Block (not flex): the article centres itself with max-width. */
  .col-preview { border-right: none; display: block; }
  .col-parent { opacity: 0.85; }
  .col-empty {
    padding: 0.6rem;
    font-size: 0.8rem;
    color: var(--color-text-dim, var(--color-muted));
  }
  .filter-row {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.3rem 0.5rem;
    border-bottom: 1px solid var(--color-separator, var(--color-border));
    color: var(--color-secondary);
  }
  .filter-input {
    flex: 1;
    min-width: 0;
    background: transparent;
    border: none;
    outline: none;
    color: var(--color-text);
    font-family: inherit;
    font-size: 0.85rem;
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  /* Narrow screens: one column at a time + breadcrumb. */
  @media (max-width: 720px) {
    .switcher-slot { width: auto; max-width: 45%; }
    .note-count { display: none; }
    .miller,
    .miller.no-preview,
    .miller.note-mode { grid-template-columns: minmax(0, 1fr); }
    .miller .col-parent { display: none; }
    .miller:not(.note-mode) .col-preview { display: none; }
    .miller.note-mode .col-current { display: none; }
    .miller.note-mode .col-preview { display: block; }
    .preview { padding: 1rem; }
  }

  .preview {
    overflow-y: auto;
    padding: 1.5rem 2rem;
    outline: none;
  }
  .miller:not(.note-mode) .col-preview:has(> :global(.miller-col)) {
    padding: 0;
  }

  .rendered {
    max-width: 720px;
    margin: 0 auto;
    line-height: 1.55;
  }

  .rendered-title {
    margin: 0 0 1rem;
    font-size: 1.6rem;
    color: var(--color-text);
    border-bottom: 1px solid var(--color-separator, var(--color-border));
    padding-bottom: 0.3rem;
  }

  /* Inline markdown styling, scoped to the rendered article so it
     doesn't leak. CSS variables let theming work without re-render. */
  :global(.rendered h1),
  :global(.rendered h2),
  :global(.rendered h3),
  :global(.rendered h4) {
    color: var(--color-text);
    line-height: 1.25;
  }
  :global(.rendered h2) { font-size: 1.3rem; margin-top: 1.5rem; }
  :global(.rendered h3) { font-size: 1.1rem; margin-top: 1.3rem; }
  :global(.rendered p)  { margin: 0.6rem 0; }
  :global(.rendered a)  {
    color: var(--color-secondary);
    text-decoration: none;
  }
  :global(.rendered a:hover) { text-decoration: underline; }
  :global(.rendered code) {
    background: var(--color-overlay-bg, var(--color-background));
    color: var(--color-accent);
    padding: 0.05rem 0.3rem;
    border-radius: 3px;
    font-size: 0.92em;
  }
  :global(.rendered pre) {
    background: var(--color-overlay-bg, var(--color-background));
    padding: 0.9rem;
    overflow-x: auto;
    border-radius: 4px;
    border: 1px solid var(--color-border, var(--color-muted));
  }
  :global(.rendered pre code) {
    background: transparent;
    color: var(--color-text);
    padding: 0;
  }
  :global(.rendered blockquote) {
    border-left: 3px solid var(--color-secondary);
    padding-left: 0.8rem;
    color: var(--color-text-dim, var(--color-muted));
    margin: 0.8rem 0;
  }
  :global(.rendered img),
  :global(.rendered iframe),
  :global(.rendered video) {
    max-width: 100%;
    border-radius: 4px;
  }
  :global(.rendered table) {
    border-collapse: collapse;
    margin: 0.8rem 0;
  }
  :global(.rendered th),
  :global(.rendered td) {
    border: 1px solid var(--color-border, var(--color-muted));
    padding: 0.3rem 0.6rem;
  }
  :global(.rendered hr) {
    border: none;
    border-top: 1px solid var(--color-separator, var(--color-border));
    margin: 1.2rem 0;
  }

  .placeholder,
  .error {
    padding: 1.5rem;
    color: var(--color-text-dim, var(--color-muted));
    text-align: center;
  }
  .error {
    color: var(--color-error);
  }

  kbd {
    background: var(--color-selected-bg, var(--color-overlay-bg));
    border: 1px solid var(--color-border, var(--color-muted));
    border-radius: 3px;
    padding: 0.05rem 0.35rem;
    font-family: inherit;
    font-size: 0.78rem;
    color: var(--color-secondary);
  }

  .link-button {
    background: transparent;
    border: none;
    color: var(--color-secondary);
    font-family: inherit;
    font-size: 0.85rem;
    cursor: pointer;
    padding: 0 0.4rem;
  }
  .link-button:hover { text-decoration: underline; }
  .link-button.danger { color: var(--color-error); }
  .banner {
    margin: 0.4rem;
    padding: 0.45rem 0.6rem;
    border: 1px solid var(--color-primary);
    border-radius: 6px;
    font-size: 0.78rem;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }

  .topbar-right {
    justify-self: end;
    display: flex;
    gap: 0.4rem;
  }

  .rendered-actions {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 0.7rem;
  }

  .editor-frame {
    max-width: 720px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    height: 100%;
  }
  .editor-bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.8rem;
    flex-wrap: wrap;
  }
  .editor-meta {
    display: flex;
    gap: 0.6rem;
    align-items: center;
    flex-wrap: wrap;
  }
  .editor-title {
    color: var(--color-text-dim, var(--color-muted));
    font-size: 0.9rem;
  }
  .conn-pill {
    font-size: 0.72rem;
    padding: 0.1rem 0.5rem;
    border-radius: 999px;
    border: 1px solid var(--color-border, var(--color-muted));
    color: var(--color-text-dim, var(--color-muted));
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .conn-connected { color: var(--color-info, var(--color-secondary)); border-color: currentColor; }
  .conn-connecting { color: var(--color-warning, var(--color-secondary)); border-color: currentColor; }
  .conn-disconnected { color: var(--color-error); border-color: currentColor; }
  .peers {
    display: flex;
    gap: 0.3rem;
    flex-wrap: wrap;
  }
  .peer-chip {
    font-size: 0.72rem;
    padding: 0.05rem 0.45rem;
    border-radius: 999px;
    border: 1px solid var(--peer-color, var(--color-border));
    color: var(--peer-color, var(--color-text));
    background: transparent;
  }
  .editor-actions {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }
  .hint {
    color: var(--color-text-dim, var(--color-muted));
    font-size: 0.78rem;
  }

  .primary-button {
    padding: 0.4rem 0.8rem;
    background: var(--color-primary);
    border: none;
    border-radius: 4px;
    color: var(--color-background);
    font-family: inherit;
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
  }
  .primary-button.danger {
    background: var(--color-error);
  }
  .primary-button:disabled { opacity: 0.5; cursor: progress; }

  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
  }
  .modal-panel {
    background: var(--color-background);
    border: 1px solid var(--color-border, var(--color-muted));
    border-radius: 6px;
    padding: 1.25rem;
    min-width: 320px;
    max-width: 90%;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    outline: none;
  }
  .modal-form {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  .modal-panel h2 {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
    color: var(--color-text);
  }
  .modal-body {
    color: var(--color-text-dim, var(--color-muted));
    font-size: 0.88rem;
    margin: 0;
  }
  .modal-actions {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    margin-top: 0.4rem;
  }
  .login-input {
    padding: 0.5rem 0.7rem;
    background: var(--color-overlay-bg, var(--color-background));
    border: 1px solid var(--color-border, var(--color-muted));
    border-radius: 4px;
    color: var(--color-text);
    font-family: inherit;
    font-size: 0.95rem;
    outline: none;
  }
  .login-input:focus { border-color: var(--color-secondary); }
</style>
