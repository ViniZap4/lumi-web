<script lang="ts">
  // `?` overlay: the whole keymap on one sheet. j/k (↓/↑) scroll,
  // d/u (⌃d/⌃u) half a page, gg/G top/bottom; Esc, q, ? or any other
  // key closes it and focus returns to where it was.
  import { onMount, onDestroy, tick } from 'svelte';
  import { captureFocus } from '../lib/list-keys.ts';
  import { KEYMAP } from '../lib/keymap-help.ts';

  interface Props {
    onclose: () => void;
    leader?: string;
  }
  const { onclose, leader = '\\' }: Props = $props();

  let gridEl = $state<HTMLElement | null>(null);
  let sheetEl = $state<HTMLElement | null>(null);
  const restoreFocus = captureFocus();
  let lastG = 0;

  function scrollBy(dy: number | 'top' | 'bottom'): void {
    const el = gridEl;
    if (!el) return;
    if (dy === 'top') el.scrollTop = 0;
    else if (dy === 'bottom') el.scrollTop = el.scrollHeight;
    else el.scrollTop += dy;
  }

  function onKey(e: KeyboardEvent): void {
    if (e.metaKey || e.key === 'Shift' || e.key === 'Meta' || e.key === 'Control' || e.key === 'Alt') return;
    const half = Math.max(80, (gridEl?.clientHeight ?? 400) / 2);
    const k = e.key;
    let scrolled = true;
    if (e.ctrlKey) {
      if (k === 'd') scrollBy(half);
      else if (k === 'u') scrollBy(-half);
      else return;
    } else if (k === 'j' || k === 'ArrowDown') scrollBy(48);
    else if (k === 'k' || k === 'ArrowUp') scrollBy(-48);
    else if (k === 'd' || k === 'PageDown' || k === ' ') scrollBy(half);
    else if (k === 'u' || k === 'PageUp') scrollBy(-half);
    else if (k === 'G' || k === 'End') scrollBy('bottom');
    else if (k === 'Home') scrollBy('top');
    else if (k === 'g') {
      const now = Date.now();
      if (now - lastG < 800) { scrollBy('top'); lastG = 0; } else lastG = now;
    } else scrolled = false;
    e.preventDefault();
    e.stopPropagation();
    if (!scrolled) onclose();
  }
  onMount(() => {
    window.addEventListener('keydown', onKey, true);
    void tick().then(() => sheetEl?.focus({ preventScroll: true }));
  });
  onDestroy(() => {
    window.removeEventListener('keydown', onKey, true);
    restoreFocus();
  });
</script>

<div class="ui-scrim" role="presentation" onclick={onclose}>
  <div class="ui-sheet help" role="dialog" aria-modal="true" aria-labelledby="help-title" tabindex="-1" data-testid="help" bind:this={sheetEl}>
    <header class="head">
      <span class="title" id="help-title">Keys</span>
      <span class="hint">leader <kbd>{leader === '<Space>' ? 'space' : leader}</kbd> · <kbd>j</kbd><kbd>k</kbd> scroll · any other key closes</span>
      <button class="ui-btn ghost sm icon" type="button" aria-label="Close" onclick={onclose}>×</button>
    </header>
    <div class="grid" bind:this={gridEl}>
      {#each KEYMAP as sec (sec.title)}
        <section>
          <h3 class="ui-eyebrow">{sec.title}</h3>
          <dl>
            {#each sec.rows as [k, label] (k)}
              <dt>{k.replace('⟨leader⟩', leader === '<Space>' ? '␣' : leader)}</dt>
              <dd>{label}</dd>
            {/each}
          </dl>
        </section>
      {/each}
    </div>
  </div>
</div>

<style>
  .help { width: min(860px, 100%); max-height: 80vh; }
  .head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: var(--sp-4) var(--sp-5) var(--sp-2);
  }
  .title { font-weight: 650; font-size: var(--text-lg); }
  .head .hint { margin-left: auto; margin-right: var(--sp-2); }
  .hint { font-size: var(--text-xs); color: var(--color-text-dim); display: inline-flex; gap: 6px; align-items: center; }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: var(--sp-5) var(--sp-6);
    padding: var(--sp-3) var(--sp-5) var(--sp-5);
    overflow-y: auto;
  }
  h3 { color: var(--color-primary); margin-bottom: var(--sp-2); font-weight: 500; }
  dl { display: grid; grid-template-columns: max-content 1fr; gap: 5px var(--sp-4); }
  dt { font-family: var(--font-mono); font-size: var(--text-xs); color: var(--color-text); white-space: nowrap; }
  dd { font-size: var(--text-sm); color: var(--color-text-dim); }
</style>
