<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { vaults } from '../lib/vaults.svelte.ts';
  import { notes } from '../lib/notes.svelte.ts';
  import { renderMarkdown } from '../lib/markdown.ts';

  // Vim-style list cursor. Tracks position even when selectedID is null.
  let cursor = $state(0);

  // Hydrate notes whenever the active vault changes. The notes store
  // is idempotent on a no-op vaultID transition so this is safe.
  $effect(() => {
    const vid = vaults.selectedID;
    void notes.openVault(vid);
  });

  // Clamp cursor when the list shrinks (e.g. refresh).
  $effect(() => {
    if (cursor >= notes.list.length) cursor = Math.max(0, notes.list.length - 1);
  });

  onMount(() => {
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  });

  onDestroy(() => {
    // Drop the per-vault cache so the next vault load starts clean.
    void notes.openVault(null);
  });

  function back(): void {
    vaults.select(null);
  }

  let lastG = $state(0);
  function handleKey(e: KeyboardEvent): void {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;

    if (e.key === 'h' || e.key === 'Escape') {
      e.preventDefault();
      if (notes.selectedID) {
        // First Esc clears the focused note; second returns to vaults.
        void notes.select(null);
      } else {
        back();
      }
      return;
    }
    if (notes.list.length === 0) return;

    if (e.key === 'j' || e.key === 'ArrowDown') {
      e.preventDefault();
      if (cursor < notes.list.length - 1) cursor++;
    } else if (e.key === 'k' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (cursor > 0) cursor--;
    } else if (e.key === 'Enter' || e.key === 'l') {
      e.preventDefault();
      const n = notes.list[cursor];
      if (n) void notes.select(n.id);
    } else if (e.key === 'g') {
      e.preventDefault();
      const now = Date.now();
      if (now - lastG < 500) {
        cursor = 0;
        lastG = 0;
      } else {
        lastG = now;
      }
    } else if (e.key === 'G') {
      e.preventDefault();
      cursor = notes.list.length - 1;
    } else if (e.key === 'r') {
      e.preventDefault();
      void notes.refresh();
    }
  }

  // Pre-compute the sanitised preview HTML on every content change.
  // marked is fast enough that we don't bother debouncing here; large
  // notes (10k+ lines) are the slice 4.4 / 4.6 perf concern.
  let previewHtml = $derived(notes.content ? renderMarkdown(notes.content.body) : '');

  function fmtDate(s: string): string {
    return s.replace('T', ' ').slice(0, 16);
  }
</script>

