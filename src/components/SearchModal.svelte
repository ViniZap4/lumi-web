<script>
  import { store } from '../lib/store.svelte.js';
  import { debounce } from '../lib/debounce.js';

  const debouncedSearch = debounce(() => store.performSearch(), 150);

  function handleInput() {
    debouncedSearch();
  }
</script>

{#if store.showSearch}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="modal-overlay" onclick={() => { store.showSearch = false; }}>
    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
    <div class="search-modal" onclick={(e) => e.stopPropagation()}>
      <div class="modal-title">Find Notes</div>

      <div class="search-input-box">
        <!-- svelte-ignore a11y_autofocus -->
        <input
          type="text"
          bind:value={store.searchQuery}
          oninput={handleInput}
          placeholder={`[${store.searchType === 'filename' ? 'Filename' : 'Content'}] Type to search...`}
          autofocus
        />
      </div>

      <div class="search-content">
        <div class="search-results">
          <div class="results-header">Results ({store.searchResults.length})</div>
          {#each store.searchResults.slice(0, 10) as result, i}
            <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
            <div
              class="result-item"
              class:active={i === store.searchCursor}
              onclick={() => { store.searchCursor = i; store.openNote(result); store.showSearch = false; }}
            >
              <span class="tree-name">{result.name}</span>
            </div>
          {/each}
          {#if store.searchResults.length === 0}
            <div class="empty-msg">No results</div>
          {/if}
        </div>

        <div class="search-preview">
          {#if store.searchResults[store.searchCursor]?.data}
            <div class="preview-title">{store.searchResults[store.searchCursor].name}</div>
            <div class="sep"></div>
            <div class="preview-md">
              {@html store.renderMarkdown(store.searchResults[store.searchCursor].data.content?.split('\n').slice(0, 10).join('\n') || '')}
            </div>
          {:else}
            <div class="empty-msg">No preview available</div>
          {/if}
        </div>
      </div>

      <div class="status-help">
        <span class="key-hint">ctrl+j/k</span> navigate
        <span class="key-hint">enter</span> open
        <span class="key-hint">esc</span> close
      </div>
    </div>
  </div>
{/if}

<style>
  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }

  .search-modal {
    width: 90%;
    max-width: 850px;
    max-height: 80vh;
    background: var(--color-overlay-bg);
    border: 1px solid var(--color-border);
    border-radius: 4px;
    padding: 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .modal-title {
    font-size: 1.1rem;
    font-weight: 700;
    color: var(--color-primary);
  }

  .search-input-box input {
    width: 100%;
    padding: 0.6rem 0.75rem;
    background: var(--color-background);
    border: 1px solid var(--color-border);
    border-radius: 3px;
    color: var(--color-text);
    font-size: 0.95rem;
    font-family: inherit;
  }

  .search-input-box input:focus {
    outline: none;
    border-color: var(--color-primary);
  }

  .search-content {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1rem;
    flex: 1;
    min-height: 300px;
  }

  .search-results {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    overflow-y: auto;
  }

  .results-header {
    font-size: 0.8rem;
    color: var(--color-muted);
    margin-bottom: 0.5rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .result-item {
    display: flex;
    align-items: center;
    padding: 0.4rem 0.75rem;
    cursor: pointer;
  }

  .result-item:hover {
    background: var(--color-selected-bg);
  }

  .result-item.active {
    background: var(--color-selected-bg);
    color: var(--color-accent);
  }

  .tree-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .search-preview {
    padding: 1rem;
    background: var(--color-background);
    border: 1px solid var(--color-separator);
    border-radius: 3px;
    overflow-y: auto;
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

  .status-help {
    padding: 0.75rem 1.5rem;
    border-top: 1px solid var(--color-separator);
    font-size: 0.85rem;
    color: var(--color-muted);
    text-align: center;
    display: flex;
    gap: 1rem;
    justify-content: center;
  }

  .key-hint {
    color: var(--color-secondary);
    font-weight: 700;
  }
</style>
