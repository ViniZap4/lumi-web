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
  import CommandLegend from '../components/CommandLegend.svelte';
  import { legendFor } from '../lib/legend.ts';
  import { editorSettings } from '../lib/editor-settings.svelte.ts';
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
    if (uiState.accountModal || uiState.createBookOpen || showJoinFederated || uiState.settings || signOutAsk) return;
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
    } else if (e.key === 'r' || e.key === 'R') {
      e.preventDefault();
      void books.refreshAll();
    } else if (e.key === ',' && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      uiState.openSettings('appearance');
    } else if (e.key === 'Escape' && books.active) {
      e.preventDefault();
      books.closePicker();
    }
  }
</script>

<div class="vaults-view">
  <header class="topbar">
    <span class="ui-wordmark"><span class="mark"></span>lumi</span>
    <div class="top-actions">
      {#if books.active}
        <button class="ui-btn ghost sm" onclick={() => books.closePicker()} type="button">← {books.active.name}</button>
      {/if}
      <button class="ui-btn ghost sm icon" onclick={() => uiState.openThemePicker()} type="button" title="Theme" aria-label="Theme">
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M8 2a6 6 0 0 1 0 12z" fill="currentColor"/></svg>
      </button>
      <button class="ui-btn ghost sm icon" onclick={() => uiState.openSettings('appearance')} type="button" title="Settings (,)" aria-label="Settings">
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M2 4.5h7M12 4.5h2M2 11.5h2M7 11.5h7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><circle cx="10.5" cy="4.5" r="1.6" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="5.5" cy="11.5" r="1.6" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>
      </button>
    </div>
  </header>

  <main class="content">
    {#each books.banners as b (b.id)}
      <div class="banner" role="status">
        <span>{b.text}</span>
        <span class="banner-actions">
          {#if b.kind === 'dedupe'}
            <button class="ui-link" type="button" onclick={() => books.dismissBanner(b.id)}>Manter</button>
            <button
              class="ui-link"
              type="button"
              onclick={() => {
                const bk = b.vault_id ? books.bookForVault(b.vault_id) : null;
                books.dismissBanner(b.id);
                if (bk) books.setActive(bk.id);
              }}
            >Trocar servidor…</button>
          {:else}
            <button class="ui-link" type="button" aria-label="Fechar aviso" onclick={() => books.dismissBanner(b.id)}>ok</button>
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
        <button class="ui-btn sm" type="button" onclick={() => books.dismissOnboarding()}>entendi</button>
      </div>
    {/if}

    <div class="title-row">
      <h1>Livros</h1>
      <div class="title-actions">
        <button class="ui-btn primary sm" onclick={() => (uiState.createBookOpen = true)} type="button">Novo livro</button>
        <button class="ui-btn sm" onclick={() => uiState.openAddServer()} type="button">Adicionar servidor</button>
        <button class="ui-btn ghost sm" onclick={() => (showJoinFederated = true)} type="button">Join federated vault</button>
        <button class="ui-btn ghost sm icon" onclick={() => sync.retryAll()} type="button" title="Refresh (R)" aria-label="Refresh">
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M13 8a5 5 0 1 1-1.5-3.6M13 2.5v3h-3" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
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
          <p class="empty-title">Nenhum livro ainda</p>
          <p class="empty-sub">Crie um livro neste aparelho ou conecte um servidor lumi.</p>
          <div class="empty-actions">
            <button class="ui-btn primary sm" type="button" onclick={() => (uiState.createBookOpen = true)}>Novo livro</button>
            <button class="ui-btn sm" type="button" onclick={() => uiState.openAddServer()}>Adicionar servidor</button>
          </div>
        </div>
      {/if}
    {:else}
      {#each books.groups as g (g.server_url)}
        <h2 class="ui-eyebrow group">{serverLabel(g.server_url)}</h2>
        <ul class="vault-list" role="listbox" aria-label={`Livros em ${serverLabel(g.server_url)}`}>
          {#each g.books as b (b.id)}
            {@const i = order.findIndex((x) => x.id === b.id)}
            {@const st = sync.statusOf(b)}
            <li
              class="vault-row"
              class:active={cursor === i}
              class:current={b.id === books.activeID}
              role="option"
              aria-selected={b.id === books.activeID}
              tabindex="0"
              onclick={() => books.setActive(b.id)}
              onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); books.setActive(b.id); } }}
              onmouseenter={() => (cursor = i)}
            >
              <span class="glyph" aria-hidden="true">{b.name.slice(0, 1).toUpperCase()}</span>
              <div class="vault-main">
                <span class="vault-name">{b.name} <SyncDot state={st.state} pending={st.pending} /></span>
                <span class="vault-slug">{b.account}{st.reason ? ` · ${st.reason}` : ''}</span>
              </div>
              <div class="vault-meta">
                {#if books.revoked[b.id]}
                  <button class="ui-btn sm" type="button" onclick={(e) => { e.stopPropagation(); books.removeFromList(b.id); }}>Remover da lista</button>
                {:else if st.state === 'needs_login'}
                  <button class="ui-btn sm" type="button" onclick={(e) => { e.stopPropagation(); uiState.openSignIn(b.server_url, b.account); }}>Entrar</button>
                {/if}
                {#if i < 9}<kbd>g{i + 1}</kbd>{/if}
              </div>
            </li>
          {/each}
        </ul>
      {/each}
    {/if}

    <h2 class="ui-eyebrow group accounts-title">contas neste aparelho</h2>
    <ul class="accounts">
      {#each accounts.list as a (a.key)}
        <li class="account-row">
          <span class="avatar" aria-hidden="true">{(a.display_name || a.username).slice(0, 1).toUpperCase()}</span>
          <span class="account-main">
            <span class="account-name">{a.display_name || a.username}</span>
            <span class="vault-slug">{a.username} @ {serverLabel(a.server_url)}{a.remember ? '' : ' · só nesta aba'}</span>
          </span>
          <span class="banner-actions">
            {#if a.status === 'needs_login'}
              <span class="needs">precisa entrar</span>
              <button class="ui-btn sm" type="button" onclick={() => uiState.openSignIn(a.server_url, a.username)}>Entrar</button>
            {/if}
            <button class="ui-btn ghost sm" type="button" onclick={() => void requestSignOut(a)}>Sair deste aparelho</button>
          </span>
        </li>
      {/each}
    </ul>
  </main>
  {#if editorSettings.value.legend}
    <CommandLegend items={legendFor('books')} mode="books" />
  {/if}
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
        <button class="ui-btn ghost" type="button" onclick={() => (signOutAsk = null)}>Cancelar</button>
        <button class="ui-btn danger" type="button" disabled={signingOut} onclick={() => void confirmSignOut(false)}>Sair sem baixar</button>
        <button class="ui-btn primary" type="button" disabled={signingOut} onclick={() => void confirmSignOut(true)}>Baixar e sair</button>
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
    width: min(30rem, 100%);
    padding: var(--sp-5);
    outline: none;
    display: flex;
    flex-direction: column;
    gap: var(--sp-3);
  }
  .modal-panel h2 { font-size: var(--text-lg); font-weight: 600; }
  .modal-body { font-size: var(--text-sm); color: var(--color-text-dim); }
  .pending-list { font-size: var(--text-sm); max-height: 10rem; overflow: auto; padding-left: var(--sp-4); }
  .modal-actions { display: flex; gap: var(--sp-2); flex-wrap: wrap; justify-content: flex-end; }

  .vaults-view {
    height: 100vh;
    height: 100dvh;
    background: var(--color-background);
    color: var(--color-text);
    display: flex;
    flex-direction: column;
  }
  .topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 44px;
    padding: 0 var(--sp-4);
    border-bottom: 1px solid var(--hairline);
    flex: none;
  }
  .top-actions { display: flex; gap: var(--sp-1); align-items: center; }

  .content {
    flex: 1;
    overflow-y: auto;
    width: 100%;
    max-width: 680px;
    margin: 0 auto;
    padding: var(--sp-6) var(--sp-4) var(--sp-7);
  }
  .title-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-3);
    flex-wrap: wrap;
    margin-bottom: var(--sp-5);
  }
  .title-row h1 {
    font-size: var(--text-xl);
    font-weight: 650;
    letter-spacing: -0.01em;
  }
  .title-actions { display: flex; gap: var(--sp-2); align-items: center; flex-wrap: wrap; }

  .placeholder {
    padding: var(--sp-7) var(--sp-4);
    text-align: center;
    color: var(--color-text-dim);
    border: 1px dashed var(--hairline);
    border-radius: var(--radius-lg);
  }
  .empty-title { color: var(--color-text); font-weight: 600; margin-bottom: var(--sp-1); }
  .empty-sub { font-size: var(--text-sm); margin-bottom: var(--sp-4); }
  .empty-actions { display: inline-flex; gap: var(--sp-2); }
  .error.small {
    padding: var(--sp-2) var(--sp-3);
    margin-bottom: var(--sp-3);
    font-size: var(--text-sm);
    color: var(--color-error);
    border: 1px solid color-mix(in srgb, var(--color-error) 40%, transparent);
    border-radius: var(--radius);
  }

  .group { margin: var(--sp-5) 0 var(--sp-2); font-weight: 400; }
  .group:first-of-type { margin-top: 0; }
  .vault-list, .accounts {
    list-style: none;
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    overflow: hidden;
  }
  .vault-row {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    padding: 10px var(--sp-3);
    cursor: pointer;
    position: relative;
    outline: none;
  }
  .vault-row + .vault-row, .account-row + .account-row { border-top: 1px solid var(--hairline); }
  .vault-row.active { background: var(--tint-hover); }
  .vault-row.active::before {
    content: '';
    position: absolute;
    left: 0;
    top: 6px;
    bottom: 6px;
    width: 2px;
    border-radius: 2px;
    background: var(--color-primary);
  }
  .glyph, .avatar {
    flex: none;
    width: 28px;
    height: 28px;
    border-radius: 7px;
    display: grid;
    place-items: center;
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--color-primary);
    background: var(--tint-primary);
  }
  .avatar { border-radius: 50%; color: var(--color-secondary); background: color-mix(in srgb, var(--color-secondary) 12%, transparent); }
  .vault-row.current .glyph { background: var(--color-primary); color: var(--color-background); }
  .vault-main, .account-main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .vault-name, .account-name {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-2);
    font-weight: 550;
    font-size: var(--text-md);
  }
  .vault-slug {
    color: var(--color-text-dim);
    font-size: var(--text-xs);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .vault-meta { display: inline-flex; gap: var(--sp-2); align-items: center; }

  .banner, .onboarding {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--sp-3);
    padding: var(--sp-3);
    margin-bottom: var(--sp-3);
    background: var(--tint-primary);
    border: 1px solid color-mix(in srgb, var(--color-primary) 30%, transparent);
    border-radius: var(--radius);
    font-size: var(--text-sm);
  }
  .banner-actions {
    display: inline-flex;
    gap: var(--sp-2);
    align-items: center;
    white-space: nowrap;
  }
  .accounts-title { margin-top: var(--sp-6); }
  .account-row {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    padding: 10px var(--sp-3);
    font-size: var(--text-sm);
  }
  .needs { color: var(--color-warning); font-size: var(--text-xs); }

  @media (max-width: 560px) {
    .content { padding-top: var(--sp-5); }
    .title-actions .ghost:not(.icon) { display: none; }
    .account-row { flex-wrap: wrap; }
    .account-row .banner-actions { width: 100%; justify-content: flex-end; }
  }
</style>
