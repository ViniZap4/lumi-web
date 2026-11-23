<script lang="ts">
  // Books selector, full screen (SPEC-LIVROS §5): what "← Livros"
  // opens. Same j/k/Enter navigation as before; rows grouped by server
  // with their sync dot; accounts section with "Entrar" / "Sair deste
  // aparelho"; first-time explanation and empty states.
  import { onMount } from 'svelte';
  import { books } from '../lib/books.svelte.ts';
  import { sync } from '../lib/sync.svelte.ts';
  import { accounts } from '../lib/accounts.svelte.ts';
  import { vaults } from '../lib/vaults.svelte.ts';
  import { uiState } from '../lib/uistate.svelte.ts';
  import { serverLabel } from '../lib/serverurl.ts';
  import { selectorOrder } from '../lib/books-model.ts';
  import { GChord, isEditableTarget } from '../lib/shortcuts.ts';
  import VaultCreateModal from '../components/VaultCreateModal.svelte';
  import FederationJoinModal from '../components/FederationJoinModal.svelte';
  import SyncDot from '../components/SyncDot.svelte';
  import { offline, bundleMarkdown, downloadText, exportFilename } from '../lib/offline.svelte.ts';
  import type { Account } from '../lib/accounts.svelte.ts';
  import type { RescuedText } from '../lib/offline-store.ts';

  let showJoinFederated = $state(false);

  // "Sair deste aparelho" wipes the account's offline replicas, list
  // caches and conflict copies (LGPD). Unsent text is offered for
  // export first; nothing leaves silently.
  let signOutAsk = $state<{ account: Account; items: RescuedText[] } | null>(null);
  let signingOut = $state(false);

  async function requestSignOut(a: Account): Promise<void> {
    let items: RescuedText[] = [];
    try {
      if (a.user_id) items = await offline.pendingForAccount(a);
    } catch {
      items = [];
    }
    if (items.length === 0) {
      await accounts.signOut(a.key);
      return;
    }
    signOutAsk = { account: a, items };
  }

  async function confirmSignOut(download: boolean): Promise<void> {
    const ask = signOutAsk;
    if (!ask || signingOut) return;
    signingOut = true;
    try {
      if (download) downloadText(exportFilename(ask.items), bundleMarkdown(ask.items));
      await accounts.signOut(ask.account.key);
      signOutAsk = null;
    } finally {
      signingOut = false;
    }
  }

  // Joining a federation materialises a local replica vault — refresh
  // the list so it appears, then jump straight into it.
  async function onFederatedJoin(vaultID: string): Promise<void> {
    await vaults.load();
    vaults.select(vaultID);
  }

  const order = $derived(selectorOrder(books.list));
  // Keyboard navigation cursor (vim-style j/k + Enter).
  let cursor = $state(0);
  const chord = new GChord();

  onMount(() => {
    cursor = Math.max(0, order.findIndex((b) => b.id === books.activeID));
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  });

  function handleKey(e: KeyboardEvent): void {
    if (e.defaultPrevented || isEditableTarget(e.target)) return;
    if (uiState.accountModal || uiState.createBookOpen || showJoinFederated) return;
    const c = chord.feed(e);
    if (c) {
      e.preventDefault();
      if (c.kind === 'book') books.openShortcut(c.n);
      else if (c.kind === 'top') cursor = 0;
      return;
    }
    const n = order.length;
    if (e.key === 'j' || e.key === 'ArrowDown') {
      e.preventDefault();
      if (cursor < n - 1) cursor++;
    } else if (e.key === 'k' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (cursor > 0) cursor--;
    } else if (e.key === 'Enter' || e.key === 'l') {
      e.preventDefault();
      if (order[cursor]) books.setActive(order[cursor].id);
    } else if (e.key === 'G') {
      e.preventDefault();
      cursor = Math.max(0, n - 1);
    } else if (e.key === 'r') {
      e.preventDefault();
      void books.refreshAll();
    } else if (e.key === 'Escape' && books.active) {
      e.preventDefault();
      books.closePicker();
    }
  }
</script>

