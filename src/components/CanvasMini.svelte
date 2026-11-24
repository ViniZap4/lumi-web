<script lang="ts">
  // Read-only, fit-to-bounds mini canvas (explorer preview, hover card):
  // groups, cards, edges and colors from lib/preview/structured-preview.ts.
  // No interaction except click-to-open. Text cards use the compact prose
  // renderer on small canvases; big ones are drawn as boxes.
  import { miniCanvas } from '../lib/preview/structured-preview.ts';
  import { renderMarkdown } from '../lib/markdown.ts';

  const { text, onopen }: { text: string; onopen?: () => void } = $props();
  const m = $derived(miniCanvas(text));
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="cm" class:clickable={!!onopen} onclick={() => onopen?.()} data-testid="canvas-mini" title={onopen ? 'Open the canvas' : undefined}>
  {#if m.error}
    <div class="cm-note">Invalid canvas JSON ({m.error})</div>
  {:else if m.nodeCount === 0}
    <div class="cm-note">Empty canvas</div>
  {:else}
    <svg viewBox={m.viewBox} preserveAspectRatio="xMidYMid meet" aria-label="Canvas preview: {m.nodeCount} nodes, {m.edgeCount} edges" role="img">
      {#each m.groups as g (g.id)}
        <rect class="cm-group" x={g.x} y={g.y} width={g.width} height={g.height} rx="12" style={g.color ? `--c: ${g.color}` : ''} />
        {#if g.label && !m.simplified}<text class="cm-glabel" x={g.x + 12} y={g.y - 10}>{g.label}</text>{/if}
      {/each}
      {#each m.edges as e (e.id)}
        <path class="cm-edge" d={e.d} style={e.color ? `--c: ${e.color}` : ''} />
      {/each}
      {#each m.cards as n (n.id)}
        <rect class="cm-card" class:colored={!!n.color} x={n.x} y={n.y} width={n.width} height={n.height} rx="10" style={n.color ? `--c: ${n.color}` : ''} />
        {#if !m.simplified}
          {#if n.text != null}
            <foreignObject x={n.x} y={n.y} width={n.width} height={n.height}>
              <div class="cm-text lumi-prose compact md-body">{@html renderMarkdown(n.text)}</div>
            </foreignObject>
          {:else if n.label}
            <text class="cm-label" x={n.x + 14} y={n.y + 30}>{n.type === 'file' ? '▤ ' : n.type === 'link' ? '↗ ' : ''}{n.label}</text>
          {/if}
        {/if}
      {/each}
    </svg>
    <div class="cm-meta">{m.nodeCount} nodes · {m.edgeCount} edges{m.simplified ? ' · simplified' : ''}</div>
  {/if}
</div>

<style>
  .cm {
    --canvas-1: var(--color-error);
    --canvas-2: color-mix(in oklch, var(--color-error) 50%, var(--color-warning));
    --canvas-3: var(--color-warning);
    --canvas-4: color-mix(in oklch, var(--color-info) 50%, var(--color-warning));
    --canvas-5: var(--color-info);
    --canvas-6: var(--color-secondary);
    position: relative;
    height: 100%;
    min-height: 160px;
    display: flex;
    flex-direction: column;
  }
  .cm.clickable { cursor: pointer; }
  svg { flex: 1; min-height: 0; width: 100%; }
  .cm-group { fill: color-mix(in srgb, var(--c, var(--color-text)) 5%, transparent); stroke: color-mix(in srgb, var(--c, var(--color-border)) 70%, transparent); stroke-width: 3; vector-effect: non-scaling-stroke; }
  .cm-glabel { fill: var(--color-text-dim); font-size: 28px; }
  .cm-edge { fill: none; stroke: var(--c, color-mix(in srgb, var(--color-text) 38%, transparent)); stroke-width: 1.2; vector-effect: non-scaling-stroke; }
  .cm-card { fill: color-mix(in srgb, var(--color-text) 3%, var(--color-background)); stroke: color-mix(in srgb, var(--c, var(--color-border)) 80%, transparent); stroke-width: 1; vector-effect: non-scaling-stroke; }
  .cm-card.colored { fill: color-mix(in srgb, var(--c) 10%, var(--color-background)); }
  .cm-label { fill: var(--color-text); font-size: 22px; }
  .cm-text { padding: 10px 14px; overflow: hidden; height: 100%; box-sizing: border-box; pointer-events: none; }
  .cm-meta, .cm-note { font-size: var(--text-xs); color: var(--color-text-dim); padding: 4px 2px; }
</style>
