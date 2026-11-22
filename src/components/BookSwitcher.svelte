<script lang="ts">
  // Book switcher at the top of the sidebar (SPEC-LIVROS §5): a button
  // with the active book's name + sync dot that opens a listbox grouped
  // by server. j/k/↑/↓ move, Enter opens, Esc closes. Rows show the
  // g1–g9 number that opens them.
  import { tick } from 'svelte';
  import { books } from '../lib/books.svelte.ts';
  import { sync } from '../lib/sync.svelte.ts';
  import { uiState } from '../lib/uistate.svelte.ts';
  import { serverLabel } from '../lib/serverurl.ts';
  import { selectorOrder } from '../lib/books-model.ts';
  import SyncDot from './SyncDot.svelte';

  let open = $state(false);
  let cursor = $state(0);
  let listEl = $state<HTMLElement | null>(null);
  let buttonEl = $state<HTMLButtonElement | null>(null);

  const order = $derived(selectorOrder(books.list));
  const activeStatus = $derived(books.active ? sync.statusOf(books.active) : null);

  async function toggle(): Promise<void> {
    if (open) return close();
    open = true;
    cursor = Math.max(0, order.findIndex((b) => b.id === books.activeID));
    await tick();
    listEl?.focus();
  }

  function close(): void {
    open = false;
    buttonEl?.focus();
  }

  function choose(id: string): void {
    books.setActive(id);
    open = false;
    buttonEl?.focus();
  }

  function onListKey(e: KeyboardEvent): void {
    const n = order.length;
    if (e.key === 'ArrowDown' || e.key === 'j') {
      e.preventDefault();
      if (n) cursor = Math.min(n - 1, cursor + 1);
    } else if (e.key === 'ArrowUp' || e.key === 'k') {
      e.preventDefault();
      if (n) cursor = Math.max(0, cursor - 1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      cursor = 0;
    } else if (e.key === 'End') {
      e.preventDefault();
      cursor = Math.max(0, n - 1);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const b = order[cursor];
      if (b) choose(b.id);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (/^[1-9]$/.test(e.key)) {
      e.preventDefault();
      const b = order[Number(e.key) - 1];
      if (b) choose(b.id);
    }
    // Keep every keystroke inside the switcher while it is open: the
    // view's global j/k/Enter must not move the notes list underneath.
    e.stopPropagation();
  }

  function onFocusOut(e: FocusEvent): void {
    const next = e.relatedTarget as Node | null;
    const root = (e.currentTarget as HTMLElement);
    if (open && next && !root.contains(next)) open = false;
  }

  function action(fn: () => void): void {
    open = false;
    fn();
  }
</script>

<div class="book-switcher" onfocusout={onFocusOut}>
  <button
    bind:this={buttonEl}
    class="switcher-button"
    type="button"
    aria-haspopup="listbox"
    aria-expanded={open}
    data-testid="book-switcher"
    onclick={() => void toggle()}
  >
    {#if activeStatus}<SyncDot state={activeStatus.state} />{/if}
    <span class="switcher-name">{books.active?.name ?? 'Livros'}</span>
    <span class="caret" aria-hidden="true">▾</span>
  </button>

  {#if open}
    <div class="switcher-pop">
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <ul
        bind:this={listEl}
        class="switcher-list"
        role="listbox"
        tabindex="0"
        aria-label="Livros"
        aria-activedescendant={order[cursor] ? `book-opt-${order[cursor].id}` : undefined}
        onkeydown={onListKey}
      >
        {#each books.groups as g (g.server_url)}
          <li class="group" role="presentation">{serverLabel(g.server_url)}</li>
          {#each g.books as b (b.id)}
            {@const idx = order.findIndex((x) => x.id === b.id)}
            <li
              id="book-opt-{b.id}"
              class="opt"
              class:cursor={idx === cursor}
              class:current={b.id === books.activeID}
              role="option"
              aria-selected={b.id === books.activeID}
              onclick={() => choose(b.id)}
              onkeydown={() => {}}
              onmouseenter={() => (cursor = idx)}
            >
              <SyncDot state={sync.statusOf(b).state} />
              <span class="opt-name">{b.name}</span>
              <span class="opt-meta">{b.account}{idx < 9 ? ` · g${idx + 1}` : ''}</span>
            </li>
          {/each}
        {/each}
        {#if order.length === 0}
          <li class="group" role="presentation">Nenhum livro ainda</li>
        {/if}
      </ul>
      <div class="switcher-actions">
        <button type="button" class="link-button" onclick={() => action(() => (uiState.createBookOpen = true))}>Novo livro…</button>
        <button type="button" class="link-button" onclick={() => action(() => uiState.openAddServer())}>Adicionar servidor…</button>
        <button type="button" class="link-button" onclick={() => action(() => books.openPicker())}>Gerenciar livros…</button>
      </div>
    </div>
  {/if}
</div>

<style>
  .book-switcher {
    position: relative;
    border-bottom: 1px solid var(--color-separator, var(--color-border));
  }
  .switcher-button {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 0.45rem;
    padding: 0.55rem 0.75rem;
    background: transparent;
    border: none;
    color: var(--color-text);
    font-family: inherit;
    font-size: 0.9rem;
    font-weight: 600;
    cursor: pointer;
    text-align: left;
  }
  .switcher-button:hover,
  .switcher-button:focus-visible {
    background: var(--color-selected-bg, var(--color-overlay-bg));
  }
  .switcher-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .caret {
    color: var(--color-text-dim, var(--color-muted));
  }
  .switcher-pop {
    position: absolute;
    left: 0.4rem;
    right: 0.4rem;
    top: calc(100% + 2px);
    z-index: 50;
    background: var(--color-background);
    border: 1px solid var(--color-border, var(--color-muted));
    border-radius: 6px;
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.35);
    padding: 0.3rem 0;
    min-width: 240px;
  }
  .switcher-list {
    list-style: none;
    margin: 0;
    padding: 0;
    max-height: 50vh;
    overflow-y: auto;
    outline: none;
  }
  .switcher-list:focus-visible {
    box-shadow: inset 0 0 0 1px var(--color-secondary);
  }
  .group {
    padding: 0.35rem 0.75rem 0.15rem;
    font-size: 0.72rem;
    color: var(--color-text-dim, var(--color-muted));
    text-transform: lowercase;
  }
  .opt {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    padding: 0.35rem 0.75rem;
    cursor: pointer;
    font-size: 0.86rem;
  }
  .opt.cursor {
    background: var(--color-selected-bg, var(--color-overlay-bg));
  }
  .opt.current .opt-name {
    color: var(--color-primary);
  }
  .opt-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .opt-meta {
    font-size: 0.72rem;
    color: var(--color-text-dim, var(--color-muted));
  }
  .switcher-actions {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.3rem;
    padding: 0.45rem 0.75rem 0.3rem;
    border-top: 1px solid var(--color-separator, var(--color-border));
    margin-top: 0.3rem;
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
  .link-button:hover {
    text-decoration: underline;
  }
</style>
