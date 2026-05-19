<script lang="ts">
  import { onMount } from 'svelte';
  import { auth } from '../lib/auth.svelte.ts';
  import { vaults } from '../lib/vaults.svelte.ts';
  import { uiState } from '../lib/uistate.svelte.ts';
  import type { Vault } from '../lib/types.ts';
  import VaultCreateModal from '../components/VaultCreateModal.svelte';

  let showCreate = $state(false);

  // Keyboard navigation cursor (vim-style j/k + Enter).
  let cursor = $state(0);

  onMount(() => {
    // Fire the (async) initial load but return synchronously so the
    // cleanup closure type matches onMount's expected signature.
    void vaults.load();
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  });

  function handleKey(e: KeyboardEvent): void {
    if (e.target && (e.target as HTMLElement).tagName === 'INPUT') return;
    const list = vaults.list;
    if (e.key === 'j' || e.key === 'ArrowDown') {
      e.preventDefault();
      if (cursor < list.length - 1) cursor++;
    } else if (e.key === 'k' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (cursor > 0) cursor--;
    } else if (e.key === 'Enter' || e.key === 'l') {
      e.preventDefault();
      if (list[cursor]) vaults.select(list[cursor].id);
    } else if (e.key === 'g') {
      e.preventDefault();
      cursor = 0;
    } else if (e.key === 'G') {
      e.preventDefault();
      cursor = Math.max(0, list.length - 1);
    } else if (e.key === 'r') {
      e.preventDefault();
      vaults.load();
    }
  }

  function pick(v: Vault): void {
    vaults.select(v.id);
  }

  async function signOut(): Promise<void> {
    await auth.signOut();
    vaults.clear();
  }

  function fmtDate(s: string): string {
    return s.replace('T', ' ').slice(0, 16);
  }
</script>

<div class="vaults-view">
  <header class="topbar">
    <div class="brand">lumi</div>
    <div class="who">
      <span class="user">{auth.user?.display_name ?? auth.user?.username}</span>
      <button class="link-button" onclick={() => uiState.openThemePicker()} type="button">Theme</button>
      <button class="link-button" onclick={signOut} type="button">Sign out</button>
    </div>
  </header>

  <main class="content">
    <div class="title-row">
      <h1>Your vaults</h1>
      <div class="title-actions">
        <button class="link-button" onclick={() => (showCreate = true)} type="button">+ New vault</button>
        <button class="link-button" onclick={() => vaults.load()} type="button">Refresh</button>
      </div>
    </div>

    {#if vaults.loading}
      <div class="placeholder">Loading…</div>
    {:else if vaults.lastError}
      <div class="error">{vaults.lastError}</div>
    {:else if vaults.list.length === 0}
      <div class="placeholder">
        No vaults yet. Use an invite link to join one, or have a server admin create one for you.
      </div>
    {:else}
      <ul class="vault-list" role="listbox">
        {#each vaults.list as v, i (v.id)}
          <li
            class="vault-row"
            class:active={cursor === i}
            role="option"
            aria-selected={cursor === i}
            tabindex="0"
            onclick={() => pick(v)}
            onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(v); } }}
            onmouseenter={() => (cursor = i)}
          >
            <div class="vault-main">
              <span class="vault-name">{v.name}</span>
              <span class="vault-slug">{v.slug}</span>
            </div>
            <div class="vault-meta">created {fmtDate(v.created_at)}</div>
          </li>
        {/each}
      </ul>
      <div class="hint">
        <kbd>j</kbd>/<kbd>k</kbd> move &middot; <kbd>Enter</kbd> open &middot; <kbd>r</kbd> refresh
      </div>
    {/if}
  </main>
</div>

{#if showCreate}
  <VaultCreateModal
    onclose={() => (showCreate = false)}
    onCreated={(id) => vaults.select(id)}
  />
{/if}

<style>
  .vaults-view {
    min-height: 100vh;
    background: var(--color-background);
    color: var(--color-text);
    display: flex;
    flex-direction: column;
  }

  .topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.75rem 1.25rem;
    border-bottom: 1px solid var(--color-separator, var(--color-border));
  }

  .brand {
    font-weight: 700;
    color: var(--color-primary);
    letter-spacing: 0.02em;
  }

  .who {
    display: flex;
    gap: 0.75rem;
    align-items: center;
    color: var(--color-text-dim, var(--color-muted));
    font-size: 0.85rem;
  }

  .user {
    color: var(--color-text);
  }

  .content {
    max-width: 720px;
    width: 100%;
    margin: 0 auto;
    padding: 1.5rem 1.25rem;
    box-sizing: border-box;
    flex: 1;
  }

  .title-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    margin-bottom: 1rem;
  }

  .title-row h1 {
    margin: 0;
    font-size: 1.25rem;
    color: var(--color-text);
    font-weight: 600;
  }
  .title-actions {
    display: flex;
    gap: 0.6rem;
    align-items: center;
  }

  .placeholder,
  .error {
    padding: 2rem;
    text-align: center;
    color: var(--color-text-dim, var(--color-muted));
    border: 1px dashed var(--color-border, var(--color-muted));
    border-radius: 6px;
  }
  .error {
    color: var(--color-error);
    border-color: var(--color-error);
  }

  .vault-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .vault-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.7rem 0.9rem;
    background: var(--color-overlay-bg, var(--color-background));
    border: 1px solid var(--color-border, var(--color-muted));
    border-radius: 6px;
    cursor: pointer;
    transition: border-color 80ms ease;
  }

  .vault-row.active {
    border-color: var(--color-primary);
    background: var(--color-selected-bg, var(--color-overlay-bg));
  }

  .vault-main {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }

  .vault-name {
    color: var(--color-text);
    font-weight: 600;
  }

  .vault-slug {
    color: var(--color-text-dim, var(--color-muted));
    font-size: 0.8rem;
  }

  .vault-meta {
    color: var(--color-text-dim, var(--color-muted));
    font-size: 0.78rem;
  }

  .hint {
    margin-top: 1.25rem;
    color: var(--color-text-dim, var(--color-muted));
    font-size: 0.8rem;
    text-align: center;
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
    padding: 0;
  }
  .link-button:hover {
    text-decoration: underline;
  }
</style>
