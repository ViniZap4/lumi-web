<script lang="ts">
  // The explorer's books level preview: the book under the cursor (or
  // the account, on the accounts layer).
  import { books } from '../../lib/books.svelte.ts';
  import { serverLabel } from '../../lib/serverurl.ts';
  import { updatedLabel } from '../../lib/hover-preview.ts';
  import { plural, type AccountGroup } from '../../lib/books-nav.ts';
  import SyncDot from '../SyncDot.svelte';
  import LvIcon from './LvIcon.svelte';
  import { noteCount, accountOf, statusOf } from './fx-books.ts';

  type Group = AccountGroup;
  const { book, account }: { book: Group['books'][number] | null; account: Group | null } = $props();
</script>

{#if book}
  {@const st = statusOf(book)}
  {@const cnt = noteCount(book)}
  {#key book.id}
    <div class="fx-note fx-bookcard">
      <div class="fx-cover" aria-hidden="true"><LvIcon kind="book" px={26} /></div>
      <div class="fx-note-head">
        <span class="fx-note-title">{book.name}</span>
        <span class="fx-note-meta">{book.account}@{serverLabel(book.server_url)}</span>
      </div>
      <dl class="fx-facts">
        <dt>Estado</dt><dd><SyncDot state={st.state} pending={st.pending} label vaultID={book.vault_id} /></dd>
        <dt>Notas</dt><dd>{cnt != null ? plural(cnt, 'nota', 'notas') : '—'}</dd>
        <dt>Aberto</dt><dd>{book.last_opened_at ? updatedLabel(book.last_opened_at) : 'nunca neste aparelho'}</dd>
      </dl>
      <p class="fx-bookline dim">{book.id === books.activeID ? 'Aberto agora — ⏎ ou l volta às notas' : '⏎ ou l abre este livro'}</p>
    </div>
  {/key}
{:else if account}
  {@const acct = accountOf(account.key)}
  <div class="fx-note">
    <div class="fx-note-head">
      <span class="fx-note-title">{account.account}</span>
      <span class="fx-note-meta">{serverLabel(account.server_url)} · {acct?.status === 'needs_login' ? 'precisa entrar' : 'conectado'}</span>
    </div>
    <ul class="fx-mini">{#each account.books as b (b.id)}<li><LvIcon kind="book" px={11} /> {b.name}</li>{/each}</ul>
    <p class="fx-bookline dim">⏎ ou l mostra os livros desta conta</p>
  </div>
{/if}

<style>
  .fx-note { padding: var(--sp-5) var(--sp-5) var(--sp-6); animation: resolve-in var(--spring-gentle-ms) var(--spring-gentle) both; }
  .fx-note-head { display: flex; flex-direction: column; gap: 3px; padding-bottom: var(--sp-3); margin-bottom: var(--sp-4); border-bottom: 1px solid var(--hairline-soft); }
  .fx-note-title { font-weight: 700; font-size: var(--text-xl); letter-spacing: var(--tracking-tight); line-height: 1.2; }
  .fx-note-meta { font-family: var(--font-mono); font-size: var(--text-2xs); color: var(--ink-3); }
  .fx-bookline { margin: 0 0 var(--sp-2); font-size: var(--text-sm); }
  .fx-bookline.dim { color: var(--ink-3); font-size: var(--text-xs); }
  .fx-mini { margin: 0; padding-left: 1.1em; font-size: var(--text-sm); color: var(--ink-3); }
  .fx-mini li { list-style: none; display: flex; align-items: center; gap: 6px; margin-left: -1.1em; }
  .fx-cover { display: grid; place-items: center; width: 52px; height: 64px; margin-bottom: var(--sp-4); border-radius: 4px 8px 8px 4px; color: var(--accent); background: linear-gradient(135deg, var(--accent-soft), var(--accent-wash)); box-shadow: inset 3px 0 0 var(--accent-line), var(--elev-2); }
  .fx-facts { display: grid; grid-template-columns: auto 1fr; gap: 6px var(--sp-4); margin: 0 0 var(--sp-4); font-size: var(--text-sm); }
  .fx-facts dt { color: var(--ink-3); font-size: var(--text-xs); }
  .fx-facts dd { margin: 0; }
</style>
