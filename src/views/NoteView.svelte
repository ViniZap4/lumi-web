<script>
  import { tick } from 'svelte';
  import { store } from '../lib/store.svelte.js';
  import CommandBar from '../components/CommandBar.svelte';

  const readCommands = [
    { key: 'jk', desc: 'scroll' },
    { key: 'e', desc: 'edit' },
    { key: 'd', desc: 'delete' },
    { key: 'c', desc: 'config' },
    { key: 'h', desc: 'home' },
    { key: 'esc', desc: 'back' },
  ];

  let editorContainer = $state(null);

  // Editor lifecycle: replaces afterUpdate with $effect
  $effect(() => {
    // Track reactive dependencies
    const editMode = store.editMode;
    const hasEditor = store.editorView;
    const container = editorContainer;

    // Need to wait for DOM updates before checking container
    tick().then(() => {
      // Clean up stale editor (container removed from DOM)
      if (store.editorView && (!editorContainer || !document.contains(editorContainer))) {
        store.cleanupEditor();
      }
      // Create editor when entering edit mode
      if (store.editMode && editorContainer && !store.editorView) {
        store.setupEditor(editorContainer);
      }
      // Destroy editor when leaving edit mode
      if (!store.editMode && store.editorView) {
        store.cleanupEditor();
      }
    });
  });
</script>

