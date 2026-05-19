<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { auth } from './lib/auth.svelte.ts';
  import { vaults } from './lib/vaults.svelte.ts';
  import { theme } from './lib/theme.svelte.ts';
  import { uiState } from './lib/uistate.svelte.ts';

  import LoginView from './views/LoginView.svelte';
  import VaultsView from './views/VaultsView.svelte';
  import VaultHomeView from './views/VaultHomeView.svelte';
  import ThemePickerModal from './components/ThemePickerModal.svelte';

  onMount(async () => {
    theme.init();
    await auth.restore();
  });

  onDestroy(() => {
    theme.destroy();
  });

  // Three routes for slice 4.1:
  //   - not authenticated → LoginView
  //   - authenticated, no vault selected → VaultsView
  //   - authenticated, vault selected → VaultHomeView placeholder
  let route = $derived<'login' | 'vaults' | 'vault'>(
    !auth.authenticated ? 'login' : vaults.selectedID == null ? 'vaults' : 'vault',
  );
</script>

{#if auth.initialising}
  <div class="boot">…</div>
{:else if route === 'login'}
  <LoginView />
{:else if route === 'vaults'}
  <VaultsView />
{:else}
  <VaultHomeView />
{/if}

{#if uiState.themePickerOpen}
  <ThemePickerModal />
{/if}

<style>
  :global(:root) {
    color-scheme: dark;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    background: var(--color-background);
    color: var(--color-text);
  }

  :global(body) {
    margin: 0;
    background: var(--color-background);
  }

  .boot {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--color-background);
    color: var(--color-text-dim, var(--color-muted));
  }
</style>
