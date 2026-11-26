<script lang="ts">
  // The explorer's header: the "where you are" crumbs (Contas › conta ›
  // Livros at the books level; Livros › book › folders at the files
  // level), a pending key, and close. On a sheet, an up button.
  import { serverLabel } from '../../lib/serverurl.ts';
  import type { AccountGroup } from '../../lib/books-nav.ts';
  import LvIcon from './LvIcon.svelte';
  import type { FxLevel } from './fx-types.ts';

  interface Props {
    level: FxLevel;
    sheet: boolean;
    atAccounts: boolean;
    accountsLayer: boolean;
    account: AccountGroup | null;
    crumbs: Array<{ name: string; path: string }>;
    dir: string;
    bookName: string;
    pending: string | null;
    onup: () => void;
    /** Books level: up to "Contas e servidores". */
    onaccounts: () => void;
    /** Files level: up to the shelf (Livros). */
    onshelf: () => void;
    oncrumb: (path: string) => void;
    onclose: () => void;
  }
  const { level, sheet, atAccounts, accountsLayer, account, crumbs, dir, bookName, pending, onup, onaccounts, onshelf, oncrumb, onclose }: Props = $props();
</script>

<header class="fx-head">
  {#if sheet && !(level === 'books' && (atAccounts || !accountsLayer))}
    <button type="button" class="fx-up" onclick={onup} aria-label={level === 'books' ? 'Contas e servidores' : dir ? 'Up a folder' : 'Livros'}>
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M10 3.5 5.5 8l4.5 4.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </button>
  {/if}
  <nav class="fx-crumbs" aria-label={level === 'books' ? 'Onde você está' : 'Folder path'} data-testid="fx-crumbs">
    {#if level === 'books'}
      {#if accountsLayer}
        <button type="button" class="fx-crumb" data-level="accounts" aria-current={atAccounts ? 'location' : undefined} onclick={() => { if (!atAccounts) onaccounts(); }}><LvIcon kind="server" />{atAccounts ? 'Contas e servidores' : 'Contas'}</button>
        {#if !atAccounts && account}
          <span class="fx-sep" aria-hidden="true">›</span>
          <span class="fx-crumb static" data-level="account"><LvIcon kind="account" />{account.account}@{serverLabel(account.server_url)}</span>
        {/if}
      {/if}
      {#if !atAccounts}
        {#if accountsLayer}<span class="fx-sep" aria-hidden="true">›</span>{/if}
        <span class="fx-crumb static" data-level="shelf" aria-current="location"><LvIcon kind="shelf" />Livros</span>
      {/if}
    {:else}
      <button type="button" class="fx-crumb" data-level="shelf" onclick={onshelf}><LvIcon kind="shelf" />Livros</button>
      {#each crumbs as c, i (c.path)}
        <span class="fx-sep" aria-hidden="true">›</span>
        <button type="button" class="fx-crumb" data-level={i === 0 ? 'book' : 'folder'} aria-current={i === crumbs.length - 1 ? 'location' : undefined} onclick={() => oncrumb(c.path)}><LvIcon kind={i === 0 ? 'book' : 'folder'} />{i === 0 ? bookName : c.name}</button>
      {/each}
    {/if}
  </nav>
  {#if pending}<span class="fx-pending mono">{pending}</span>{/if}
  <button class="ui-btn ghost sm icon" type="button" onclick={onclose} aria-label="Close explorer">
    <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
  </button>
</header>

<style>
  .fx-head {
    position: relative;
    flex: none;
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    height: 44px;
    padding: 0 var(--sp-2) 0 var(--sp-4);
    border-bottom: 1px solid var(--hairline-soft);
  }
  :global(.fx.sheet) .fx-head { height: 48px; background: transparent; }
  .fx-up { flex: none; display: grid; place-items: center; width: 36px; height: 36px; margin-left: -6px; border: none; border-radius: var(--radius); background: transparent; color: var(--color-text); cursor: pointer; }
  .fx-up:active { background: var(--tint-active); }
  .fx-crumbs { flex: 1; min-width: 0; display: flex; align-items: center; gap: 2px; overflow-x: auto; white-space: nowrap; scrollbar-width: none; font-size: var(--text-sm); }
  .fx-crumb { border: none; background: transparent; color: var(--ink-3); padding: 3px 6px; border-radius: var(--radius-sm); cursor: pointer; font-size: inherit; transition: background var(--dur-tap) var(--ease), color var(--dur-fade) var(--ease); }
  .fx-crumb.static { cursor: default; }
  .fx-crumb:not(.static):hover { background: var(--tint-hover); color: var(--color-text); }
  .fx-crumb[aria-current='location'] { color: var(--color-text); font-weight: 600; animation: crumb-in var(--spring-gentle-ms) var(--spring-gentle) both; }
  @keyframes crumb-in { from { opacity: 0; transform: translateX(-4px); } }
  .fx-sep { color: var(--ink-4); }
  .fx-pending { color: var(--color-warning); font-size: var(--text-xs); }
  .mono { font-family: var(--font-mono); }
  .fx-crumb { display: inline-flex; align-items: center; gap: 5px; }
  .fx-crumb :global(.lv-ic) { color: var(--ink-4); }
  .fx-crumb[data-level='shelf'] :global(.lv-ic), .fx-crumb[data-level='book'] :global(.lv-ic) { color: var(--accent); }
  .fx-crumb[data-level='folder'] :global(.lv-ic) { color: var(--color-secondary); }
  .fx-crumb[data-level='accounts'] :global(.lv-ic), .fx-crumb[data-level='account'] :global(.lv-ic) { color: var(--color-info); }
</style>