{#if store.selectedNote}
  {#if store.editMode}
    <div class="note-split" class:no-preview={!store.showPreview}>
      <div class="note-editor-pane">
        <div class="note-bar">
          <input
            bind:value={store.title}
            placeholder="Title"
            class="title-input"
          />
          <div class="note-actions">
            <button onclick={store.save} disabled={store.saving}>
              {store.saving ? 'Saving...' : 'Save'}
            </button>
            <button onclick={() => store.editMode = false}>View (esc)</button>
          </div>
        </div>
        <div class="editor-body" bind:this={editorContainer}></div>
        <div class="status-bar-editor">
          {#if store.vimMode}
            <span class="vim-mode" class:insert={store.vimMode === 'INSERT'} class:visual={store.vimMode === 'VISUAL' || store.vimMode === 'V-LINE' || store.vimMode === 'V-BLOCK'}>{store.vimMode}</span>
          {/if}
          <span class="cursor-pos">Ln {store.cursorLine} Col {store.cursorCol}</span>
          <span class="editor-hints">
            {#if store.vimMode}
              <span class="key-hint">:w</span> save
              <span class="key-hint">:q</span> quit
              <span class="key-hint">esc</span> normal
            {:else}
              <span class="key-hint">ctrl+s</span> save
              <span class="key-hint">esc</span> close
            {/if}
          </span>
        </div>
      </div>

      {#if store.showPreview}
        <div class="note-preview-pane">
          <div class="note-bar">
            <span class="bar-label">Live Preview</span>
          </div>
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <div class="preview-md-body" onclick={store.handleNoteClick} role="presentation">
            {@html store.renderMarkdown(store.content || '')}
          </div>
        </div>
      {/if}
    </div>
  {:else}
    <div class="note-full">
      <!-- Header bar -->
      <div class="note-header-bar">
        <span class="note-title-text">{store.title || 'Untitled'}</span>
        {#if store.selectedNote.tags?.length}
          {#each store.selectedNote.tags as tag}
            <span class="note-tag">#{tag}</span>
          {/each}
        {/if}
        <span class="note-date">{store.formatDate(store.selectedNote.updated_at || store.selectedNote.created_at)}</span>
      </div>
      <div class="sep"></div>

      <!-- Content -->
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <div class="note-view-content" onclick={store.handleNoteClick} role="presentation">
        {@html store.renderMarkdown(store.content || '')}
      </div>

      <!-- Footer -->
      <div class="sep"></div>
      <div class="note-status-bar">
        <span>View</span>
      </div>
      <CommandBar items={readCommands} />
    </div>
  {/if}
{/if}

<style>
  .sep {
    height: 1px;
    background: var(--color-separator);
    width: 100%;
  }

  .key-hint {
    color: var(--color-secondary);
    font-weight: 700;
  }

  /* ── Note View — Full ────────────────────────────────────────── */
  .note-full {
    display: flex;
    flex-direction: column;
    height: 100vh;
    width: 100vw;
    background: var(--color-background);
    color: var(--color-text);
  }

  .note-header-bar {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 1rem 1.5rem;
    flex-wrap: wrap;
  }

  .note-title-text {
    font-weight: 700;
    font-size: 1.15rem;
    color: var(--color-primary);
  }

  .note-tag {
    color: var(--color-accent);
    font-size: 0.85rem;
  }

  .note-date {
    color: var(--color-muted);
    font-size: 0.85rem;
    margin-left: auto;
  }

  .note-view-content {
    flex: 1;
    padding: 1.5rem;
    overflow-y: auto;
    line-height: 1.7;
    scroll-behavior: smooth;
  }

  .note-status-bar {
    padding: 0.5rem 1.5rem;
    background: var(--color-selected-bg);
    color: var(--color-primary);
    font-size: 0.85rem;
  }

  /* ── Note View — Split (Edit) ────────────────────────────────── */
  .note-split {
    display: grid;
    grid-template-columns: 1fr 1fr;
    height: 100vh;
    width: 100vw;
    background: var(--color-background);
    color: var(--color-text);
  }

  .note-split.no-preview {
    grid-template-columns: 1fr;
  }

  .note-editor-pane {
    display: flex;
    flex-direction: column;
    border-right: 1px solid var(--color-separator);
  }

  .note-preview-pane {
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .note-bar {
    display: flex;
    gap: 0.75rem;
    padding: 1rem 1.25rem;
    border-bottom: 1px solid var(--color-separator);
    align-items: center;
  }

  .bar-label {
    color: var(--color-muted);
    font-size: 0.85rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .title-input {
    flex: 1;
    padding: 0.5rem 0.75rem;
    background: var(--color-overlay-bg);
    border: 1px solid var(--color-border);
    border-radius: 3px;
    color: var(--color-text);
    font-size: 1.05rem;
    font-weight: 600;
    font-family: inherit;
  }

  .title-input:focus {
    outline: none;
    border-color: var(--color-primary);
  }

  .note-actions {
    display: flex;
    gap: 0.5rem;
  }

  button {
    padding: 0.5rem 1rem;
    background: var(--color-selected-bg);
    color: var(--color-text);
    border: 1px solid var(--color-border);
    border-radius: 3px;
    font-weight: 600;
    cursor: pointer;
    font-size: 0.85rem;
    font-family: inherit;
  }

  button:hover:not(:disabled) {
    border-color: var(--color-primary);
    color: var(--color-primary);
  }

  button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .editor-body {
    flex: 1;
    overflow: hidden;
  }

  .editor-body :global(.cm-editor) {
    height: 100%;
  }

  .editor-body :global(.cm-scroller) {
    overflow: auto;
  }

  .editor-body :global(.cm-focused) {
    outline: none;
  }

  .status-bar-editor {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 0.5rem 1.25rem;
    background: var(--color-selected-bg);
    font-size: 0.85rem;
    border-top: 1px solid var(--color-separator);
  }

  .vim-mode {
    font-weight: 700;
    color: var(--color-primary);
  }

  .vim-mode.insert {
    color: var(--color-warning);
  }

  .vim-mode.visual {
    color: var(--color-accent);
  }

  .cursor-pos {
    color: var(--color-muted);
  }

  .editor-hints {
    margin-left: auto;
    color: var(--color-muted);
    display: flex;
    gap: 0.75rem;
  }

  .preview-md-body {
    flex: 1;
    padding: 1.25rem;
    overflow-y: auto;
    line-height: 1.7;
    font-size: 0.95rem;
  }
</style>
