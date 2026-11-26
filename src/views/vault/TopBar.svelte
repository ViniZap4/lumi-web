<script lang="ts">
  // The book shell's top row: the book button (books level), the open
  // note's breadcrumb, and the explorer / sync / new / palette /
  // settings buttons.
  import { vaults } from '../../lib/vaults.svelte.ts';
  import { notes } from '../../lib/notes.svelte.ts';
  import { books } from '../../lib/books.svelte.ts';
  import { uiState } from '../../lib/uistate.svelte.ts';
  import { keyLabel } from '../../lib/platform.ts';
  import { noteIconKind } from '../../lib/note-icons.ts';
  import { setOrigin } from '../../lib/motion-actions.ts';
  import NoteIcon from '../../components/NoteIcon.svelte';
  import SyncDot from '../../components/SyncDot.svelte';
  import SyncStatusPopover from '../../components/SyncStatusPopover.svelte';
  import { OFFLINE_HINT } from './explorer.svelte.ts';
  import { useWorkspace } from './context.ts';

  const ws = useWorkspace();
  const ex = ws.explorer;
</script>

<header class="topbar">
  <div class="top-left">
    <button class="book-btn" type="button" onclick={ex.openBooks} title="Switch book (gb)" aria-label="Switch book: {books.active?.name ?? 'Book'}" data-testid="book-switcher">
      <span class="ui-wordmark alive"><span class="mark"></span></span>
      {#if ws.activeStatus}<SyncDot state={ws.activeStatus.state} pending={ws.activeStatus.pending} vaultID={vaults.selectedID ?? undefined} />{/if}
      <span class="book-name">{books.active?.name ?? vaults.selected?.name ?? 'Book'}</span>
      <svg class="caret" viewBox="0 0 16 16" width="10" height="10" aria-hidden="true"><path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </button>
    {#if ws.pane === 'note' && notes.selected}
      <nav class="breadcrumb" aria-label="Note location" data-testid="breadcrumb">
        {#each ws.noteCrumbs as c, i (i)}
          <button class="crumb" type="button" onclick={() => ex.exploreCrumb(i)} title="Explore {ws.noteCrumbs.slice(0, i + 1).join('/')}/">{c}</button>
          <span class="sep" aria-hidden="true">/</span>
        {/each}
        <span class="crumb-kind" aria-hidden="true"><NoteIcon kind={noteIconKind(notes.selected, notes.content?.id === notes.selected.id ? notes.content : null)} size={12} /></span>
        <span class="crumb-note" aria-current="page">{notes.selected.title}</span>
      </nav>
    {/if}
  </div>
  <div class="topbar-right">
    <button class="ui-btn ghost sm explorer-btn" type="button" onclick={(e) => { setOrigin(e.currentTarget); ex.open(); }} aria-label="Explorer" aria-haspopup="dialog" aria-expanded={!!ex.fx} title="Explorer (-, {ws.cmd.eff.leader}e, :explore)" data-testid="explorer-button">
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M1.75 4.25a1.5 1.5 0 0 1 1.5-1.5h3l1.5 1.75h5a1.5 1.5 0 0 1 1.5 1.5v6.25a1.5 1.5 0 0 1-1.5 1.5h-9.5a1.5 1.5 0 0 1-1.5-1.5z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>
      <span class="explorer-label">Explorer</span><kbd>-</kbd>
    </button>
    <SyncStatusPopover />
    <button class="ui-btn ghost sm icon" onclick={ex.beginCreate} type="button" disabled={ws.structuralOffline}
      title={ws.structuralOffline ? OFFLINE_HINT : 'New note (a)'} aria-label="New note">
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
    </button>
    <button class="ui-btn ghost sm palette-btn" onclick={() => (ws.cmd.paletteMode = 'all')} type="button" title="Command palette (space, {keyLabel('⌘K')})">
      <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="m10.5 10.5 3 3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
      <span class="palette-label">Search</span><kbd>{keyLabel('⌘K')}</kbd>
    </button>
    <button class="ui-btn ghost sm icon" onclick={() => uiState.openSettings('editor')} type="button" title="Settings (,)" aria-label="Settings">
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M2 4.5h7M12 4.5h2M2 11.5h2M7 11.5h7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><circle cx="10.5" cy="4.5" r="1.6" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="5.5" cy="11.5" r="1.6" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>
    </button>
  </div>
</header>

<style>
  .topbar {
    position: relative;
    z-index: 5;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-3);
    height: var(--topbar-h);
    padding: 0 var(--sp-1) 0 var(--sp-2);
    background: color-mix(in oklch, var(--surface-1) 55%, var(--surface-0));
    box-shadow: 0 1px 0 var(--hairline-soft), 0 6px 16px -14px rgb(var(--shadow-rgb) / var(--shadow-a));
    flex: none;
  }
  .top-left { display: flex; align-items: center; gap: var(--sp-1); min-width: 0; flex: 1; }
  .book-btn {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    max-width: 260px;
    height: 28px;
    padding: 0 10px 0 7px;
    border: 1px solid transparent;
    border-radius: var(--radius);
    background: transparent;
    color: var(--color-text);
    font: inherit;
    font-size: var(--text-sm);
    font-weight: 600;
    letter-spacing: var(--tracking-ui);
    cursor: pointer;
    transition: background var(--dur-tap) var(--ease), border-color var(--dur-fade) var(--ease), transform var(--spring-snappy-ms) var(--spring-snappy);
  }
  .book-btn:hover { background: var(--tint-hover); border-color: var(--hairline-soft); }
  .book-btn:active { transform: scale(0.97); }
  .book-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .book-btn .caret { flex: none; color: var(--ink-3); transition: transform var(--spring-snappy-ms) var(--spring-snappy); }
  .book-btn:hover .caret { transform: translateY(1px); }
  .explorer-btn { gap: 6px; }
  .explorer-btn[aria-expanded='true'] { background: var(--accent-soft); color: var(--accent-ink); }
  .explorer-btn kbd { margin-left: 2px; }
  .topbar-right { display: flex; align-items: center; gap: var(--sp-1); flex: none; }
  .palette-btn {
    gap: 7px;
    color: var(--ink-3);
    border-color: var(--hairline-soft);
    background: var(--surface-sunk);
    min-width: 168px;
    justify-content: flex-start;
    box-shadow: inset 0 1px 2px rgb(var(--shadow-rgb) / calc(var(--shadow-a) * 0.25));
  }
  .palette-btn:hover { color: var(--ink-2); border-color: var(--hairline); background: var(--surface-1); }
  .palette-btn kbd { margin-left: auto; }
  .palette-label { font-weight: 400; }

  .breadcrumb {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 2px;
    overflow-x: auto;
    white-space: nowrap;
    font-size: var(--text-sm);
    scrollbar-width: none;
  }
  .breadcrumb::-webkit-scrollbar { display: none; }
  .crumb {
    background: transparent;
    border: none;
    color: var(--ink-3);
    font-size: inherit;
    cursor: pointer;
    padding: 3px 6px;
    border-radius: var(--radius-sm);
    transition: background var(--dur-tap) var(--ease), color var(--dur-fade) var(--ease);
  }
  .crumb:hover, .crumb:focus-visible { background: var(--tint-hover); color: var(--color-text); }
  .crumb-note { color: var(--color-text); font-weight: 550; overflow: hidden; text-overflow: ellipsis; padding: 0 4px; animation: crumb-in var(--spring-gentle-ms) var(--spring-gentle) both; }
  @keyframes crumb-in { from { opacity: 0; transform: translateX(-4px); } }
  .sep { color: var(--ink-4); }

  @media (max-width: 720px) {
    .book-btn { max-width: 46vw; }
    .book-btn .ui-wordmark { display: none; }
    .breadcrumb .crumb { display: none; }
    .breadcrumb .sep { display: none; }
    .palette-btn { min-width: 0; background: transparent; box-shadow: none; border-color: transparent; }
    .palette-label, .palette-btn kbd, .explorer-label, .explorer-btn kbd { display: none; }
  }
</style>
