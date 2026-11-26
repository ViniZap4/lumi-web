<script lang="ts">
  // The explorer's level glyphs: server, account, shelf (Livros), book,
  // folder. 16-unit grid, currentColor.
  const { kind, px = 13 }: { kind: 'server' | 'account' | 'shelf' | 'book' | 'folder'; px?: number } = $props();
</script>

<svg class="lv-ic lv-{kind}" viewBox="0 0 16 16" width={px} height={px} aria-hidden="true">
  {#if kind === 'server'}
    <rect x="2.5" y="2.5" width="11" height="4.5" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.3"/><rect x="2.5" y="9" width="11" height="4.5" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="5" cy="4.75" r=".8" fill="currentColor"/><circle cx="5" cy="11.25" r=".8" fill="currentColor"/>
  {:else if kind === 'account'}
    <circle cx="8" cy="5.6" r="2.6" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M3 13.5c.6-2.6 2.6-3.9 5-3.9s4.4 1.3 5 3.9" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
  {:else if kind === 'shelf'}
    <path d="M2.5 13.5h11M4 13.5V4h2.2v9.5M6.2 13.5V3h2.2v10.5M9.2 13.4l1.9-9 2.1.45-1.9 9" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round" stroke-linecap="round"/>
  {:else if kind === 'book'}
    <path d="M3 2.75h7.5a1.5 1.5 0 0 1 1.5 1.5v9H4.5A1.5 1.5 0 0 1 3 11.75z M3 11.75a1.5 1.5 0 0 1 1.5-1.5H12" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>
  {:else}
    <path d="M1.75 4.25a1.5 1.5 0 0 1 1.5-1.5h3l1.5 1.75h5a1.5 1.5 0 0 1 1.5 1.5v6.25a1.5 1.5 0 0 1-1.5 1.5h-9.5a1.5 1.5 0 0 1-1.5-1.5z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>
  {/if}
</svg>

<style>
  .lv-ic { flex: none; vertical-align: -2px; }
</style>
