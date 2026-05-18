<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { vaults } from '../lib/vaults.svelte.ts';
  import { notes } from '../lib/notes.svelte.ts';
  import { auth } from '../lib/auth.svelte.ts';
  import { renderMarkdown } from '../lib/markdown.ts';
  import { ApiError } from '../lib/types.ts';
  import * as api from '../lib/api.ts';
  import { EditorSession } from '../lib/editor-session.svelte.ts';
  import NoteEditor from '../components/NoteEditor.svelte';

  // Vim-style list cursor. Tracks position even when selectedID is null.
  let cursor = $state(0);

  // Slice 4.3 — modals.
  type Modal = null | 'new-note' | 'delete-confirm';
  let modal = $state<Modal>(null);
  let modalErr = $state<string | null>(null);
  let newNoteTitle = $state('');

  // Slice 4.4 — Yjs+CM6 editor session. EditorSession owns the Y.Doc
  // and provider; reactive `status` + `peers` flow into the bar.
  let editMode = $state(false);
  let editSession = $state<EditorSession | null>(null);
  let editError = $state<string | null>(null);
  let saving = $state(false);

  let lastDelete = $state(0); // 'dd' double-tap timestamp

  // Reset edit state whenever the focused note changes.
  $effect(() => {
    const id = notes.selectedID;
    if (editMode) cancelEdit();
    editError = null;
    void id; // intentional dep
  });

  // Hydrate notes whenever the active vault changes. The notes store
  // is idempotent on a no-op vaultID transition so this is safe.
  $effect(() => {
    const vid = vaults.selectedID;
    void notes.openVault(vid);
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
    // Drop the per-vault cache so the next vault load starts clean.
    void notes.openVault(null);
  });

  function back(): void {
    vaults.select(null);
  }

  let lastG = $state(0);
  function handleKey(e: KeyboardEvent): void {
    const target = e.target as HTMLElement | null;

    // Cmd/Ctrl+S to save edits, regardless of focus inside the editor.
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

    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;

    if (e.key === 'Escape') {
      e.preventDefault();
      if (editMode) {
        cancelEdit();
      } else if (notes.selectedID) {
        void notes.select(null);
      } else {
        back();
      }
      return;
    }
    if (e.key === 'h' && !editMode) {
      e.preventDefault();
      if (notes.selectedID) void notes.select(null);
      else back();
      return;
    }
    if (editMode) return; // remaining shortcuts are list-mode only

    // New note: 'n' on list pane.
    if (e.key === 'n') {
      e.preventDefault();
      openNewNote();
      return;
    }
    // Enter edit on the focused note: 'e'.
    if (e.key === 'e' && notes.selectedID) {
      e.preventDefault();
      enterEdit();
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
    } else if (e.key === 'g') {
      e.preventDefault();
      const now = Date.now();
      if (now - lastG < 500) {
        cursor = 0;
        lastG = 0;
      } else {
        lastG = now;
      }
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

  function enterEdit(): void {
    if (!notes.content || !auth.user || !vaults.selectedID || !notes.selectedID) return;
    const token = api.getToken();
    if (!token) return;
    const sess = new EditorSession();
    // Seed the Y.Text with the current FS body BEFORE wiring the
    // provider — if there's no peer yet, this becomes the initial
    // doc state; if a peer is already editing, the WS provider's
    // first SyncStep2 will reconcile on connect. Either way the user
    // sees their saved content immediately, not a flash of blank.
    if ((notes.content.body ?? '') !== '' && sess.ytext.length === 0) {
      sess.ytext.insert(0, notes.content.body ?? '');
    }
    sess.open(vaults.selectedID, notes.selectedID, token, auth.user);
    editSession = sess;
    editMode = true;
    editError = null;
  }

  function cancelEdit(): void {
    if (editSession) {
      editSession.destroy();
      editSession = null;
    }
    editMode = false;
    editError = null;
  }

  /**
   * Cmd/Ctrl+S commits the current Yjs text to the on-disk markdown
   * file via the REST /diff endpoint. The Yjs WS path already keeps
   * the CRDT log in sync across web peers in real time, but the
   * server's WS handler does NOT yet mirror updates back to the FS
   * markdown — so without this explicit POST, the apple-client / TUI
   * (which read FS, not the CRDT log) wouldn't see web edits.
   *
   * Known follow-up: a server slice should debounce-write the CRDT
   * text to FS on idle, which would let us drop this explicit save.
   */
  async function saveEdit(): Promise<void> {
    if (saving || !editSession || !vaults.selectedID || !notes.selectedID) return;
    saving = true;
    editError = null;
    try {
      const text = editSession.ytext.toString();
      const snap = await api.applyNoteDiff(vaults.selectedID, notes.selectedID, text);
      // Refresh the metadata row so updated_at moves; preview will
      // re-render once we exit edit mode (or stay in if user wants).
      void notes.refresh();
      // We do NOT exit edit mode here — saving feels modeless.
      void snap;
    } catch (e) {
      editError = e instanceof ApiError ? (e.detail ?? e.code) : (e as Error).message;
    } finally {
      saving = false;
    }
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
    <button class="link-button" onclick={back} type="button">← Vaults</button>
    <div class="title">
      <span class="vault-name">{vaults.selected?.name}</span>
      <span class="vault-slug">{vaults.selected?.slug}</span>
    </div>
    <div class="topbar-right">
      <button class="link-button" onclick={openNewNote} type="button">+ New</button>
      <button class="link-button" onclick={() => void notes.refresh()} type="button">Refresh</button>
    </div>
  </header>

  <div class="split">
    <aside class="note-list" aria-label="Notes">
      {#if notes.loadingList}
        <div class="placeholder">Loading…</div>
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
        {#if editMode && editSession}
          <div class="editor-frame">
            <div class="editor-bar">
              <div class="editor-meta">
                <span class="editor-title">Editing {notes.selected?.title}</span>
                <span class="conn-pill conn-{editSession.status}">{editSession.status}</span>
                {#if editSession.peers.length > 0}
                  <span class="peers">
                    {#each editSession.peers as p (p.clientID)}
                      <span class="peer-chip" style="--peer-color: {p.color}" title={p.name}>{p.name}</span>
                    {/each}
                  </span>
                {/if}
              </div>
              <div class="editor-actions">
                <button class="primary-button" onclick={saveEdit} disabled={saving} type="button">
                  {saving ? 'Saving…' : 'Save to disk'}
                </button>
                <button class="link-button" onclick={cancelEdit} type="button">Done</button>
              </div>
            </div>
            {#if editError}<div class="error">{editError}</div>{/if}
            <NoteEditor session={editSession} />
            <div class="hint">
              Edits sync live to other web peers via Yjs.
              <kbd>Cmd/Ctrl</kbd>+<kbd>S</kbd> commits the current text to the on-disk file
              for TUI / apple clients. <kbd>Esc</kbd> closes the editor.
            </div>
          </div>
        {:else}
          <article class="rendered">
            <h1 class="rendered-title">{notes.selected?.title}</h1>
            <div class="rendered-actions">
              <button class="link-button" onclick={enterEdit} type="button">Edit</button>
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