<div class="vaults-view">
  <header class="topbar">
    <div class="brand">lumi</div>
    <div class="who">
      {#if books.active}
        <button class="link-button" onclick={() => books.closePicker()} type="button">voltar para {books.active.name}</button>
      {/if}
      <button class="link-button" onclick={() => uiState.openThemePicker()} type="button">Theme</button>
    </div>
  </header>

  <main class="content">
    {#each books.banners as b (b.id)}
      <div class="banner" role="status">
        <span>{b.text}</span>
        <span class="banner-actions">
          {#if b.kind === 'dedupe'}
            <button class="link-button" type="button" onclick={() => books.dismissBanner(b.id)}>Manter</button>
            <button
              class="link-button"
              type="button"
              onclick={() => {
                const bk = b.vault_id ? books.bookForVault(b.vault_id) : null;
                books.dismissBanner(b.id);
                if (bk) books.setActive(bk.id);
              }}
            >Trocar servidor…</button>
          {:else}
            <button class="link-button" type="button" aria-label="Fechar aviso" onclick={() => books.dismissBanner(b.id)}>ok</button>
          {/if}
        </span>
      </div>
    {/each}

    {#if !books.onboardingSeen}
      <div class="onboarding" data-testid="onboarding">
        <p>
          Cada livro é um espaço separado de notas. Ele pode ficar só neste aparelho ou ligado a um
          servidor, e cada livro ligado sincroniza com um único servidor.
        </p>
        <button class="link-button" type="button" onclick={() => books.dismissOnboarding()}>entendi</button>
      </div>
    {/if}

    <div class="title-row">
      <h1>Livros</h1>
      <div class="title-actions">
        <button class="link-button" onclick={() => (uiState.createBookOpen = true)} type="button">Novo livro…</button>
        <button class="link-button" onclick={() => uiState.openAddServer()} type="button">Adicionar servidor…</button>
        <button class="link-button" onclick={() => (showJoinFederated = true)} type="button">Join federated vault</button>
        <button class="link-button" onclick={() => sync.retryAll()} type="button">Refresh</button>
      </div>
    </div>

    {#if books.lastError}
      <div class="error small">{books.lastError}</div>
    {/if}

    {#if order.length === 0}
      {#if books.loading}
        <div class="placeholder">Loading…</div>
      {:else}
        <div class="placeholder" data-testid="empty-books">
          <p>Nenhum livro ainda</p>
          <button class="link-button" type="button" onclick={() => (uiState.createBookOpen = true)}>Novo livro</button>
          ·
          <button class="link-button" type="button" onclick={() => uiState.openAddServer()}>Adicionar servidor</button>
        </div>
      {/if}
    {:else}
      {#each books.groups as g (g.server_url)}
        <h2 class="group">{serverLabel(g.server_url)}</h2>
        <ul class="vault-list" role="listbox" aria-label={`Livros em ${serverLabel(g.server_url)}`}>
          {#each g.books as b (b.id)}
            {@const i = order.findIndex((x) => x.id === b.id)}
            {@const st = sync.statusOf(b)}
            <li
              class="vault-row"
              class:active={cursor === i}
              role="option"
              aria-selected={b.id === books.activeID}
              tabindex="0"
              onclick={() => books.setActive(b.id)}
              onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); books.setActive(b.id); } }}
              onmouseenter={() => (cursor = i)}
            >
              <div class="vault-main">
                <span class="vault-name"><SyncDot state={st.state} pending={st.pending} /> {b.name}</span>
                <span class="vault-slug">{b.account}{st.reason ? ` · ${st.reason}` : ''}</span>
              </div>
              <div class="vault-meta">
                {#if books.revoked[b.id]}
                  <button class="link-button" type="button" onclick={(e) => { e.stopPropagation(); books.removeFromList(b.id); }}>Remover da lista</button>
                {:else if st.state === 'needs_login'}
                  <button class="link-button" type="button" onclick={(e) => { e.stopPropagation(); uiState.openSignIn(b.server_url, b.account); }}>Entrar</button>
                {/if}
                {#if i < 9}<kbd>g{i + 1}</kbd>{/if}
              </div>
            </li>
          {/each}
        </ul>
      {/each}
      <div class="hint">
        <kbd>j</kbd>/<kbd>k</kbd> move &middot; <kbd>Enter</kbd> open &middot; <kbd>g1</kbd>–<kbd>g9</kbd> livro &middot; <kbd>r</kbd> refresh
      </div>
    {/if}

    <h2 class="group accounts-title">contas neste aparelho</h2>
    <ul class="accounts">
      {#each accounts.list as a (a.key)}
        <li class="account-row">
          <span>
            {a.display_name || a.username} <span class="vault-slug">{a.username} @ {serverLabel(a.server_url)}{a.remember ? '' : ' · só nesta aba'}</span>
          </span>
          <span class="banner-actions">
            {#if a.status === 'needs_login'}
              <span class="needs">precisa entrar</span>
              <button class="link-button" type="button" onclick={() => uiState.openSignIn(a.server_url, a.username)}>Entrar</button>
            {/if}
            <button class="link-button" type="button" onclick={() => void requestSignOut(a)}>Sair deste aparelho</button>
          </span>
        </li>
      {/each}
    </ul>
  </main>
</div>

{#if uiState.createBookOpen}
  <VaultCreateModal
    onclose={() => (uiState.createBookOpen = false)}
    onCreated={(id) => vaults.select(id)}
  />
{/if}

{#if signOutAsk}
  <div class="modal-overlay" role="presentation" onclick={() => (signOutAsk = null)} onkeydown={(e) => { if (e.key === 'Escape') signOutAsk = null; }}>
    <div class="modal-panel" role="dialog" aria-modal="true" tabindex="-1" aria-label="Alterações não enviadas"
      data-testid="signout-pending"
      onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()}>
      <h2>Alterações ainda não enviadas</h2>
      <p class="modal-body">
        {signOutAsk.items.length} {signOutAsk.items.length === 1 ? 'nota tem' : 'notas têm'} texto que não chegou a
        {serverLabel(signOutAsk.account.server_url)}. Sair apaga deste navegador as cópias offline, as listas guardadas
        e as cópias em conflito desta conta.
      </p>
      <ul class="pending-list">
        {#each signOutAsk.items as it (it.vaultID + '/' + it.noteID)}
          <li>{it.title || it.noteID}</li>
        {/each}
      </ul>
      <div class="modal-actions">
        <button class="primary-button" type="button" disabled={signingOut} onclick={() => void confirmSignOut(true)}>Baixar e sair</button>
        <button class="link-button danger" type="button" disabled={signingOut} onclick={() => void confirmSignOut(false)}>Sair sem baixar</button>
        <button class="link-button" type="button" onclick={() => (signOutAsk = null)}>Cancelar</button>
      </div>
    </div>
  </div>
{/if}

{#if showJoinFederated}
  <FederationJoinModal
    onclose={() => (showJoinFederated = false)}
    onJoined={(id) => void onFederatedJoin(id)}
  />
{/if}

<style>
  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 200;
  }
  .modal-panel {
    background: var(--color-background);
    border: 1px solid var(--color-border, var(--color-muted));
    border-radius: 6px;
    max-width: min(32rem, 92vw);
    padding: 1rem 1.25rem;
    outline: none;
  }
  .modal-panel h2 { margin: 0 0 0.5rem; font-size: 1rem; }
  .modal-body { font-size: 0.85rem; color: var(--color-text-dim, var(--color-muted)); }
  .pending-list { font-size: 0.85rem; max-height: 10rem; overflow: auto; }
  .modal-actions { display: flex; gap: 0.5rem; flex-wrap: wrap; justify-content: flex-end; }
  .link-button.danger { color: var(--color-error); }
  .primary-button {
    padding: 0.4rem 0.8rem;
    background: var(--color-primary);
    border: none;
    border-radius: 4px;
    color: var(--color-background);
    font-family: inherit;
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
  }
  .primary-button:disabled { opacity: 0.5; cursor: progress; }
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
  .banner, .onboarding {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
    padding: 0.6rem 0.8rem;
    margin-bottom: 0.75rem;
    border: 1px solid var(--color-primary);
    border-radius: 6px;
    font-size: 0.85rem;
  }
  .onboarding p { margin: 0; }
  .banner-actions {
    display: inline-flex;
    gap: 0.6rem;
    align-items: center;
    white-space: nowrap;
  }
  .group {
    font-size: 0.78rem;
    font-weight: 400;
    color: var(--color-text-dim, var(--color-muted));
    margin: 1rem 0 0.4rem;
    text-transform: lowercase;
  }
  .accounts-title { margin-top: 2rem; }
  .accounts {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    font-size: 0.85rem;
  }
  .account-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
  }
  .needs { color: var(--color-warning, var(--color-secondary)); font-size: 0.78rem; }
  .error.small { padding: 0.5rem; margin-bottom: 0.5rem; font-size: 0.82rem; }
  .vault-meta { display: inline-flex; gap: 0.6rem; align-items: center; }
  .title-actions { flex-wrap: wrap; justify-content: flex-end; }
</style>
