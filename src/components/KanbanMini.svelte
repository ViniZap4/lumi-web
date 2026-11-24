<script lang="ts">
  // Read-only mini board (explorer preview, hover card): columns with
  // their first cards (lib/preview/structured-preview.ts). Click opens.
  import { miniBoard } from '../lib/preview/structured-preview.ts';

  const { text, onopen }: { text: string; onopen?: () => void } = $props();
  const lanes = $derived(miniBoard(text));
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="km" class:clickable={!!onopen} onclick={() => onopen?.()} data-testid="kanban-mini" title={onopen ? 'Open the board' : undefined}>
  {#each lanes as l, i (i)}
    <section class="km-lane">
      <header><span class="km-title">{l.title || 'Untitled'}</span><span class="km-count">{l.total}</span></header>
      <ul>
        {#each l.cards as c, j (j)}
          <li class:done={c.checked}>{c.text}</li>
        {/each}
        {#if l.total > l.cards.length}<li class="km-more">+{l.total - l.cards.length} more</li>{/if}
      </ul>
    </section>
  {:else}
    <div class="km-more">Empty board</div>
  {/each}
</div>

<style>
  .km { display: flex; gap: 8px; overflow: hidden; align-items: flex-start; }
  .km.clickable { cursor: pointer; }
  .km-lane { flex: 1 1 0; min-width: 0; border: 1px solid var(--color-border); border-radius: var(--radius-md, 8px); padding: 6px; font-size: var(--text-xs); }
  header { display: flex; justify-content: space-between; gap: 4px; font-weight: 600; margin-bottom: 4px; }
  .km-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .km-count { color: var(--color-text-dim); font-weight: 400; }
  ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
  li { border: 1px solid var(--color-border); border-radius: 4px; padding: 3px 5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  li.done { color: var(--color-text-dim); text-decoration: line-through; }
  .km-more { border: none; color: var(--color-text-dim); }
</style>
