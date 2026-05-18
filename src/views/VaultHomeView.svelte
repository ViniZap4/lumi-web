<script lang="ts">
  import { vaults } from '../lib/vaults.svelte.ts';

  function back(): void {
    vaults.select(null);
  }
</script>

<div class="vault-home">
  <header class="topbar">
    <button class="link-button" onclick={back} type="button">← All vaults</button>
    <div class="title">
      <span class="vault-name">{vaults.selected?.name}</span>
      <span class="vault-slug">{vaults.selected?.slug}</span>
    </div>
    <div></div>
  </header>
  <main class="placeholder">
    Notes UI lands in slice 4.2 — list, read, create, edit. For now, this view confirms
    that auth + vault selection are wired end-to-end.
  </main>
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
    padding: 0.75rem 1.25rem;
    border-bottom: 1px solid var(--color-separator, var(--color-border));
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
    font-size: 0.75rem;
    color: var(--color-text-dim, var(--color-muted));
  }
  .placeholder {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
    color: var(--color-text-dim, var(--color-muted));
    padding: 2rem;
    max-width: 520px;
    margin: 0 auto;
  }
  .link-button {
    background: transparent;
    border: none;
    color: var(--color-secondary);
    font-family: inherit;
    font-size: 0.9rem;
    cursor: pointer;
    padding: 0;
    justify-self: start;
  }
</style>
