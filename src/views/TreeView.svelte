<script>
  import { store } from '../lib/store.svelte.js';
  import CommandBar from '../components/CommandBar.svelte';

  let lastPreviewInput = $state('');
  let lastPreviewHtml = $state('');

  const treeCommands = [
    { key: 'hjkl', desc: 'move' },
    { key: 'enter', desc: 'open' },
    { key: 'h', desc: 'back' },
    { key: 'n', desc: 'new note' },
    { key: 'N', desc: 'new folder' },
    { key: 'r', desc: 'rename' },
    { key: 'd', desc: 'delete' },
    { key: 'm', desc: 'move' },
    { key: 'y', desc: 'copy note' },
    { key: '/', desc: 'search' },
  ];

  // Compute parent-level folders for the parent column
  let parentFolders = $derived.by(() => {
    if (store.currentDir === '/') return [];
    const parts = store.currentDir.slice(1).split('/');
    parts.pop();
    if (parts.length === 0) {
      // Parent is root: show top-level folders
      return store.allFolders.filter(f => !f.path.includes('/'));
    }
    // Parent is a subfolder: show its direct children
    const parentPath = parts.join('/');
    return store.allFolders.filter(f => {
      if (!f.path.startsWith(parentPath + '/')) return false;
      const rest = f.path.slice(parentPath.length + 1);
      return !rest.includes('/');
    });
  });

  let currentItem = $derived(store.displayItems[store.cursor]);
  let previewNote = $derived(currentItem?.type === 'note' ? currentItem.data : null);

  // Load folder preview when cursor moves to a folder
  $effect(() => {
    const item = store.displayItems[store.cursor];
    if (item?.type === 'folder') {
      store.loadFolderPreview(item.path || item.name);
    } else {
      store.folderPreviewNotes = [];
    }
  });

  // Memoize renderMarkdown for preview
  function getPreviewHtml(note) {
    if (!note) return '';
    const input = note.content?.split('\n').slice(0, 20).join('\n') || '';
    if (input === lastPreviewInput) return lastPreviewHtml;
    lastPreviewInput = input;
    lastPreviewHtml = store.renderMarkdown(input);
    return lastPreviewHtml;
  }
</script>

<div class="tree-view">
  <!-- Parent Column -->
  <div class="tree-col parent-col">
    <div class="col-header">Parent</div>
    <div class="col-body">
      {#if store.currentDir === '/'}
        <div class="parent-item">~</div>
      {:else}
        {#each parentFolders as f}
          <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
          <div
            class="tree-item folder-item"
            class:parent-active={'/' + (f.path || f.name) === store.currentDir}
            onclick={() => store.enterFolder(f)}
          >
            <span class="tree-icon">/</span>
            <span class="tree-name">{f.name}</span>
          </div>
        {/each}
      {/if}
    </div>
  </div>

  <!-- Center Column -->
  <div class="tree-col center-col">
    <div class="col-header col-header-primary">{store.currentDir}</div>
    <div class="col-body">
      {#each store.displayItems as item, i}
        <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
        <div
          class="tree-item"
          class:active={i === store.cursor}
          class:folder-item={item.type === 'folder'}
          onclick={() => { store.cursor = i; if (item.type === 'note') store.openNote(item); else if (item.type === 'folder') store.enterFolder(item); }}
        >
          <span class="tree-icon">{item.type === 'folder' ? '/' : ' '}</span>
          <span class="tree-name">{item.name}</span>
        </div>
      {/each}
      {#if store.displayItems.length === 0}
        <div class="empty-msg">Empty</div>
      {/if}
    </div>
    <CommandBar items={treeCommands} />
  </div>

  <!-- Preview Column -->
    <div class="tree-col preview-col">
      <div class="col-header">Preview</div>
      <div class="col-body preview-body">
        {#if previewNote}
          <div class="preview-title">{previewNote.title || previewNote.id}</div>
          <div class="sep"></div>
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <div class="preview-md" onclick={store.handleNoteClick} role="presentation">
            {@html getPreviewHtml(previewNote)}
          </div>
        {:else if currentItem?.type === 'folder'}
          <div class="preview-title">{currentItem.name}/</div>
          <div class="sep"></div>
          <div class="folder-preview-list">
            {#if store.folderPreviewNotes.length > 0}
              {#each store.folderPreviewNotes.slice(0, 12) as note}
                <div class="folder-preview-item">{note.title || note.id}</div>
              {/each}
              {#if store.folderPreviewNotes.length > 12}
                <div class="folder-preview-more">+{store.folderPreviewNotes.length - 12} more</div>
              {/if}
            {:else}
              <div class="empty-msg">Empty folder</div>
            {/if}
          </div>
        {:else}
          <div class="empty-msg">Select a note to preview</div>
        {/if}
      </div>
    </div>
</div>

<style>
  .tree-view {
    display: grid;
    grid-template-columns: 1fr 1.3fr 1.7fr;
    height: 100vh;
    width: 100vw;
    background: var(--color-background);
    color: var(--color-text);
  }

  .tree-col {
    display: flex;
    flex-direction: column;
    border-right: 1px solid var(--color-separator);
    overflow: hidden;
  }

  .preview-col {
    border-right: none;
  }

  .col-header {
    padding: 1rem 1.25rem;
    border-bottom: 1px solid var(--color-separator);
    font-weight: 600;
    font-size: 0.85rem;
    color: var(--color-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .col-header-primary {
    color: var(--color-primary);
    text-transform: none;
    font-size: 0.95rem;
  }

  .col-body {
    flex: 1;
    overflow-y: auto;
    padding: 0.5rem;
  }

  .parent-item {
    padding: 0.5rem 0.75rem;
    color: var(--color-muted);
  }

  .tree-item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
    cursor: pointer;
  }

  .tree-item:hover {
    background: var(--color-selected-bg);
  }

  .tree-item.active {
    background: var(--color-selected-bg);
    color: var(--color-accent);
  }

  .tree-item.folder-item {
    color: var(--color-secondary);
  }

  .tree-item.folder-item .tree-icon {
    color: inherit;
  }

  .tree-item.parent-active {
    background: var(--color-selected-bg);
    color: var(--color-accent);
  }

  .tree-item.parent-active .tree-icon {
    color: inherit;
  }

  .tree-icon {
    color: var(--color-muted);
    width: 1ch;
    flex-shrink: 0;
  }

  .tree-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .preview-body {
    padding: 1rem 1.25rem;
  }

  .folder-preview-list {
    padding: 0.5rem 0;
  }

  .folder-preview-item {
    padding: 0.3rem 0;
    color: var(--color-text);
    font-size: 0.9rem;
  }

  .folder-preview-more {
    padding: 0.3rem 0;
    color: var(--color-muted);
    font-size: 0.85rem;
    font-style: italic;
  }

  .preview-title {
    font-size: 1.1rem;
    font-weight: 600;
    color: var(--color-primary);
    margin-bottom: 0.75rem;
  }

  .sep {
    height: 1px;
    background: var(--color-separator);
    width: 100%;
  }

  .preview-md {
    color: var(--color-text);
    line-height: 1.6;
    font-size: 0.9rem;
  }

  .empty-msg {
    padding: 2rem;
    text-align: center;
    color: var(--color-muted);
    font-style: italic;
  }
</style>
