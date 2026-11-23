<script lang="ts">
  // Toolbar sync indicator + details popover (SPEC-LIVROS §4.3, web):
  // server, account, role, state; last sync; cursor/head; alternates;
  // last 5 errors; [Tentar agora] [Entrar] [Trocar servidor…]
  // [Desligar]; rename (vault.manage) lives here too.
  import { tick } from 'svelte';
  import { books } from '../lib/books.svelte.ts';
  import { sync } from '../lib/sync.svelte.ts';
  import { accounts } from '../lib/accounts.svelte.ts';
  import { vaultMembers } from '../lib/vaultmembers.svelte.ts';
  import { uiState } from '../lib/uistate.svelte.ts';
  import { serverLabel, isInsecure } from '../lib/serverurl.ts';
  import { STATE_LABEL } from '../lib/bookstatus.ts';
  import { ApiError } from '../lib/types.ts';
  import type { Alternate } from '../lib/books-model.ts';
  import SyncDot from './SyncDot.svelte';
  import { isTextTarget, newChord, rovingKey, trapTab } from '../lib/list-keys.ts';

  let open = $state(false);
  let showAlts = $state(false);
  let confirmUnlink = $state(false);
  let renameValue = $state('');
  let renameErr = $state<string | null>(null);
  let renaming = $state(false);
  let panelEl = $state<HTMLElement | null>(null);
  let triggerEl = $state<HTMLButtonElement | null>(null);
  const chord = newChord();
  let now = $state(Date.now());

  const book = $derived(books.active);
  const status = $derived(book ? sync.statusOf(book) : null);
  const acctKey = $derived(book ? books.accountKeyOf(book) : null);
  const acct = $derived(acctKey ? accounts.get(acctKey) : null);
  const vinfo = $derived(book ? books.info[book.vault_id] : undefined);
  const cu = $derived(book ? (sync.catchUp[book.id] ?? { cursor: 0, head: 0 }) : null);
  const errs = $derived(book ? (sync.errors[book.id] ?? []) : []);
  const alts = $derived<Alternate[]>(book ? (books.alternates[book.vault_id] ?? []) : []);
  const lastSync = $derived(book ? sync.lastSyncedAt[book.id] : undefined);
  const feed = $derived(acctKey ? sync.feedOf(acctKey) : null);
  const canManage = $derived(
    !!book && vaultMembers.vaultID === book.vault_id && vaultMembers.userHasCapability(acct?.user_id, 'vault.manage'),
  );

  function ago(ts: number | undefined, ref: number): string {
    if (!ts) return 'nunca';
    const s = Math.max(0, Math.round((ref - ts) / 1000));
    if (s < 10) return 'agora';
    if (s < 60) return `há ${s} s`;
    const m = Math.round(s / 60);
    if (m < 60) return `há ${m} min`;
    const h = Math.round(m / 60);
    return h < 24 ? `há ${h} h` : `há ${Math.round(h / 24)} d`;
  }

  async function toggle(): Promise<void> {
    open = !open;
    if (!open) return;
    now = Date.now();
    showAlts = false;
    confirmUnlink = false;
    renameErr = null;
    renameValue = book?.name ?? '';
    if (book) void vaultMembers.openVault(book.vault_id);
    await tick();
    panelEl?.focus();
  }

  /** Close and hand focus back to the indicator. */
  function close(): void {
    open = false;
    void tick().then(() => triggerEl?.focus());
  }

  // Keyboard: j/k (↓/↑) walk the actions, gg/G jump, Enter runs the
  // focused one, Esc / q (outside the rename field) closes and returns
  // focus to the indicator; Tab cycles inside.
  function onKey(e: KeyboardEvent): void {
    e.stopPropagation();
    if (trapTab(e, panelEl)) return;
    if (e.key === 'Escape' || (e.key === 'q' && !e.ctrlKey && !e.metaKey && !isTextTarget(e.target))) {
      e.preventDefault();
      close();
      return;
    }
    rovingKey(e, panelEl, 'button:not([disabled])', null, { chord });
  }

  /** Click outside closes (without stealing focus from the target). */
  function onDocPointer(e: PointerEvent): void {
    if (!open) return;
    const t = e.target as Node | null;
    if (t && (panelEl?.contains(t) || triggerEl?.contains(t))) return;
    open = false;
  }
  $effect(() => {
    if (!open) return;
    document.addEventListener('pointerdown', onDocPointer, true);
    return () => document.removeEventListener('pointerdown', onDocPointer, true);
  });

  async function rename(): Promise<void> {
    if (!book || !renameValue.trim() || renameValue.trim() === book.name) return;
    renaming = true;
    renameErr = null;
    try {
      await books.rename(book.id, renameValue);
    } catch (e) {
      renameErr = e instanceof ApiError ? (e.detail ?? e.code) : (e as Error).message;
    } finally {
      renaming = false;
    }
  }

  function switchTo(a: Alternate): void {
    if (!book) return;
    const id = book.id;
    books.switchServer(id, a);
    sync.resetBook(id);
    open = false;
  }

  function signIn(): void {
    if (!book) return;
    open = false;
    uiState.openSignIn(book.server_url, book.account);
  }

  function unlink(): void {
    if (!book) return;
    open = false;
    books.removeFromList(book.id);
  }
