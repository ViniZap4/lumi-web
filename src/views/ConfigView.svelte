<script>
  import { store } from '../lib/store.svelte.js';
  import CommandBar from '../components/CommandBar.svelte';

  const configCommands = [
    { key: 'j/k', desc: 'move' },
    { key: 'h/l', desc: 'change' },
    { key: 'esc', desc: 'back' },
  ];

  let configItems = $derived(store.buildConfigItems());
</script>

<div class="config-view">
  <!-- Left: Settings -->
  <div class="config-left">
    <div class="config-title">Lumi Settings</div>

    <div class="config-items">
      {#each configItems as item, i}
        {#if item.kind === 'header'}
          <div class="config-header" class:first={i === 0}>{item.label}</div>
        {:else if item.kind === 'cycle'}
          <div class="config-row" class:active={i === store.configCursor}>
            <span class="config-label">{item.label}</span>
            <span class="config-value">&lt; {item.value} &gt;</span>
          </div>
        {/if}
      {/each}
    </div>

    <!-- Color swatches -->
    <div class="config-swatches">
      <span class="swatch" style="color: var(--color-primary)">██</span>
      <span class="swatch" style="color: var(--color-secondary)">██</span>
      <span class="swatch" style="color: var(--color-accent)">██</span>
      <span class="swatch" style="color: var(--color-muted)">██</span>
      <span class="swatch" style="color: var(--color-text)">██</span>
      <span class="swatch" style="color: var(--color-error)">██</span>
      <span class="swatch" style="color: var(--color-warning)">██</span>
      <span class="swatch" style="color: var(--color-info)">██</span>
    </div>

    <CommandBar items={configCommands} />
  </div>

  <!-- Separator -->
  <div class="config-sep">
    {#each Array(60) as _}
      <div class="sep-char">│</div>
    {/each}
  </div>

  <!-- Right: Preview -->
  <div class="config-right">
    <!-- Preview header -->
    <div class="preview-header-row">
      <span class="preview-h-title">Sample Note</span>
      <span class="preview-h-tag">#demo</span>
      <span class="preview-h-tag">#theme</span>
      <span class="preview-h-date">Jan 1, 2026</span>
    </div>
    <div class="sep"></div>

    <!-- Sample markdown -->
    <div class="config-preview-md">
      {@html store.renderMarkdown(store.sampleMarkdown)}
    </div>

    <!-- Footer -->
    <div class="config-preview-footer">
      <div class="sep"></div>
      <div class="note-status-bar">
        <span>Ln 1  Col 1</span>
      </div>
    </div>
  </div>
</div>

<style>
  .sep {
    height: 1px;
    background: var(--color-separator);
    width: 100%;
  }

  .config-view {
    display: flex;
    height: 100vh;
    width: 100vw;
    background: var(--color-background);
    color: var(--color-text);
  }

  .config-left {
    width: 38%;
    display: flex;
    flex-direction: column;
    padding: 1.5rem;
  }

  .config-title {
    text-align: center;
    font-weight: 700;
    color: var(--color-primary);
    font-size: 1.1rem;
    margin-bottom: 1.5rem;
  }

  .config-items {
    flex: 1;
  }

  .config-header {
    font-weight: 700;
    color: var(--color-primary);
    padding: 0.25rem 0.5rem;
    margin-top: 1rem;
  }
  .config-header.first {
    margin-top: 0;
  }

  .config-row {
    display: flex;
    justify-content: space-between;
    padding: 0.4rem 1.5rem;
  }

  .config-row .config-label {
    color: var(--color-text);
  }

  .config-row .config-value {
    color: var(--color-muted);
  }

  .config-row.active {
    background: var(--color-selected-bg);
  }

  .config-row.active .config-label {
    color: var(--color-accent);
  }

  .config-row.active .config-value {
    color: var(--color-secondary);
    font-weight: 700;
  }

  .config-swatches {
    text-align: center;
    padding: 1rem 0;
    display: flex;
    gap: 0.5rem;
    justify-content: center;
    font-size: 0.9rem;
  }

  .config-sep {
    display: flex;
    flex-direction: column;
    color: var(--color-separator);
    font-size: 0.85rem;
    line-height: 1;
    padding: 0;
    user-select: none;
  }

  .sep-char {
    text-align: center;
    height: calc(100vh / 60);
  }

  .config-right {
    flex: 1;
    display: flex;
    flex-direction: column;
    padding: 1.5rem;
    overflow: hidden;
  }

  .preview-header-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding-bottom: 0.5rem;
  }

  .preview-h-title {
    font-weight: 700;
    color: var(--color-primary);
    font-size: 1.05rem;
  }

  .preview-h-tag {
    color: var(--color-accent);
    font-size: 0.85rem;
  }

  .preview-h-date {
    color: var(--color-muted);
    font-size: 0.85rem;
    margin-left: auto;
  }

  .config-preview-md {
    flex: 1;
    padding: 0.75rem 0;
    overflow-y: auto;
    line-height: 1.6;
    font-size: 0.9rem;
  }

  .config-preview-footer {
    margin-top: auto;
  }

  .note-status-bar {
    padding: 0.5rem 1.5rem;
    background: var(--color-selected-bg);
    color: var(--color-primary);
    font-size: 0.85rem;
  }
</style>
