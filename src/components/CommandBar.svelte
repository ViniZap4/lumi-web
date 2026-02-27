<script>
  let { items = [] } = $props();
</script>

<div class="command-bar">
  {#each items as item}
    <span><span class="key-hint">{item.key}</span> {item.desc}</span>
  {/each}
</div>

<style>
  .command-bar {
    padding: 0.75rem 1.25rem;
    border-top: 1px solid var(--color-separator);
    font-size: 0.8rem;
    color: var(--color-muted);
    text-align: center;
    display: flex;
    gap: 0.75rem;
    justify-content: center;
    flex-wrap: wrap;
  }

  .key-hint {
    color: var(--color-secondary);
    font-weight: 700;
  }
</style>
