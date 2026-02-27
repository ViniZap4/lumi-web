<script>
  import { store } from '../lib/store.svelte.js';
</script>

{#if store.cmdModal}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="modal-overlay" onclick={() => { store.cmdModal = null; store.cmdInputValue = ''; }}>
    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
    <div class="cmd-modal" onclick={(e) => e.stopPropagation()}>
      <div class="modal-title">{store.cmdModal.title}</div>

      {#if store.cmdModal.kind === 'input'}
        <div class="search-input-box">
          <!-- svelte-ignore a11y_autofocus -->
          <input
            type="text"
            bind:value={store.cmdInputValue}
            onkeydown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); store.submitCmd(); }
            }}
            placeholder={store.cmdModal.placeholder}
            autofocus
          />
        </div>
      {:else if store.cmdModal.kind === 'confirm'}
        <div class="confirm-message">{store.cmdModal.message}</div>
      {:else if store.cmdModal.kind === 'select'}
        <div class="select-list">
          {#each store.cmdModal.items as item, i}
            <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
            <div
              class="result-item"
              class:active={i === store.cmdSelectCursor}
              onclick={() => { const fn = store.cmdModal.onSubmit; const v = item.value; store.cmdModal = null; fn(v); }}
            >
              <span class="tree-name">{item.label}</span>
            </div>
          {/each}
        </div>
      {/if}

      <div class="status-help">
        {#if store.cmdModal.kind === 'input'}
          <span class="key-hint">enter</span> confirm
          <span class="key-hint">esc</span> cancel
        {:else if store.cmdModal.kind === 'confirm'}
          <span class="key-hint">y/enter</span> confirm
          <span class="key-hint">n/esc</span> cancel
        {:else if store.cmdModal.kind === 'select'}
          <span class="key-hint">j/k</span> navigate
          <span class="key-hint">enter</span> select
          <span class="key-hint">esc</span> cancel
        {/if}
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

  .cmd-modal {
    width: 90%;
    max-width: 450px;
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

  .confirm-message {
    color: var(--color-text);
    font-size: 0.95rem;
    padding: 0.5rem 0;
  }

  .select-list {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    max-height: 300px;
    overflow-y: auto;
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
