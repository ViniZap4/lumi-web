<script>
  import { onMount } from 'svelte';
  import { store } from '../lib/store.svelte.js';
  import { startAnimation, visibleRunes, totalColumns } from '../lib/animation.js';

  let cleanup = null;

  onMount(() => {
    if (!store.animDone) {
      cleanup = startAnimation(
        store.logoLines,
        (progress) => { store.animProgress = progress; },
        () => { store.animDone = true; }
      );
    }
    return () => { if (cleanup) cleanup(); };
  });

  function skipAnimation() {
    if (!store.animDone) {
      store.animDone = true;
      store.animProgress = totalColumns(store.logoLines);
      if (cleanup) { cleanup(); cleanup = null; }
    }
  }
</script>

<div class="home-view">
  <div class="logo">
    {#each store.logoLines as line, i}
      <div class="logo-line" style="color: var(--color-logo-{i})">
        {#if store.animDone}
          {line}
        {:else}
          {#each [...line] as char, j}
            <span class:visible={j < visibleRunes(i, store.animProgress)} class="anim-char">{char}</span>
          {/each}
        {/if}
      </div>
    {/each}
  </div>
  {#if store.animDone}
    <div class="subtitle">Local-first Markdown notes</div>
    <div class="home-keys">
      <div><span class="key-hint">/</span> Search notes</div>
      <div><span class="key-hint">t</span> Browse tree</div>
      <div><span class="key-hint">c</span> Settings</div>
    </div>
  {/if}
</div>

<style>
  .home-view {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100vh;
    width: 100vw;
    background: var(--color-background);
    color: var(--color-text);
  }

  .logo {
    font-size: 0.75rem;
    line-height: 1.2;
    font-weight: bold;
    white-space: pre;
    margin-bottom: 2rem;
  }

  .logo-line {
    /* color set via inline style from logoColors */
  }

  .anim-char {
    opacity: 0;
  }

  .anim-char.visible {
    opacity: 1;
  }

  .subtitle {
    color: var(--color-muted);
    margin-bottom: 3rem;
  }

  .home-keys {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    color: var(--color-text);
    font-size: 0.95rem;
    text-align: center;
  }

  .key-hint {
    color: var(--color-secondary);
    font-weight: 700;
  }
</style>
