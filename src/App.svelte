<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { auth } from './lib/auth.svelte.ts';
  import { books } from './lib/books.svelte.ts';
  import { theme } from './lib/theme.svelte.ts';
  import { uiState } from './lib/uistate.svelte.ts';
  import { boot } from './lib/session.ts';

  import VaultHomeView from './views/VaultHomeView.svelte';
  import { lazyComponent } from './views/vault/lazy.svelte.ts';
  // Only the book shell is in the boot chunk: sign-in, the books list,
  // settings and the theme picker load when first shown.
  const LoginView = lazyComponent(() => import('./views/LoginView.svelte'));
  const VaultsView = lazyComponent(() => import('./views/VaultsView.svelte'));
  const SettingsView = lazyComponent(() => import('./views/SettingsView.svelte'));
  const ThemePickerModal = lazyComponent(() => import('./components/ThemePickerModal.svelte'));
  import OfflineRescueBanner from './components/OfflineRescueBanner.svelte';
  import { editorSettings } from './lib/editor-settings.svelte.ts';
  import { setMotionLevel } from './lib/motion.ts';
  import { installAmbient } from './lib/ambient.ts';
  import { parseDeepLink, resolveBook } from './lib/deeplink.ts';
  import { vaults } from './lib/vaults.svelte.ts';

  // Settings → Reduce motion (on top of prefers-reduced-motion).
  $effect(() => setMotionLevel(editorSettings.value.motion));
  // Settings → reading width + density: one attribute each on <html>;
  // app.css maps them to --md-measure and the row-height tokens.
  $effect(() => {
    const root = document.documentElement;
    root.dataset.measure = editorSettings.value.readingWidth;
    root.dataset.density = editorSettings.value.density;
  });

  let offAmbient: (() => void) | null = null;
  onMount(async () => {
    theme.init();
    offAmbient = installAmbient();
    await boot();
    followDeepLink();
    window.addEventListener('hashchange', followDeepLink);
  });

  onDestroy(() => {
    offAmbient?.();
    theme.destroy();
    window.removeEventListener('hashchange', followDeepLink);
  });

  // Deep links (SPEC-PARTE2 §8): #/b/<vault>[/n/<note-id> | /p/<path>].
  // Only books already on this device open; nothing is ever added.
  let lastHash = '';
  function followDeepLink(): void {
    const hash = window.location.hash;
    if (hash === lastHash) return;
    lastHash = hash;
    const link = parseDeepLink(hash);
    if (!link || !auth.authenticated) return;
    const book = resolveBook(link, books.list, (b) => vaults.list.find((v) => v.id === b.vault_id)?.slug);
    if (!book) {
      uiState.notice = 'That link points to a book that is not on this device.';
      setTimeout(() => (uiState.notice = null), 6000);
      return;
    }
    if (link.note || link.path) uiState.pendingNote = { vault: book.vault_id, note: link.note, path: link.path };
    books.setActive(book.id);
  }

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

{#if auth.initialising || (route === 'login' && !LoginView.current) || (route === 'vaults' && !VaultsView.current)}
  <div class="boot"><span class="ui-wordmark"><span class="mark"></span>lumi</span></div>
{:else if route === 'login' && LoginView.current}
  <LoginView.current />
{:else if route === 'vaults' && VaultsView.current}
  <VaultsView.current />
{:else}
  <VaultHomeView />
{/if}

{#if uiState.accountModal && route !== 'login' && LoginView.current}
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
      <LoginView.current
        embedded
        presetServer={uiState.accountModal.server}
        presetUsername={uiState.accountModal.username}
        ondone={() => uiState.closeAccountModal()}
        oncancel={() => uiState.closeAccountModal()}
      />
    </div>
  </div>
{/if}

{#if uiState.settings && route !== 'login' && SettingsView.current}
  <SettingsView.current />
{/if}

{#if uiState.themePickerOpen && ThemePickerModal.current}
  <ThemePickerModal.current />
{/if}

<OfflineRescueBanner />

{#if uiState.notice}
  <div class="app-notice" role="status">{uiState.notice}</div>
{/if}

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

  .app-notice {
    position: fixed;
    left: 50%;
    bottom: calc(var(--bar-h) + var(--sp-4));
    transform: translateX(-50%);
    z-index: 400;
    max-width: min(520px, calc(100vw - 32px));
    padding: var(--sp-2) var(--sp-4);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    background: var(--color-background);
    box-shadow: var(--shadow-pop);
    font-size: var(--text-sm);
    animation: ui-rise 160ms var(--ease);
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
