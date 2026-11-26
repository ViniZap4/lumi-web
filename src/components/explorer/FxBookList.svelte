<script lang="ts">
  // The explorer's books level list: account cards ("Contas e
  // servidores", only with many accounts) or the books grouped by
  // account. Keys are handled by the overlay; this renders and clicks.
  import { books } from '../../lib/books.svelte.ts';
  import { serverLabel } from '../../lib/serverurl.ts';
  import { updatedLabel } from '../../lib/hover-preview.ts';
  import { STATE_LABEL } from '../../lib/bookstatus.ts';
  import { flatIndex, plural, type BooksCursor, type AccountGroup } from '../../lib/books-nav.ts';
  import { selectorOrder } from '../../lib/books-model.ts';
  import SyncDot from '../SyncDot.svelte';
  import LvIcon from './LvIcon.svelte';
  import { noteCount, accountOf, avatarSlot, statusOf } from './fx-books.ts';

  interface Props {
    groups: AccountGroup[];
    bc: BooksCursor;
    atAccounts: boolean;
    sheet: boolean;
    listEl?: HTMLElement | null;
    onchoose: (accountIdx: number, bookIdx: number) => void;
    onpickaccount: (i: number) => void;
  }
  let { groups, bc = $bindable(), atAccounts, sheet, listEl = $bindable(null), onchoose, onpickaccount }: Props = $props();

  const order = $derived(selectorOrder(books.list));
  const curFlat = $derived(flatIndex(groups, bc));
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
  class="fx-list active"
  class:accounts-layer={atAccounts}
  role="listbox"
  tabindex="0"
  aria-label={atAccounts ? 'Contas e servidores' : 'Livros'}
  aria-activedescendant={atAccounts ? `fxa-${bc.account}` : `fxb-${curFlat}`}
  bind:this={listEl}
  data-testid="fx-books-list"
