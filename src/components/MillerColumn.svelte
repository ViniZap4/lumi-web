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
  import { noteIconKind, disambiguateTitles } from '../lib/note-icons.ts';
  import { peekNote } from '../lib/note-content.ts';
  import NoteIcon from './NoteIcon.svelte';

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
    /** Key of the yanked row (y/p), marked. */
    yankedKey?: string | null;
    emptyText?: string;
    onpick?: (index: number, entry: Entry) => void;
    onopen?: (index: number, entry: Entry) => void;
    /** Right-click on a row (context menu). */
    oncontext?: (index: number, entry: Entry, ev: MouseEvent) => void;
    /** A note row (by key) was dropped onto a folder row. */
    ondropnote?: (noteKey: string, target: Entry) => void;
    /** Row height in px (touch sheets use taller rows). */
    rowHeight?: number;
    element?: HTMLElement | null;
  }

  let {
    entries,
    cursor,
    label,
    idPrefix,
    active = false,
    openKey = null,
    yankedKey = null,
    emptyText = 'Empty folder',
    onpick,
    onopen,
    oncontext,
    ondropnote,
    rowHeight = ROW_HEIGHT,
    element = $bindable(null),
  }: Props = $props();

  let scrollTop = $state(0);
  let viewH = $state(0);

  const view = $derived(viewH > 0 ? viewH : FALLBACK_VIEW);
  const start = $derived(Math.max(0, Math.floor(scrollTop / rowHeight) - OVERSCAN));
  const end = $derived(Math.min(entries.length, Math.ceil((scrollTop + view) / rowHeight) + OVERSCAN));
  const visible = $derived(entries.slice(start, end));
  // Kind glyphs + "name · canvas" when a canvas and a note share a name.
  const kinds = $derived(entries.map((e) => (e.kind === 'note' ? noteIconKind(e.note, peekNote(e.note.vault_id, e.note.id)?.content) : null)));
  const names = $derived(disambiguateTitles(entries.map((e, i) => ({ name: e.name, kind: kinds[i] }))));

  /** Rows that fit in the viewport (page size for PgUp/PgDn). */
  export function pageRows(): number {
    return Math.max(1, Math.floor(view / rowHeight) - 1);
  }

  /** Rows kept between the cursor and the viewport edge (scrolloff). */
  const SCROLLOFF = 2;

  function reducedMotion(): boolean {
    try {
      return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    } catch {
      return false;
    }
  }

  // Keep the cursor row in view (with a small scrolloff); clamp when the
  // list shrinks. Runs on cursor/list/viewport changes only — NOT on
  // scroll, so wheel/drag scrolling away from the cursor is not snapped
  // back. Short hops animate; long jumps (G, ⌃d) are instant so the
  // virtual window never shows blank rows mid-animation.
  $effect(() => {
    const max = Math.max(0, entries.length * rowHeight - view);
    const prev = untrack(() => scrollTop);
    let top = Math.min(prev, max);
    if (cursor >= 0) {
      const margin = Math.min(SCROLLOFF * rowHeight, Math.max(0, (view - rowHeight) / 2));
      const rowTop = cursor * rowHeight;
      if (rowTop - margin < top) top = Math.max(0, rowTop - margin);
      else if (rowTop + rowHeight + margin > top + view) top = Math.min(max, rowTop + rowHeight + margin - view);
    }
    if (top !== scrollTop) scrollTop = top;
    if (element && element.scrollTop !== top) {
      const near = Math.abs(element.scrollTop - top) <= rowHeight * 4;
      if (near && typeof element.scrollTo === 'function' && !reducedMotion()) element.scrollTo({ top, behavior: 'smooth' });
      else element.scrollTop = top;
    }
  });

  const DRAG_TYPE = 'text/x-lumi-key';
  let dropKey = $state<string | null>(null);

  function hasLumiKey(ev: DragEvent): boolean {
    return !!ev.dataTransfer && [...ev.dataTransfer.types].includes(DRAG_TYPE);
  }
  function onDragStart(ev: DragEvent, e: Entry): void {
    if (e.kind !== 'note' || !ev.dataTransfer) return;
    ev.dataTransfer.setData(DRAG_TYPE, e.key);
    ev.dataTransfer.effectAllowed = 'move';
  }
  function onDragOver(ev: DragEvent, e: Entry): void {
    if (e.kind !== 'folder' || !ondropnote || !hasLumiKey(ev)) return;
    ev.preventDefault();
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move';
    dropKey = e.key;
  }
  function onDrop(ev: DragEvent, e: Entry): void {
    dropKey = null;
    if (e.kind !== 'folder' || !ondropnote) return;
    const k = ev.dataTransfer?.getData(DRAG_TYPE);
    if (!k) return;
    ev.preventDefault();
    ondropnote(k, e);
  }

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
    <div class="spacer" style="height: {entries.length * rowHeight}px">
      {#if active && cursor >= 0}
        <!-- The cursor highlight glides between rows (spring); rows keep
             their own .cursor styling as the static fallback. -->
        <div class="glide" aria-hidden="true" style="transform: translateY({cursor * rowHeight}px); height: {rowHeight}px"></div>
      {/if}
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
          class:virtual={e.kind === 'folder' && e.virtual}
          class:yanked={yankedKey != null && e.key === yankedKey}
          class:drop-target={dropKey === e.key}
          role="option"
          tabindex="-1"
          aria-selected={i === cursor}
          aria-setsize={entries.length}
          aria-posinset={i + 1}
          style="top: {i * rowHeight}px; height: {rowHeight}px"
          data-key={e.key}
          data-hint-target
          draggable={e.kind === 'note' && !!ondropnote ? 'true' : undefined}
          onclick={() => onpick?.(i, e)}
          ondblclick={() => onopen?.(i, e)}
          oncontextmenu={(ev) => { if (oncontext) { ev.preventDefault(); oncontext(i, e, ev); } }}
          ondragstart={(ev) => onDragStart(ev, e)}
          ondragover={(ev) => onDragOver(ev, e)}
          ondragleave={() => { if (dropKey === e.key) dropKey = null; }}
          ondrop={(ev) => onDrop(ev, e)}
          ondragend={() => (dropKey = null)}
        >
          <span class="icon" aria-hidden="true">
            <NoteIcon kind={e.kind === 'folder' ? 'folder' : (kinds[i] ?? 'markdown')} />
          </span>
          <span class="name">{names[i] ?? e.name}</span>
          {#if e.kind === 'folder'}
            <span class="count" aria-hidden="true">{e.virtual ? 'new' : e.count}</span>
            <span class="chev" aria-hidden="true">›</span>
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
    padding: 0 4px;
  }
  .spacer {
    position: relative;
    margin: 4px 0;
  }
  .row {
    position: absolute;
    left: 0;
    right: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 8px;
    box-sizing: border-box;
    cursor: pointer;
    border-radius: var(--radius-sm);
    color: var(--color-text);
    font-size: var(--text-sm);
    user-select: none;
  }
  .row:hover { background: var(--tint-hover); }
  .row.cursor { background: var(--tint-hover); }
  .miller-col.active .row.cursor {
    background: transparent;
  }
  .glide {
    position: absolute;
    left: 0;
    right: 0;
    top: 0;
    border-radius: var(--radius-sm);
    background: var(--tint-active);
    box-shadow: inset 2px 0 0 var(--color-primary);
    transition: transform var(--dur-1, 140ms) var(--spring-snappy, cubic-bezier(0.2, 0.9, 0.3, 1.1));
    will-change: transform;
    pointer-events: none;
  }
  .miller-col.active:focus-visible .glide { box-shadow: inset 2px 0 0 var(--color-primary), inset 0 0 0 1px var(--ring); }
  .row.open .name { color: var(--color-primary); font-weight: 550; }
  .row.yanked .name { text-decoration: underline dashed var(--color-warning); text-underline-offset: 3px; }
  .row.virtual { opacity: 0.75; }
  .row.drop-target {
    background: var(--tint-active);
    outline: 1px dashed var(--color-primary);
    outline-offset: -1px;
  }
  .row.virtual .icon { color: var(--color-warning); }
  .icon {
    width: 14px;
    height: 14px;
    flex: none;
    display: inline-flex;
    color: var(--color-text-dim);
  }
  .row.folder .icon { color: var(--color-secondary); }
  .row.cursor .icon { color: var(--color-primary); }
  .name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .count {
    flex: none;
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    color: var(--color-text-dim);
  }
  .chev { flex: none; color: var(--color-text-dim); font-size: 14px; line-height: 1; margin-left: -2px; }
  .empty {
    padding: var(--sp-5) var(--sp-3);
    color: var(--color-text-dim);
    font-size: var(--text-xs);
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
