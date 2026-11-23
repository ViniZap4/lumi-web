<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { auth } from './lib/auth.svelte.ts';
  import { books } from './lib/books.svelte.ts';
  import { theme } from './lib/theme.svelte.ts';
  import { uiState } from './lib/uistate.svelte.ts';
  import { boot } from './lib/session.ts';

  import LoginView from './views/LoginView.svelte';
  import VaultsView from './views/VaultsView.svelte';
  import VaultHomeView from './views/VaultHomeView.svelte';
  import ThemePickerModal from './components/ThemePickerModal.svelte';
  // Settings is a full view loaded on first open (keeps the boot chunk lean).
  type SettingsViewT = typeof import('./views/SettingsView.svelte').default;
  let SettingsView = $state<SettingsViewT | null>(null);
  $effect(() => {
    if (uiState.settings && !SettingsView) {
      void import('./views/SettingsView.svelte').then((m) => (SettingsView = m.default));
    }
  });
  import OfflineRescueBanner from './components/OfflineRescueBanner.svelte';
  import { editorSettings } from './lib/editor-settings.svelte.ts';
  import { setReduceMotion } from './lib/motion.ts';
  import { installSettingsShortcut } from './lib/settings-shortcut.ts';

  // Settings → Reduce motion (on top of prefers-reduced-motion).
  $effect(() => setReduceMotion(editorSettings.value.reduceMotion));

  let uninstallShortcut: (() => void) | null = null;
  onMount(async () => {
    theme.init();
    // ⌘, / Ctrl+, from anywhere (capture phase: beats CodeMirror/vim
    // and modal handlers).
    uninstallShortcut = installSettingsShortcut(window, {
      toggle: () => uiState.toggleSettings(),
      enabled: () => route !== 'login',
    });
    await boot();
  });

  onDestroy(() => {
    theme.destroy();
    uninstallShortcut?.();
  });

  // Routes (SPEC-LIVROS §5):
  //   - no account on this device → LoginView (with the server field)
  //   - selector open, or no active book → books selector (VaultsView)
  //   - otherwise → the active book (VaultHomeView); the active book is
  //     remembered per device and reopened on boot.
  let route = $derived<'login' | 'vaults' | 'vault'>(
    !auth.authenticated ? 'login' : books.pickerOpen || books.active == null ? 'vaults' : 'vault',
  );

  function onAccountModalKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') uiState.closeAccountModal();
  }
</script>

{#if auth.initialising}
  <div class="boot"><span class="ui-wordmark"><span class="mark"></span>lumi</span></div>
{:else if route === 'login'}
  <LoginView />
{:else if route === 'vaults'}
  <VaultsView />
{:else}
  <VaultHomeView />
{/if}

{#if uiState.accountModal && route !== 'login'}
  <div class="modal-overlay" role="presentation" onclick={() => uiState.closeAccountModal()} onkeydown={onAccountModalKey}>
    <div
      class="modal-panel"
      role="dialog"
      aria-modal="true"
      aria-label={uiState.accountModal.username ? 'Entrar' : 'Adicionar servidor'}
      tabindex="-1"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => { if (e.key === 'Escape') uiState.closeAccountModal(); e.stopPropagation(); }}
    >
      <LoginView
        embedded
        presetServer={uiState.accountModal.server}
        presetUsername={uiState.accountModal.username}
        ondone={() => uiState.closeAccountModal()}
        oncancel={() => uiState.closeAccountModal()}
      />
    </div>
  </div>
{/if}

{#if uiState.settings && route !== 'login' && SettingsView}
  <SettingsView />
{/if}

{#if uiState.themePickerOpen}
  <ThemePickerModal />
{/if}

<OfflineRescueBanner />

<style>
  :global(body) {
    margin: 0;
    background: var(--color-background);
  }

  .modal-overlay {
    position: fixed;
    inset: 0;
    background: color-mix(in srgb, var(--color-overlay-bg) 55%, rgba(0, 0, 0, 0.45));
    backdrop-filter: blur(2px);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--sp-4);
    z-index: 200;
  }
  .modal-panel {
    background: var(--color-background);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-pop);
    width: min(420px, 100%);
    max-height: 92vh;
    overflow: auto;
    outline: none;
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