>
  {#if atAccounts}
    {#each groups as g, i (g.key)}
      {@const acct = accountOf(g.key)}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <div id="fxa-{i}" class="fx-row fx-acct-row" class:cursor={i === bc.account} role="option" tabindex="-1" aria-selected={i === bc.account} data-hint-target onclick={() => onpickaccount(i)}>
        <span class="fx-avatar" data-slot={avatarSlot(g.key)} aria-hidden="true">{g.account.slice(0, 1).toUpperCase()}</span>
        <span class="fx-acct-text">
          <span class="fx-row-name">{g.account}</span>
          <span class="fx-acct-host"><LvIcon kind="server" px={11} />{serverLabel(g.server_url)}</span>
        </span>
        <span class="fx-acct-status" data-status={acct?.status ?? 'unknown'}>{acct?.status === 'needs_login' ? 'precisa entrar' : 'conectado'}</span>
        <span class="fx-row-meta">{plural(g.books.length, 'livro', 'livros')}</span>
      </div>
    {/each}
  {:else}
    {#each groups as g, gi (g.key)}
      {@const acct = accountOf(g.key)}
      {@const base = flatIndex(groups, { account: gi, book: 0 })}
      <div class="fx-group" role="group" aria-label="{g.account}@{serverLabel(g.server_url)}">
        <div class="fx-acct" aria-hidden="true">
          <span class="fx-avatar sm" data-slot={avatarSlot(g.key)}>{g.account.slice(0, 1).toUpperCase()}</span>
          <span class="fx-acct-name">{g.account}</span>
          <span class="fx-acct-host"><LvIcon kind="server" px={11} />{serverLabel(g.server_url)}</span>
          <span class="fx-acct-dot" data-status={acct?.status ?? 'unknown'} title={acct?.status === 'needs_login' ? 'precisa entrar' : 'conectado'}></span>
          <span class="fx-acct-count">{plural(g.books.length, 'livro', 'livros')}</span>
        </div>
        {#each g.books as b, i (b.id)}
          {@const st = statusOf(b)}
          {@const n = order.findIndex((x) => x.id === b.id) + 1}
          {@const cnt = noteCount(b)}
          {@const sel = gi === bc.account && i === bc.book}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <div
            id="fxb-{base + i}"
            class="fx-row fx-book-row"
            class:cursor={sel}
            class:current={b.id === books.activeID}
            role="option"
            tabindex="-1"
            aria-selected={sel}
            aria-current={b.id === books.activeID ? 'true' : undefined}
            data-hint-target
            style="min-height: {sheet ? 52 : 40}px"
            onclick={() => (sheet ? onchoose(gi, i) : (bc = { level: 'books', account: gi, book: i }))}
            ondblclick={() => onchoose(gi, i)}
          >
            <span class="fx-book-ic"><LvIcon kind="book" px={15} /></span>
            <span class="fx-book-text">
              <span class="fx-row-name">{b.name}</span>
              <span class="fx-book-sub">
                <SyncDot state={st.state} pending={st.pending} vaultID={b.vault_id} />
                <span>{STATE_LABEL[st.state].pt}</span>
                {#if cnt != null}<span class="dot-sep" aria-hidden="true">·</span><span>{plural(cnt, 'nota', 'notas')}</span>{/if}
                {#if b.last_opened_at}<span class="dot-sep" aria-hidden="true">·</span><span>{updatedLabel(b.last_opened_at)}</span>{/if}
              </span>
            </span>
            {#if b.id === books.activeID}<span class="fx-open-tag">aberto</span>{/if}
            {#if n > 0 && n <= 9}<kbd class="fx-kbd">g{n}</kbd>{/if}
          </div>
        {/each}
      </div>
    {/each}
  {/if}
  {#if groups.length === 0}<div class="fx-empty">Nenhum livro ainda — a cria um</div>{/if}
</div>

<style>
  .fx-list { flex: 1; min-height: 0; overflow-y: auto; padding: 6px; outline: none; }
  .fx-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 10px;
    border-radius: var(--radius-sm);
    font-size: var(--text-sm);
    cursor: pointer;
    user-select: none;
    transition: background var(--dur-tap) var(--ease);
  }
  .fx-row:hover { background: var(--tint-hover); }
  .fx-row.cursor { background: var(--tint-hover); }
  .fx-list.active .fx-row.cursor {
    background: linear-gradient(90deg, var(--accent-soft), var(--accent-wash));
    box-shadow: inset 2px 0 0 var(--accent), 0 0 0 1px var(--accent-wash), 0 6px 18px -10px var(--accent-glow);
  }
  .fx-list.active:focus-visible .fx-row.cursor { box-shadow: inset 2px 0 0 var(--accent), inset 0 0 0 1px var(--ring); }
  .fx-row.current .fx-row-name { color: var(--accent-ink); font-weight: 600; }
  .fx-row-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .fx-row-meta { flex: none; font-size: var(--text-2xs); color: var(--ink-3); }
  .fx-empty { padding: var(--sp-6); text-align: center; color: var(--ink-3); font-size: var(--text-sm); }
  :global(.fx.sheet) .fx-row { font-size: var(--text-md); }

  .fx-group { margin: 0 0 var(--sp-3); }
  .fx-acct {
    display: flex; align-items: center; gap: var(--sp-2);
    padding: var(--sp-3) var(--sp-2) 6px; margin-bottom: 2px;
    font-size: var(--text-xs); color: var(--ink-3);
    border-bottom: 1px solid var(--hairline-soft);
    cursor: default; user-select: none;
  }
  .fx-group:first-child .fx-acct { padding-top: var(--sp-1); }
  .fx-acct-name { font-weight: 650; color: var(--ink-2); letter-spacing: var(--tracking-ui); }
  .fx-acct-host { display: inline-flex; align-items: center; gap: 4px; font-family: var(--font-mono); font-size: var(--text-2xs); color: var(--ink-3); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .fx-acct-dot { flex: none; width: 7px; height: 7px; border-radius: 50%; background: var(--ok); box-shadow: 0 0 0 3px color-mix(in oklch, var(--ok) 18%, transparent); }
  .fx-acct-dot[data-status='needs_login'] { background: var(--color-warning); box-shadow: 0 0 0 3px color-mix(in oklch, var(--color-warning) 18%, transparent); }
  .fx-acct-dot[data-status='unknown'] { background: var(--ink-4); box-shadow: none; }
  .fx-acct-count { margin-left: auto; font-size: var(--text-2xs); color: var(--ink-4); font-variant-numeric: tabular-nums; }
  .fx-avatar {
    flex: none; display: grid; place-items: center; width: 26px; height: 26px; border-radius: 50%;
    font-size: var(--text-xs); font-weight: 700; color: var(--color-background);
    background: var(--av, var(--color-primary));
    box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.25), 0 0 0 2px color-mix(in oklch, var(--av, var(--color-primary)) 30%, transparent);
  }
  .fx-avatar.sm { width: 18px; height: 18px; font-size: 10px; }
  .fx-avatar[data-slot='1'] { --av: var(--color-secondary); }
  .fx-avatar[data-slot='2'] { --av: var(--color-accent); }
  .fx-avatar[data-slot='3'] { --av: var(--color-info); }
  .fx-book-row { gap: var(--sp-3); padding-top: 5px; padding-bottom: 5px; height: auto; }
  .fx-book-ic { flex: none; display: grid; place-items: center; width: 28px; height: 28px; border-radius: var(--radius-sm); color: var(--ink-3); background: var(--surface-2); box-shadow: var(--edge-light); }
  .fx-row.current .fx-book-ic, .fx-row.cursor .fx-book-ic { color: var(--accent); background: var(--accent-wash); }
  .fx-book-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
  .fx-book-sub { display: flex; align-items: center; gap: 5px; font-size: var(--text-2xs); color: var(--ink-3); white-space: nowrap; overflow: hidden; }
  .dot-sep { color: var(--ink-4); }
  .fx-open-tag { flex: none; padding: 1px 7px; border-radius: var(--radius-pill); font-size: var(--text-2xs); color: var(--accent-ink); background: var(--accent-wash); box-shadow: inset 0 0 0 1px var(--accent-soft); }
  .fx-kbd { flex: none; min-width: 22px; padding: 1px 5px; border: 1px solid var(--hairline); border-bottom-width: 2px; border-radius: var(--radius-xs); background: var(--surface-1); font-family: var(--font-mono); font-size: var(--text-2xs); color: var(--ink-3); text-align: center; }
  /* Contas e servidores: cards, not folders (no chevron, no Miller parent). */
  .fx-list.accounts-layer { padding: var(--sp-2); display: flex; flex-direction: column; gap: 6px; }
  .fx-acct-row { height: auto; min-height: 52px; gap: var(--sp-3); padding: var(--sp-2) var(--sp-3); border: 1px solid var(--hairline-soft); border-radius: var(--radius-lg); background: var(--surface-1); box-shadow: var(--edge-light); }
  .fx-acct-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .fx-acct-status { flex: none; font-size: var(--text-2xs); color: var(--ok); }
  .fx-acct-status[data-status='needs_login'] { color: var(--color-warning); }
</style>
