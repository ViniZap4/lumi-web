<script lang="ts">
  // Which-key style legend: one line of the keys that matter in the
  // current context (lib/legend.ts decides which, in priority order).
  // Items are measured and as many as fit are shown (fitLegend) — a
  // wide window gets the extras, a narrow one the core; only when
  // something is left out does the line end in a "more" marker that
  // opens the full `?` reference. Items with an action are buttons, so
  // mouse users can trigger what the keys do.
  import { tick } from 'svelte';
  import { fitLegend, type LegendItem } from '../lib/legend.ts';
  import { stagger } from '../lib/motion.ts';
  import { keyLabel } from '../lib/platform.ts';

  interface Props {
    items: readonly LegendItem[];
    /** Typed-but-unfinished input (`g`, `5`, the leader). */
    pending?: string | null;
    /** Short mode/context label at the left (NORMAL, EXPLORER…). */
    mode?: string | null;
    /** Run an item's action (click). */
    onaction?: (item: LegendItem) => void;
    /** The overflow marker (opens the full keymap). */
    onmore?: () => void;
    /** Inside another bar (the explorer footer): no bar chrome. */
    embedded?: boolean;
  }
  const { items, pending = null, mode = null, onaction, onmore, embedded = false }: Props = $props();

  /** Must match `.items { gap }` and the `.more` width below. */
  const GAP = 16;
  const MORE_W = 34;

  let wrap = $state<HTMLElement | null>(null);
  let measure = $state<HTMLElement | null>(null);
  let avail = $state(0);
  let widths = $state<number[]>([]);

  $effect(() => {
    const el = wrap;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => (avail = el.clientWidth));
    ro.observe(el);
    avail = el.clientWidth;
    return () => ro.disconnect();
  });

  // Re-measure when the item set changes (fonts are system stacks, so
  // widths are stable once laid out).
  $effect(() => {
    void items;
    void tick().then(() => {
      if (!measure) return;
      widths = Array.from(measure.children).map((c) => (c as HTMLElement).getBoundingClientRect().width);
    });
  });

  const fit = $derived.by(() => {
    if (avail <= 0 || widths.length !== items.length || widths.every((w) => w === 0)) {
      return { shown: items.map((_, i) => i), overflow: false };
    }
    return fitLegend(widths, avail, GAP, onmore ? MORE_W : 0);
  });
  const shown = $derived(fit.shown.map((i) => items[i]));

  // The new context's keys ripple in (not on every key).
  let lastMode: string | null = null;
  $effect(() => {
    const m = mode;
    if (m === lastMode) return;
    lastMode = m;
    void tick().then(() => { if (wrap) stagger(wrap.children, { step: 12, max: 96, y: 3 }); });
  });

  function tipOf(it: LegendItem): string {
    return keyLabel(it.tip ?? `${it.label} (${it.keys})`);
  }
</script>

<div class="legend" class:embedded class:pending={!!pending} role="toolbar" aria-label="Command legend" data-hint-skip data-testid="command-legend">
  {#if mode}<span class="mode" data-mode={mode.toLowerCase()}>{mode}</span>{/if}
  {#if pending}<span class="typed" aria-live="polite">{pending}<span class="caret">…</span></span>{/if}
  <span class="items" bind:this={wrap}>
    {#each shown as it (it.keys + it.label)}
      {#if it.do && onaction}
        <button type="button" class="item act" tabindex="-1" title={tipOf(it)} onclick={() => onaction(it)}
          ><span class="keys">{keyLabel(it.keys)}</span><span class="label">{it.label}</span></button>
      {:else}
        <span class="item" title={tipOf(it)}><span class="keys">{keyLabel(it.keys)}</span><span class="label">{it.label}</span></span>
      {/if}
    {/each}
    {#if fit.overflow && onmore}
      <button type="button" class="more" tabindex="-1" title="More keys (?)" aria-label="All keyboard shortcuts" onclick={onmore}>⋯</button>
    {/if}
  </span>
  <!-- Off-screen twin used only to measure item widths. -->
  <span class="measure" aria-hidden="true" bind:this={measure}>
    {#each items as it (it.keys + it.label)}
      <span class="item"><span class="keys">{keyLabel(it.keys)}</span><span class="label">{it.label}</span></span>
    {/each}
  </span>
</div>

<style>
  .legend {
    position: relative;
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    height: var(--bar-h);
    padding: 0 var(--sp-3);
    border-top: 1px solid var(--hairline);
    background: color-mix(in srgb, var(--color-overlay-bg) 45%, var(--color-background));
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    color: var(--color-text-dim);
    overflow: hidden;
    white-space: nowrap;
    user-select: none;
  }
  .legend.embedded { flex: 1; min-width: 0; height: auto; padding: 0; border: none; background: transparent; }
  /* Touch-only devices have no keys to show. */
  @media (hover: none) and (pointer: coarse) {
    .legend { display: none; }
  }
  .mode {
    flex: none;
    padding: 1px 6px;
    border-radius: 4px;
    background: var(--tint-active);
    color: var(--color-primary);
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .mode[data-mode='insert'] {
    background: color-mix(in srgb, var(--color-accent) 16%, transparent);
    color: var(--color-accent);
  }
  .mode[data-mode='visual'] {
    background: color-mix(in srgb, var(--color-secondary) 16%, transparent);
    color: var(--color-secondary);
  }
  .typed {
    flex: none;
    color: var(--color-warning);
    font-weight: 600;
  }
  .caret { opacity: 0.6; }
  .items {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 16px;
    overflow: hidden;
  }
  .item {
    flex: none;
    display: inline-flex;
    gap: 6px;
    align-items: baseline;
  }
  button.item, .more {
    height: 20px;
    margin: 0 -5px;
    padding: 0 5px;
    border: none;
    border-radius: 4px;
    background: transparent;
    font: inherit;
    color: inherit;
    cursor: pointer;
    align-items: center;
    transition: background 100ms var(--ease), color 100ms var(--ease);
  }
  button.item:hover, .more:hover { background: var(--tint-hover); }
  button.item:hover .label { color: var(--color-text); }
  button.item:active { background: var(--tint-active); }
  .more { flex: none; margin-left: auto; width: 24px; color: var(--color-text-dim); font-weight: 700; }
  .keys { color: var(--color-text); font-weight: 600; }
  .legend.pending .keys { color: var(--color-warning); }
  .label { color: var(--color-text-dim); }
  .measure {
    position: absolute;
    left: 0;
    top: 0;
    display: flex;
    gap: 16px;
    visibility: hidden;
    pointer-events: none;
  }
</style>
