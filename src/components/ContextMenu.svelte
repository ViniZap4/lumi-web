<script lang="ts">
  // Right-click / ⇧F10 menu. Every item shows the key that does the
  // same thing (lib/context-actions.ts), and that key works here as a
  // mnemonic. j/k/↑/↓ move, Enter/l/Space run, Esc/q/h close, Tab
  // stays inside; focus returns to where it was.
  import { onMount, tick, untrack } from 'svelte';
  import { mnemonic, type MenuItem } from '../lib/context-actions.ts';
  import { listKey, newChord, captureFocus } from '../lib/list-keys.ts';

  interface Props {
    x: number;
    y: number;
    items: readonly MenuItem[];
    title?: string;
    onrun: (item: MenuItem) => void;
    onclose: () => void;
  }
  const { x, y, items, title = 'Actions', onrun, onclose }: Props = $props();

  let menu = $state<HTMLElement | null>(null);
  let cursor = $state(untrack(() => items.findIndex((i) => !i.disabled)));
  let pos = $state({ left: 0, top: 0 });
  const chord = newChord();
  let restore: () => void = () => {};

  onMount(() => {
    restore = captureFocus();
    pos = { left: x, top: y };
    void tick().then(() => {
      if (!menu) return;
      // Keep the menu on screen.
      const r = menu.getBoundingClientRect();
      const w = window.innerWidth;
      const h = window.innerHeight;
      pos = {
        left: Math.max(8, Math.min(x, w - r.width - 8)),
        top: y + r.height > h - 8 ? Math.max(8, y - r.height) : y,
      };
      focusItem();
    });
    const away = (e: PointerEvent) => {
      if (menu && !menu.contains(e.target as Node)) close();
    };
    window.addEventListener('pointerdown', away, true);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('pointerdown', away, true);
      window.removeEventListener('blur', close);
    };
  });

  function focusItem(): void {
    menu?.querySelector<HTMLElement>(`[data-i="${cursor}"]`)?.focus({ preventScroll: true });
  }

  function close(): void {
    onclose();
    restore();
  }

  function run(it: MenuItem): void {
    if (it.disabled) return;
    onclose();
    restore();
    onrun(it);
  }

  function step(from: number, dir: 1 | -1): number {
    for (let i = 1; i <= items.length; i++) {
      const j = (from + dir * i + items.length) % items.length;
      if (!items[j].disabled) return j;
    }
    return from;
  }

  function onkeydown(e: KeyboardEvent): void {
    e.stopPropagation();
    if (e.key === 'Tab') {
      e.preventDefault();
      cursor = step(cursor, e.shiftKey ? -1 : 1);
      focusItem();
      return;
    }
    if (e.key === 'h' || e.key === 'ArrowLeft') {
      e.preventDefault();
      close();
      return;
    }
    // A mnemonic (the item's own key) runs it directly — except the
    // list keys themselves.
    if (!['j', 'k', 'g', 'G', 'l', ' ', 'Enter', 'q'].includes(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const m = mnemonic(items, e.key);
      if (m) {
        e.preventDefault();
        run(m);
        return;
      }
    }
    const r = listKey(e, cursor, items.length, { chord });
    if (!r) return;
    e.preventDefault();
    if (r.action === 'close') return close();
    if (r.action === 'activate') {
      const it = items[cursor];
      if (it) run(it);
      return;
    }
    // Skip disabled rows in the direction of travel.
    let i = r.index;
    if (items[i]?.disabled) i = step(i, r.index >= cursor ? 1 : -1);
    cursor = i;
    focusItem();
  }
</script>

<div
  class="ctx-menu"
  role="menu"
  aria-label={title}
  tabindex="-1"
  bind:this={menu}
  style="left: {pos.left}px; top: {pos.top}px"
  {onkeydown}
  data-testid="context-menu"
>
  <div class="ctx-title" aria-hidden="true">{title}</div>
  {#each items as it, i (it.id)}
    {#if it.sep}<div class="ctx-sep" role="separator"></div>{/if}
    <button
      type="button"
      role="menuitem"
      class="ctx-item"
      class:danger={it.danger}
      class:cursor={i === cursor}
      data-i={i}
      tabindex={i === cursor ? 0 : -1}
      aria-disabled={it.disabled ? 'true' : undefined}
      aria-keyshortcuts={it.keys && it.keys !== '⏎' ? it.keys.split(' ')[0] : undefined}
      onclick={() => run(it)}
      onpointermove={() => { if (!it.disabled && cursor !== i) { cursor = i; focusItem(); } }}
    >
      <span class="ctx-label">{it.label}</span>
      {#if it.keys}<kbd>{it.keys}</kbd>{/if}
    </button>
  {/each}
</div>

<style>
  .ctx-menu {
    position: fixed;
    z-index: 400;
    min-width: 210px;
    max-width: 300px;
    padding: 4px;
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    background: var(--color-background);
    box-shadow: var(--shadow-pop);
    outline: none;
    animation: ctx-in 120ms var(--ease);
    transform-origin: top left;
  }
  @keyframes ctx-in { from { opacity: 0; transform: scale(0.97) translateY(-2px); } }
  .ctx-title {
    padding: 4px 8px 4px;
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    color: var(--color-text-dim);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ctx-sep { height: 1px; margin: 4px 6px; background: var(--hairline); }
  .ctx-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-4);
    width: 100%;
    height: 28px;
    padding: 0 8px;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text);
    font-size: var(--text-sm);
    text-align: left;
    cursor: pointer;
  }
  .ctx-item.cursor { background: var(--tint-active); }
  .ctx-item:focus-visible { outline: none; box-shadow: inset 0 0 0 1px var(--ring); }
  .ctx-item[aria-disabled='true'] { color: var(--color-text-dim); cursor: default; opacity: 0.6; }
  .ctx-item.danger:not([aria-disabled='true']) { color: var(--color-error); }
  .ctx-item.danger.cursor { background: color-mix(in srgb, var(--color-error) 14%, transparent); }
  .ctx-item kbd { opacity: 0.85; }
</style>
