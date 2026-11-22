<script lang="ts">
  // One miller column: a virtualised single-select listbox.
  //
  // Only the rows in (and just around) the viewport are in the DOM, so
  // a folder with 10k notes renders ~50 nodes. Rows have a fixed
  // height; the spacer keeps the scrollbar honest. The cursor row is
  // always scrolled into view, which also guarantees the element that
  // `aria-activedescendant` points at exists. Keyboard handling lives
  // in the parent view (one dispatcher for the whole browser); this
  // component only renders and reports clicks.
  import { untrack } from 'svelte';
  import type { Entry } from '../lib/notetree.ts';

  export const ROW_HEIGHT = 30;
  const OVERSCAN = 8;
  /** Viewport assumed before layout (and in jsdom, which has none). */
  const FALLBACK_VIEW = 600;

  interface Props {
    entries: readonly Entry[];
    cursor: number;
    label: string;
    idPrefix: string;
    /** The keyboard column: focusable, exposes the active row. */
    active?: boolean;
    /** Key of the note open in the reader (extra highlight). */
    openKey?: string | null;
    emptyText?: string;
    onpick?: (index: number, entry: Entry) => void;
    onopen?: (index: number, entry: Entry) => void;
    element?: HTMLElement | null;
  }

  let {
    entries,
    cursor,
    label,
    idPrefix,
    active = false,
    openKey = null,
    emptyText = 'Empty folder',
    onpick,
    onopen,
    element = $bindable(null),
  }: Props = $props();

  let scrollTop = $state(0);
  let viewH = $state(0);

  const view = $derived(viewH > 0 ? viewH : FALLBACK_VIEW);
  const start = $derived(Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN));
  const end = $derived(Math.min(entries.length, Math.ceil((scrollTop + view) / ROW_HEIGHT) + OVERSCAN));
  const visible = $derived(entries.slice(start, end));

  /** Rows that fit in the viewport (page size for PgUp/PgDn). */
  export function pageRows(): number {
    return Math.max(1, Math.floor(view / ROW_HEIGHT) - 1);
  }

  // Keep the cursor row in view; clamp when the list shrinks. Runs on
  // cursor/list/viewport changes only — NOT on scroll, so wheel/drag
  // scrolling away from the cursor is not snapped back.
  $effect(() => {
    const max = Math.max(0, entries.length * ROW_HEIGHT - view);
    let top = Math.min(untrack(() => scrollTop), max);
    if (cursor >= 0) {
      const rowTop = cursor * ROW_HEIGHT;
      if (rowTop < top) top = rowTop;
      else if (rowTop + ROW_HEIGHT > top + view) top = rowTop + ROW_HEIGHT - view;
    }
    if (top !== scrollTop) scrollTop = top;
    if (element && element.scrollTop !== top) element.scrollTop = top;
  });

  function onscroll(): void {
    if (element) scrollTop = element.scrollTop;
  }
</script>

<div
  class="miller-col"
  class:active
  role="listbox"
  aria-label={label}
  tabindex={active ? 0 : -1}
  aria-activedescendant={active && cursor >= 0 && cursor < entries.length ? `${idPrefix}-${cursor}` : undefined}
  bind:this={element}
  bind:clientHeight={viewH}
  {onscroll}
  data-testid="col-{idPrefix}"
>
  {#if entries.length === 0}
    <div class="empty" role="presentation">{emptyText}</div>
  {:else}
    <div class="spacer" style="height: {entries.length * ROW_HEIGHT}px">
      {#each visible as e, j (e.key)}
        {@const i = start + j}
        <!-- Keyboard is handled by the view's dispatcher on the listbox
             (aria-activedescendant), so rows only need pointer events. -->
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <div
          id="{idPrefix}-{i}"
          class="row"
          class:cursor={i === cursor}
          class:open={openKey != null && e.key === openKey}
          class:folder={e.kind === 'folder'}
          role="option"
          tabindex="-1"
          aria-selected={i === cursor}
          aria-setsize={entries.length}
          aria-posinset={i + 1}
          style="top: {i * ROW_HEIGHT}px; height: {ROW_HEIGHT}px"
          data-key={e.key}
          onclick={() => onpick?.(i, e)}
          ondblclick={() => onopen?.(i, e)}
        >
          <span class="icon" aria-hidden="true">{e.kind === 'folder' ? '▸' : '·'}</span>
          <span class="name">{e.name}</span>
          {#if e.kind === 'folder'}
            <span class="count" aria-hidden="true">{e.count}</span>
            <span class="sr-only">, folder, {e.count} items</span>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .miller-col {
    position: relative;
    overflow-y: auto;
    overflow-x: hidden;
    height: 100%;
    min-height: 0;
    outline: none;
  }
  .miller-col.active:focus-visible {
    box-shadow: inset 0 0 0 1px var(--color-secondary);
  }
  .spacer {
    position: relative;
  }
  .row {
    position: absolute;
    left: 0;
    right: 0;
    display: flex;
    align-items: center;
    gap: 0.45rem;
    padding: 0 0.6rem;
    box-sizing: border-box;
    cursor: pointer;
    border-left: 2px solid transparent;
    color: var(--color-text);
    font-size: 0.88rem;
    user-select: none;
  }
  .row:hover {
    background: var(--color-overlay-bg, transparent);
  }
  .row.cursor {
    background: var(--color-selected-bg, var(--color-overlay-bg));
  }
  .miller-col.active .row.cursor {
    border-left-color: var(--color-primary);
  }
  .row.open .name {
    color: var(--color-primary);
  }
  .row.folder .name {
    color: var(--color-secondary);
    font-weight: 500;
  }
  .icon {
    width: 0.8rem;
    flex: none;
    color: var(--color-text-dim, var(--color-muted));
  }
  .name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .count {
    flex: none;
    font-size: 0.72rem;
    color: var(--color-text-dim, var(--color-muted));
  }
  .empty {
    padding: 1rem;
    color: var(--color-text-dim, var(--color-muted));
    font-size: 0.82rem;
    text-align: center;
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
</style>
