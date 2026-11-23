<script lang="ts">
  // `?` overlay: the whole keymap on one sheet. Any key closes it.
  import { onMount, onDestroy } from 'svelte';
  import { KEYMAP } from '../lib/keymap-help.ts';

  interface Props {
    onclose: () => void;
    leader?: string;
  }
  const { onclose, leader = '\\' }: Props = $props();

  function onKey(e: KeyboardEvent): void {
    if (e.metaKey || e.ctrlKey || e.key === 'Shift' || e.key === 'Meta' || e.key === 'Control' || e.key === 'Alt') return;
    e.preventDefault();
    e.stopPropagation();
    onclose();
  }
  onMount(() => window.addEventListener('keydown', onKey, true));
  onDestroy(() => window.removeEventListener('keydown', onKey, true));
</script>

<div class="ui-scrim" role="presentation" onclick={onclose}>
  <div class="ui-sheet help" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" tabindex="-1" data-testid="help">
    <header class="head">
      <span class="title">Keys</span>
      <span class="hint">leader <kbd>{leader === '<Space>' ? 'space' : leader}</kbd> · any key to close</span>
    </header>
    <div class="grid">
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
