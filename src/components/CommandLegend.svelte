<script lang="ts">
  // Which-key style legend: one compact line of the keys that matter in
  // the current context (lib/legend.ts decides which). While a key
  // sequence is pending the line shows its completions, led by the
  // typed prefix. Decorative for assistive tech — the same keys are in
  // the `?` help, which is the accessible reference.
  import type { LegendItem } from '../lib/legend.ts';

  interface Props {
    items: readonly LegendItem[];
    /** Typed-but-unfinished input (`g`, `5`, the leader). */
    pending?: string | null;
    /** Short mode/context label at the left (NORMAL, EXPLORER…). */
    mode?: string | null;
  }
  const { items, pending = null, mode = null }: Props = $props();
</script>

<div class="legend" class:pending={!!pending} aria-hidden="true" data-testid="command-legend">
  {#if mode}<span class="mode" data-mode={mode.toLowerCase()}>{mode}</span>{/if}
  {#if pending}<span class="typed">{pending}<span class="caret">…</span></span>{/if}
  <span class="items">
    {#each items as it (it.keys + it.label)}
      <span class="item"><span class="keys">{it.keys}</span><span class="label">{it.label}</span></span>
    {/each}
  </span>
</div>

<style>
  .legend {
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
    display: flex;
    gap: var(--sp-4);
    overflow: hidden;
    mask-image: linear-gradient(to right, #000 calc(100% - 32px), transparent);
  }
  .item {
    display: inline-flex;
    gap: 6px;
    align-items: baseline;
  }
  .keys { color: var(--color-text); font-weight: 600; }
  .legend.pending .keys { color: var(--color-warning); }
  .label { color: var(--color-text-dim); }
</style>
