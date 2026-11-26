<script lang="ts">
  // Zoom / unzoom the primary pane (shown only with several panes).
  import { useWorkspace } from './context.ts';

  const ws = useWorkspace();
  const pn = ws.panes;
  const on = $derived(pn.zoomed === pn.primaryLeaf);
</script>

<button class="ui-btn ghost sm icon zoom-btn" class:on type="button" onclick={() => pn.toggleZoom(pn.primaryLeaf)} aria-pressed={on} aria-label={on ? 'Unzoom pane' : 'Zoom pane'} title="{on ? 'Unzoom' : 'Zoom'} (⌃w z · :zoom · double-click the header)">
  {#if on}<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M6.5 2.5v4h-4M9.5 13.5v-4h4M2.5 2.5l4 4M13.5 13.5l-4-4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>{:else}<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M9.5 2.5h4v4M6.5 13.5h-4v-4M13.5 2.5l-4.5 4.5M2.5 13.5 7 9" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>{/if}
</button>

<style>
  .zoom-btn.on { color: var(--accent-ink); background: var(--accent-soft); }
</style>
