<script lang="ts">
  import { onMount, onDestroy, untrack } from 'svelte';
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

  // Vim-style list cursor. Tracks position even when selectedID is null.
  let cursor = $state(0);

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

  // Clamp cursor when the list shrinks (e.g. refresh).
  $effect(() => {
    if (cursor >= notes.list.length) cursor = Math.max(0, notes.list.length - 1);
  });

  onMount(() => {
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  });

  onDestroy(() => {
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
  const chord = new GChord();

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
      else if (c.kind === 'top') cursor = 0;
      return;
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      if (notes.selectedID) {
        void notes.select(null);
      } else {
        back();
      }
      return;
    }
    if (e.key === 'h') {
      e.preventDefault();
      if (notes.selectedID) void notes.select(null);
      else back();
      return;
    }
    // New note: 'n' on list pane.
    if (e.key === 'n') {
      e.preventDefault();
      openNewNote();
      return;
    }
    // Enter edit on the focused note: 'e'.
    if (e.key === 'e' && notes.selectedID) {
      e.preventDefault();
      void enterEdit();
      return;
    }
    // Delete focused: 'dd' double-tap.
    if (e.key === 'd' && notes.selectedID) {
      e.preventDefault();
      const now = Date.now();
      if (now - lastDelete < 500) {
        modal = 'delete-confirm';
        lastDelete = 0;
      } else {
        lastDelete = now;
      }
      return;
    }

    if (notes.list.length === 0) return;

    if (e.key === 'j' || e.key === 'ArrowDown') {
      e.preventDefault();
      if (cursor < notes.list.length - 1) cursor++;
    } else if (e.key === 'k' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (cursor > 0) cursor--;
    } else if (e.key === 'Enter' || e.key === 'l') {
      e.preventDefault();
      const n = notes.list[cursor];
      if (n) void notes.select(n.id);
    } else if (e.key === 'G') {
      e.preventDefault();
      cursor = notes.list.length - 1;
    } else if (e.key === 'r') {
      e.preventDefault();
      void notes.refresh();
    }
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
    try {
      await notes.create({ title: t, body: '' });
      closeModal();
    } catch (e) {
      modalErr = e instanceof ApiError ? (e.detail ?? e.code) : (e as Error).message;
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

  <div class="split">
    <aside class="note-list" aria-label="Notes">
      <BookSwitcher />
      {#each books.banners as b (b.id)}
        <div class="banner" role="status">
          {b.text}
          <button class="link-button" type="button" onclick={() => books.dismissBanner(b.id)}>{b.kind === 'dedupe' ? 'Manter' : 'ok'}</button>
        </div>
      {/each}
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
      {:else if notes.loadingList}
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
        <div class="placeholder">No notes yet.</div>
      {:else}
        <ul role="listbox">
          {#each notes.list as n, i (n.id)}
            <li
              class="note-row"
              class:active={cursor === i}
              class:selected={notes.selectedID === n.id}
              role="option"
              aria-selected={notes.selectedID === n.id}
              tabindex="0"
              onclick={() => { cursor = i; void notes.select(n.id); }}
              onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); cursor = i; void notes.select(n.id); } }}
              onmouseenter={() => (cursor = i)}
            >
              <span class="note-title">{n.title}</span>
              <span class="note-meta">{fmtDate(n.updated_at)}</span>
            </li>
          {/each}
        </ul>
      {/if}
    </aside>

    <main class="preview">
      {#if !notes.selectedID}
        <div class="placeholder">
          Pick a note to read. <kbd>j</kbd>/<kbd>k</kbd> move, <kbd>Enter</kbd> opens,
          <kbd>h</kbd>/<kbd>Esc</kbd> back, <kbd>r</kbd> refresh.
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
    min-height: 100vh;
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

  .split {
    display: grid;
    grid-template-columns: minmax(220px, 320px) 1fr;
    flex: 1;
    min-height: 0;
  }

  .note-list {
    border-right: 1px solid var(--color-separator, var(--color-border));
    overflow-y: auto;
    padding: 0.5rem;
  }

  .note-list ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }

  .note-row {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    padding: 0.5rem 0.7rem;
    border-radius: 4px;
    cursor: pointer;
    border: 1px solid transparent;
  }

  .note-row.active {
    background: var(--color-selected-bg, var(--color-overlay-bg));
  }
  .note-row.selected {
    border-color: var(--color-primary);
  }

  .note-title {
    color: var(--color-text);
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .note-meta {
    color: var(--color-text-dim, var(--color-muted));
    font-size: 0.7rem;
  }

  .preview {
    overflow-y: auto;
    padding: 1.5rem 2rem;
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
