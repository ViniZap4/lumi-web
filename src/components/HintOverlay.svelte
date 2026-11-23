<script lang="ts">
  // Hint mode (`f` in the explorer, `F` anywhere): every visible
  // clickable thing gets a home-row label; typing it clicks the target
  // (text fields get focus instead). Esc cancels, Backspace un-types.
  import { onMount } from 'svelte';
  import { hintLabels, filterHints, collectHintTargets } from '../lib/hints.ts';

  interface Props {
    /** Where to look for targets. */
    root: () => HTMLElement | null;
    onclose: () => void;
  }
  const { root, onclose }: Props = $props();

  let targets = $state<{ el: HTMLElement; left: number; top: number }[]>([]);
  let labels = $state<string[]>([]);
  let typed = $state('');
  const live = $derived(new Set(filterHints(labels, typed).live));

  onMount(() => {
    const r = root();
    const els = r ? collectHintTargets(r) : [];
    targets = els.map((el) => {
      const b = el.getBoundingClientRect();
      return { el, left: Math.max(2, b.left), top: Math.max(2, b.top + (b.height > 40 ? 4 : b.height / 2 - 9)) };
    });
    labels = hintLabels(targets.length);
    if (!targets.length) onclose();
    window.addEventListener('keydown', onkey, true);
    window.addEventListener('pointerdown', onclose, true);
    window.addEventListener('resize', onclose);
    return () => {
      window.removeEventListener('keydown', onkey, true);
      window.removeEventListener('pointerdown', onclose, true);
      window.removeEventListener('resize', onclose);
    };
  });

  function onkey(e: KeyboardEvent): void {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') return onclose();
    if (e.key === 'Backspace') {
      typed = typed.slice(0, -1);
      return;
    }
    if (e.key.length !== 1 || e.metaKey || e.ctrlKey || e.altKey) return;
    const next = typed + e.key.toLowerCase();
    const f = filterHints(labels, next);
    if (f.live.length === 0) return;
    typed = next;
    if (f.hit != null) {
      const t = targets[f.hit].el;
      onclose();
      if (t.matches('input[type="text"], input[type="search"], input:not([type]), textarea, [contenteditable="true"]')) t.focus();
      else {
        t.focus?.({ preventScroll: true });
        t.click();
      }
    }
  }
</script>

<div class="hints" aria-hidden="true" data-testid="hint-overlay">
  {#each targets as t, i (i)}
    {#if live.has(i)}
      <span class="hint" style="left: {t.left}px; top: {t.top}px"
        ><span class="typed">{labels[i].slice(0, typed.length)}</span>{labels[i].slice(typed.length)}</span>
    {/if}
  {/each}
</div>
<div class="ui-sr-only" role="status">Hint mode: type a label to click, Esc to cancel.</div>

<style>
  .hints { position: fixed; inset: 0; z-index: 500; pointer-events: none; }
  .hint {
    position: fixed;
    padding: 1px 4px;
    border-radius: 4px;
    background: var(--color-warning);
    color: var(--color-background);
    border: 1px solid color-mix(in srgb, var(--color-background) 30%, var(--color-warning));
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.25);
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 700;
    line-height: 14px;
    text-transform: uppercase;
    letter-spacing: 0.02em;
    animation: hint-in 90ms var(--ease);
  }
  .typed { opacity: 0.45; }
  @keyframes hint-in { from { opacity: 0; transform: scale(0.85); } }
</style>
