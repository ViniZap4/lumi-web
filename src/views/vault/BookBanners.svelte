<script lang="ts">
  // Book-level notices under the top bar: the offline hint, conflict
  // copies of notes deleted on the server, and the books store's
  // banners (dedupe, renames).
  import { books } from '../../lib/books.svelte.ts';
  import { offline } from '../../lib/offline.svelte.ts';
  import { exportAllConflicts } from './conflicts.ts';
  import { useWorkspace } from './context.ts';

  const ws = useWorkspace();
  const orphans = $derived(ws.orphanConflicts);
</script>

{#if ws.explorer.offlineHint}
  <div class="banner" role="status" data-testid="offline-hint">{ws.explorer.offlineHint}</div>
{/if}
{#if orphans.length > 0}
  <div class="banner conflict" role="status" data-testid="orphan-conflicts">
    <span>
      {orphans.length} {orphans.length === 1 ? 'cópia local' : 'cópias locais'} de notas apagadas no servidor
      ({orphans.map((c) => c.title || c.noteID).join(', ')}) não {orphans.length === 1 ? 'foi mesclada' : 'foram mescladas'}.
    </span>
    <span class="banner-actions">
      <button class="ui-btn sm" type="button" onclick={() => exportAllConflicts(orphans)}>Baixar</button>
      <button class="ui-btn sm ghost" type="button" onclick={() => { for (const c of orphans) void offline.discardConflict(c.id); }}>Descartar</button>
    </span>
  </div>
{/if}
{#each books.banners as b (b.id)}
  <div class="banner" role="status">
    <span>{b.text}</span>
    <button class="ui-btn sm ghost" type="button" onclick={() => books.dismissBanner(b.id)}>{b.kind === 'dedupe' ? 'Manter' : 'ok'}</button>
  </div>
{/each}

<style>
  .banner {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--sp-3);
    flex-wrap: wrap;
    margin: var(--sp-1) var(--sp-2) 0;
    padding: 3px var(--sp-1) 3px var(--sp-3);
    min-height: 28px;
    background: var(--accent-wash);
    border: 1px solid var(--accent-soft);
    border-radius: var(--radius);
    font-size: var(--text-xs);
    animation: settle-in var(--spring-gentle-ms) var(--spring-gentle) both;
  }
  .banner.conflict {
    background: color-mix(in oklch, var(--color-warning) 10%, transparent);
    border-color: color-mix(in oklch, var(--color-warning) 40%, transparent);
  }
  .banner-actions { display: inline-flex; gap: var(--sp-1); flex-wrap: wrap; }
</style>