<div class="vault-home">
  <header class="topbar">
    <button class="link-button" onclick={back} type="button">← Vaults</button>
    <div class="title">
      <span class="vault-name">{vaults.selected?.name}</span>
      <span class="vault-slug">{vaults.selected?.slug}</span>
    </div>
    <div class="topbar-right">
      <button class="link-button" onclick={() => void notes.refresh()} type="button">Refresh</button>
    </div>
  </header>

  <div class="split">
    <aside class="note-list" aria-label="Notes">
      {#if notes.loadingList}
        <div class="placeholder">Loading…</div>
      {:else if notes.listError}
        <div class="error">{notes.listError}</div>
      {:else if notes.list.length === 0}
        <div class="placeholder">No notes yet.</div>
      {:else}
        <ul role="listbox">
          {#each notes.list as n, i (n.id)}
            <li
              class="note-row"
              class:active={cursor === i}
              class:selected={notes.selectedID === n.id}
              role="option"
              aria-selected={notes.selectedID === n.id}
              tabindex="0"
              onclick={() => { cursor = i; void notes.select(n.id); }}
              onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); cursor = i; void notes.select(n.id); } }}
              onmouseenter={() => (cursor = i)}
            >
              <span class="note-title">{n.title}</span>
              <span class="note-meta">{fmtDate(n.updated_at)}</span>
            </li>
          {/each}
        </ul>
      {/if}
    </aside>

    <main class="preview">
      {#if !notes.selectedID}
        <div class="placeholder">
          Pick a note to read. <kbd>j</kbd>/<kbd>k</kbd> move, <kbd>Enter</kbd> opens,
          <kbd>h</kbd>/<kbd>Esc</kbd> back, <kbd>r</kbd> refresh.
        </div>
      {:else if notes.loadingContent}
        <div class="placeholder">Loading…</div>
      {:else if notes.contentError}
        <div class="error">{notes.contentError}</div>
      {:else if notes.content}
        <article class="rendered">
          <h1 class="rendered-title">{notes.selected?.title}</h1>
          <!-- DOMPurify-sanitised HTML, see lib/markdown.ts. -->
          {@html previewHtml}
        </article>
      {/if}
    </main>
  </div>
</div>

<style>
  .vault-home {
    min-height: 100vh;
    background: var(--color-background);
    color: var(--color-text);
    display: flex;
    flex-direction: column;
  }

  .topbar {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    padding: 0.6rem 1rem;
    border-bottom: 1px solid var(--color-separator, var(--color-border));
  }
  .topbar-right {
    justify-self: end;
  }
  .title {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.1rem;
  }
  .vault-name {
    font-weight: 600;
    color: var(--color-text);
  }
  .vault-slug {
    font-size: 0.72rem;
    color: var(--color-text-dim, var(--color-muted));
  }

  .split {
    display: grid;
    grid-template-columns: minmax(220px, 320px) 1fr;
    flex: 1;
    min-height: 0;
  }

  .note-list {
    border-right: 1px solid var(--color-separator, var(--color-border));
    overflow-y: auto;
    padding: 0.5rem;
  }

  .note-list ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }

  .note-row {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    padding: 0.5rem 0.7rem;
    border-radius: 4px;
    cursor: pointer;
    border: 1px solid transparent;
  }

  .note-row.active {
    background: var(--color-selected-bg, var(--color-overlay-bg));
  }
  .note-row.selected {
    border-color: var(--color-primary);
  }

  .note-title {
    color: var(--color-text);
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .note-meta {
    color: var(--color-text-dim, var(--color-muted));
    font-size: 0.7rem;
  }

  .preview {
    overflow-y: auto;
    padding: 1.5rem 2rem;
  }

  .rendered {
    max-width: 720px;
    margin: 0 auto;
    line-height: 1.55;
  }

  .rendered-title {
    margin: 0 0 1rem;
    font-size: 1.6rem;
    color: var(--color-text);
    border-bottom: 1px solid var(--color-separator, var(--color-border));
    padding-bottom: 0.3rem;
  }

  /* Inline markdown styling, scoped to the rendered article so it
     doesn't leak. CSS variables let theming work without re-render. */
  :global(.rendered h1),
  :global(.rendered h2),
  :global(.rendered h3),
  :global(.rendered h4) {
    color: var(--color-text);
    line-height: 1.25;
  }
  :global(.rendered h2) { font-size: 1.3rem; margin-top: 1.5rem; }
  :global(.rendered h3) { font-size: 1.1rem; margin-top: 1.3rem; }
  :global(.rendered p)  { margin: 0.6rem 0; }
  :global(.rendered a)  {
    color: var(--color-secondary);
    text-decoration: none;
  }
  :global(.rendered a:hover) { text-decoration: underline; }
  :global(.rendered code) {
    background: var(--color-overlay-bg, var(--color-background));
    color: var(--color-accent);
    padding: 0.05rem 0.3rem;
    border-radius: 3px;
    font-size: 0.92em;
  }
  :global(.rendered pre) {
    background: var(--color-overlay-bg, var(--color-background));
    padding: 0.9rem;
    overflow-x: auto;
    border-radius: 4px;
    border: 1px solid var(--color-border, var(--color-muted));
  }
  :global(.rendered pre code) {
    background: transparent;
    color: var(--color-text);
    padding: 0;
  }
  :global(.rendered blockquote) {
    border-left: 3px solid var(--color-secondary);
    padding-left: 0.8rem;
    color: var(--color-text-dim, var(--color-muted));
    margin: 0.8rem 0;
  }
  :global(.rendered img),
  :global(.rendered iframe),
  :global(.rendered video) {
    max-width: 100%;
    border-radius: 4px;
  }
  :global(.rendered table) {
    border-collapse: collapse;
    margin: 0.8rem 0;
  }
  :global(.rendered th),
  :global(.rendered td) {
    border: 1px solid var(--color-border, var(--color-muted));
    padding: 0.3rem 0.6rem;
  }
  :global(.rendered hr) {
    border: none;
    border-top: 1px solid var(--color-separator, var(--color-border));
    margin: 1.2rem 0;
  }

  .placeholder,
  .error {
    padding: 1.5rem;
    color: var(--color-text-dim, var(--color-muted));
    text-align: center;
  }
  .error {
    color: var(--color-error);
  }

  kbd {
    background: var(--color-selected-bg, var(--color-overlay-bg));
    border: 1px solid var(--color-border, var(--color-muted));
    border-radius: 3px;
    padding: 0.05rem 0.35rem;
    font-family: inherit;
    font-size: 0.78rem;
    color: var(--color-secondary);
  }

  .link-button {
    background: transparent;
    border: none;
    color: var(--color-secondary);
    font-family: inherit;
    font-size: 0.85rem;
    cursor: pointer;
    padding: 0;
    justify-self: start;
  }
  .link-button:hover { text-decoration: underline; }
</style>
