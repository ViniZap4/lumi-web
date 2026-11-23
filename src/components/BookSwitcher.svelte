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
    {#if activeStatus}<SyncDot state={activeStatus.state} pending={activeStatus.pending} />{/if}
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
              <SyncDot state={sync.statusOf(b).state} pending={sync.statusOf(b).pending} />
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
  .book-switcher { position: relative; }
  .switcher-button {
    display: flex;
    align-items: center;
    gap: 6px;
    max-width: 100%;
    height: 28px;
    padding: 0 8px;
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    color: var(--color-text);
    font-size: var(--text-sm);
    font-weight: 600;
    cursor: pointer;
    text-align: left;
  }
  .switcher-button:hover,
  .switcher-button:focus-visible { background: var(--tint-hover); }
  .switcher-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .caret { color: var(--color-text-dim); font-size: 10px; }
  .switcher-pop {
    position: absolute;
    left: 0;
    top: calc(100% + 6px);
    z-index: 50;
    background: var(--color-background);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    box-shadow: var(--shadow-pop);
    padding: 4px;
    min-width: 260px;
    animation: ui-rise 120ms var(--ease);
  }
  .switcher-list {
    list-style: none;
    margin: 0;
    padding: 0;
    max-height: 50vh;
    overflow-y: auto;
    outline: none;
  }
  .group {
    padding: 8px 8px 4px;
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--color-text-dim);
  }
  .opt {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 30px;
    padding: 0 8px;
    border-radius: var(--radius-sm);
    cursor: pointer;
    font-size: var(--text-sm);
  }
  .opt.cursor { background: var(--tint-active); }
  .opt.current .opt-name { color: var(--color-primary); font-weight: 600; }
  .opt-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .opt-meta { font-family: var(--font-mono); font-size: var(--text-2xs); color: var(--color-text-dim); }
  .switcher-actions {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 1px;
    padding: 4px 0 0;
    border-top: 1px solid var(--hairline);
    margin-top: 4px;
  }
  .link-button {
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    color: var(--color-text-dim);
    font-size: var(--text-sm);
    cursor: pointer;
    text-align: left;
    padding: 6px 8px;
  }
  .link-button:hover { background: var(--tint-hover); color: var(--color-text); }
</style>
