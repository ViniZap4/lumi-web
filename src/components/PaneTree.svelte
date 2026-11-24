<script lang="ts">
  // Recursive renderer for the pane tree (lib/pane-tree.ts). Leaves are
  // rendered by the `leaf` snippet the view supplies; splits lay their
  // children out with flex-basis from `sizes` and draggable dividers in
  // between. Dividers are ARIA separators: drag with the mouse, or
  // focus and use ←/→ (↑/↓ for stacked panes), Shift for big steps,
  // Home/End, and = / Enter to share the space equally.
  import type { Snippet } from 'svelte';
  import type { PaneNode, PaneLeaf } from '../lib/pane-tree.ts';
  import { MIN_SIZE } from '../lib/pane-tree.ts';
  import PaneTree from './PaneTree.svelte';

  interface Props {
    node: PaneNode;
    leaf: Snippet<[PaneLeaf]>;
    /** Move divider `index` of split `splitId` to `at` (0..1). */
    onresize: (splitId: string, index: number, at: number) => void;
    onequalize: () => void;
    /** Resize finished (persist). */
    onresized?: () => void;
  }
  const { node, leaf, onresize, onequalize, onresized }: Props = $props();

  let box = $state<HTMLElement | null>(null);
  let dragging = $state<number | null>(null);

  function startOf(i: number): number {
    if (node.kind !== 'split') return 0;
    return node.sizes.slice(0, i + 1).reduce((a, b) => a + b, 0);
  }

  function at(e: PointerEvent): number {
    const r = box?.getBoundingClientRect();
    if (!r || node.kind !== 'split') return 0.5;
    return node.dir === 'row' ? (e.clientX - r.left) / Math.max(1, r.width) : (e.clientY - r.top) / Math.max(1, r.height);
  }

  function down(i: number, e: PointerEvent): void {
    if (e.button !== 0 || node.kind !== 'split') return;
    e.preventDefault();
    dragging = i;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  }
  function move(i: number, e: PointerEvent): void {
    if (dragging !== i || node.kind !== 'split') return;
    onresize(node.id, i, at(e));
  }
  function up(): void {
    if (dragging == null) return;
    dragging = null;
    onresized?.();
  }
  function key(i: number, e: KeyboardEvent): void {
    if (node.kind !== 'split') return;
    const fwd = node.dir === 'row' ? ['ArrowRight', 'l'] : ['ArrowDown', 'j'];
    const back = node.dir === 'row' ? ['ArrowLeft', 'h'] : ['ArrowUp', 'k'];
    const step = e.shiftKey ? 0.1 : 0.02;
    const cur = startOf(i);
    let next: number | null = null;
    if (fwd.includes(e.key)) next = cur + step;
    else if (back.includes(e.key)) next = cur - step;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = 1;
    else if (e.key === '=' || e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      onequalize();
      onresized?.();
      return;
    }
    if (next == null) return;
    e.preventDefault();
    e.stopPropagation();
    onresize(node.id, i, next);
    onresized?.();
  }
</script>

{#if node.kind === 'leaf'}
  {@render leaf(node)}
{:else}
  <div class="pane-split" class:col={node.dir === 'col'} class:dragging={dragging != null} bind:this={box} data-split={node.id}>
    {#each node.children as c, i (c.id)}
      <div class="pane-cell" style="flex: {node.sizes[i]} 1 0px">
        <PaneTree node={c} {leaf} {onresize} {onequalize} {onresized} />
      </div>
      {#if i < node.children.length - 1}
        <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
        <div
          class="pane-divider"
          role="separator"
          tabindex="0"
          aria-orientation={node.dir === 'row' ? 'vertical' : 'horizontal'}
          aria-label="Resize panes"
          aria-valuemin={Math.round(MIN_SIZE * 100)}
          aria-valuemax={Math.round((1 - MIN_SIZE) * 100)}
          aria-valuenow={Math.round(startOf(i) * 100)}
          data-testid="pane-divider"
          onpointerdown={(e) => down(i, e)}
          onpointermove={(e) => move(i, e)}
          onpointerup={up}
          onpointercancel={up}
          ondblclick={() => { onequalize(); onresized?.(); }}
          onkeydown={(e) => key(i, e)}
        ><span class="grip" aria-hidden="true"></span></div>
      {/if}
    {/each}
  </div>
{/if}

<style>
  .pane-split {
    display: flex;
    flex-direction: row;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
  }
  .pane-split.col { flex-direction: column; }
  .pane-split.dragging { cursor: col-resize; user-select: none; }
  .pane-split.col.dragging { cursor: row-resize; }
  .pane-cell {
    position: relative;
    min-width: 0;
    min-height: 0;
    display: flex;
  }
  .pane-cell > :global(*) { flex: 1; min-width: 0; min-height: 0; }
  .pane-divider {
    flex: none;
    position: relative;
    width: 1px;
    background: var(--hairline);
    cursor: col-resize;
    outline: none;
    z-index: 2;
    touch-action: none;
    transition: background 120ms var(--ease);
  }
  .col > .pane-divider { width: auto; height: 1px; cursor: row-resize; }
  /* A generous invisible hit area around the hairline. */
  .pane-divider::before { content: ''; position: absolute; inset: 0 -5px; }
  .col > .pane-divider::before { inset: -5px 0; }
  .grip {
    position: absolute;
    top: 50%;
    left: 50%;
    width: 4px;
    height: 28px;
    border-radius: 4px;
    transform: translate(-50%, -50%);
    background: var(--color-text-dim);
    opacity: 0;
    transition: opacity 120ms var(--ease);
  }
  .col > .pane-divider .grip { width: 28px; height: 4px; }
  .pane-divider:hover, .pane-divider:focus-visible, .dragging > .pane-divider { background: color-mix(in srgb, var(--color-primary) 60%, transparent); }
  .pane-divider:hover .grip, .pane-divider:focus-visible .grip { opacity: 0.55; }
  .pane-divider:focus-visible { box-shadow: 0 0 0 2px var(--ring); }
</style>