</script>

{#if book && status}
  <div class="sync-status">
    <button
      type="button"
      class="indicator"
      aria-haspopup="dialog"
      aria-expanded={open}
      data-testid="sync-indicator"
      aria-controls="sync-status-panel"
      title="Estado de sincronização"
      bind:this={triggerEl}
      onkeydown={(e) => { if (e.key === 'ArrowDown' && !open) { e.preventDefault(); void toggle(); } }}
      onclick={() => void toggle()}
    >
      <SyncDot state={status.state} pending={status.pending} label />
    </button>
    {#if open}
      <div
        bind:this={panelEl}
        class="panel"
        id="sync-status-panel"
        role="dialog"
        aria-label="Estado de sincronização"
        data-testid="sync-panel"
        tabindex="-1"
        onkeydown={onKey}
      >
        <dl>
          <dt>estado</dt>
          <dd data-testid="sync-state">{STATE_LABEL[status.state].pt}{#if status.reason} — {status.reason}{/if}</dd>
          {#if status.pending}
            <dt>pendente</dt>
            <dd data-testid="sync-pending">alterações locais ainda não confirmadas pelo servidor{#if sync.pendingCount(book) > 0} ({sync.pendingCount(book)} {sync.pendingCount(book) === 1 ? 'nota' : 'notas'}){/if}</dd>
          {/if}
          <dt>servidor</dt>
          <dd>{serverLabel(book.server_url)}{#if isInsecure(book.server_url)}&nbsp;<span class="warn">(sem criptografia)</span>{/if}</dd>
          <dt>conta</dt>
          <dd>{book.account}{#if acct?.status === 'needs_login'}&nbsp;<span class="warn">(precisa entrar)</span>{/if}</dd>
          {#if vinfo?.role}<dt>papel</dt><dd>{vinfo.role}</dd>{/if}
          <dt>última sincronização</dt>
          <dd>{ago(lastSync, now)}</dd>
          <dt>cursor/head</dt>
          <dd>{cu?.cursor ?? 0}/{cu?.head ?? 0}</dd>
          {#if feed?.state === 'disabled'}
            <dt>feed</dt>
            <dd>indisponível neste servidor — a lista é atualizada a cada minuto e em "Tentar agora"</dd>
          {/if}
        </dl>

        {#if alts.length > 0}
          <div class="section">
            <div class="section-title">alternativas</div>
            <ul>
              {#each alts as a (a.server_url + '#' + a.account)}
                <li>
                  {serverLabel(a.server_url)} · {a.account}{#if a.federation_role} · {a.federation_role === 'home' ? 'origem' : 'seguidor'}{/if}
                  {#if showAlts}<button type="button" class="link-button" onclick={() => switchTo(a)}>usar este</button>{/if}
                </li>
              {/each}
            </ul>
            {#if showAlts}
              <p class="note">Trocar de servidor recomeça o cursor (o seq é por servidor). Nada é apagado.</p>
            {/if}
          </div>
        {/if}

        {#if errs.length > 0}
          <div class="section">
            <div class="section-title">últimos erros</div>
            <ul class="errors">
              {#each [...errs].reverse() as e (e.at + e.message)}
                <li>{ago(e.at, now)}: {e.message}</li>
              {/each}
            </ul>
          </div>
        {/if}

        <div class="section">
          <label class="section-title" for="book-rename">nome do livro</label>
          <div class="rename-row">
            <input
              id="book-rename"
              class="input"
              type="text"
              bind:value={renameValue}
              disabled={!canManage || renaming || sync.isOffline(book)}
              onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void rename(); } }}
            />
            <button type="button" class="link-button" disabled={!canManage || renaming || sync.isOffline(book)} onclick={() => void rename()}>renomear</button>
          </div>
          {#if !canManage}
            <p class="note">Renomear muda o nome para todos e exige a permissão “Manage vault”.</p>
          {:else if sync.isOffline(book)}
            <p class="note">Indisponível offline.</p>
          {/if}
          {#if renameErr}<p class="err">{renameErr}</p>{/if}
        </div>

        <div class="actions">
          <button type="button" class="link-button" onclick={() => { sync.retryBook(book); now = Date.now(); }}>Tentar agora</button>
          {#if status.state === 'needs_login'}
            <button type="button" class="link-button" onclick={signIn}>Entrar</button>
          {/if}
          {#if alts.length > 0}
            <button type="button" class="link-button" onclick={() => (showAlts = !showAlts)}>Trocar servidor…</button>
          {/if}
          {#if confirmUnlink}
            <span class="note">Remove só deste aparelho; o livro continua no servidor.</span>
            <button type="button" class="link-button danger" onclick={unlink}>Remover da lista</button>
            <button type="button" class="link-button" data-unlink-cancel onclick={() => { confirmUnlink = false; void tick().then(() => panelEl?.querySelector<HTMLElement>('[data-unlink]')?.focus()); }}>Cancelar</button>
          {:else}
            <button type="button" class="link-button" data-unlink onclick={() => { confirmUnlink = true; void tick().then(() => panelEl?.querySelector<HTMLElement>('[data-unlink-cancel]')?.focus()); }}>Desligar</button>
          {/if}
        </div>
      </div>
    {/if}
  </div>
{/if}

<style>
  .sync-status {
    position: relative;
    display: inline-flex;
  }
  .indicator {
    background: transparent;
    border: none;
    cursor: pointer;
    padding: 0.1rem 0.25rem;
    font-family: inherit;
    border-radius: 4px;
  }
  .indicator:hover,
  .indicator:focus-visible {
    background: var(--color-selected-bg, var(--color-overlay-bg));
  }
  .panel {
    position: absolute;
    right: 0;
    top: calc(100% + 6px);
    z-index: 60;
    width: min(360px, 90vw);
    background: var(--color-background);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    box-shadow: var(--shadow-pop);
    animation: ui-rise 120ms var(--ease);
    padding: 0.8rem 0.9rem;
    font-size: 0.82rem;
    color: var(--color-text);
    outline: none;
    text-align: left;
  }
  dl {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 0.25rem 0.75rem;
    margin: 0;
  }
  dt {
    color: var(--color-text-dim, var(--color-muted));
  }
  dd {
    margin: 0;
    word-break: break-word;
  }
  .section {
    margin-top: 0.7rem;
  }
  .section-title {
    display: block;
    color: var(--color-text-dim, var(--color-muted));
    font-size: 0.74rem;
    margin-bottom: 0.2rem;
  }
  ul {
    margin: 0;
    padding-left: 1rem;
  }
  .errors li {
    color: var(--color-error);
  }
  .rename-row {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }
  .input {
    flex: 1;
    padding: 0.3rem 0.5rem;
    background: var(--color-overlay-bg, var(--color-background));
    border: 1px solid var(--color-border, var(--color-muted));
    border-radius: 4px;
    color: var(--color-text);
    font-family: inherit;
    font-size: 0.82rem;
  }
  .note {
    margin: 0.25rem 0 0;
    color: var(--color-text-dim, var(--color-muted));
    font-size: 0.74rem;
  }
  .err {
    margin: 0.25rem 0 0;
    color: var(--color-error);
  }
  .warn {
    color: var(--color-warning, var(--color-secondary));
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
    margin-top: 0.8rem;
    padding-top: 0.6rem;
    border-top: 1px solid var(--color-separator, var(--color-border));
  }
  .link-button {
    background: transparent;
    border: none;
    color: var(--color-secondary);
    font-family: inherit;
    font-size: 0.82rem;
    cursor: pointer;
    padding: 0;
  }
  .link-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .link-button.danger {
    color: var(--color-error);
  }
  .link-button:hover:not(:disabled) { text-decoration: underline; text-underline-offset: 3px; }
  .link-button:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; border-radius: 3px; }
</style>
