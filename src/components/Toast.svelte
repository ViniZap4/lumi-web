<script>
  import { store } from '../lib/store.svelte.js';

  let { } = $props();

  $effect(() => {
    if (store.error) {
      const timer = setTimeout(() => { store.error = null; }, 5000);
      return () => clearTimeout(timer);
    }
  });
</script>

{#if store.error}
  <div class="error-toast">{store.error}</div>
{/if}

<style>
  .error-toast {
    position: fixed;
    top: 1rem;
    right: 1rem;
    background: var(--color-error);
    color: var(--color-background);
    padding: 0.75rem 1.25rem;
    border-radius: 4px;
    z-index: 2000;
    font-weight: 600;
    font-size: 0.9rem;
  }
</style>
