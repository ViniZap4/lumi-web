<script lang="ts">
  // The status line: vim mode, zoom, path, counts or editor stats, the
  // which-key legend (one bar, not two) and the live sync state.
  import { notes } from '../../lib/notes.svelte.ts';
  import { uiState } from '../../lib/uistate.svelte.ts';
  import { editorSettings } from '../../lib/editor-settings.svelte.ts';
  import ModePill from '../../components/ModePill.svelte';
  import CommandLegend from '../../components/CommandLegend.svelte';
  import { vimModeLabel } from './edit.svelte.ts';
  import { useWorkspace } from './context.ts';

  const ws = useWorkspace();
  const { cmd, edit: ed } = ws;
  const path = $derived(ws.fmtPath());
</script>

<footer class="statusbar" data-testid="editor-status">
  {#if ed.mode && ed.session && cmd.eff.vim}
    <ModePill mode={ed.vimState.mode} label={vimModeLabel(ed.vimState.mode, ed.vimState.sub)} />
    {#if ed.vimState.pending && !editorSettings.value.legend}<span class="sb-pending">{ed.vimState.pending}</span>{/if}
  {/if}
  {#if ws.panes.zoomed}<button type="button" class="sb-zoom" onclick={() => ws.panes.toggleZoom()} title="Zoomed pane — ⌃w z or :zoom restores the layout" data-testid="status-zoom">zoomed</button>{/if}
  <span class="sb-path mono" title={path}>{path}</span>
  {#if !ed.mode}
    <span class="sb-item" aria-live="off">{notes.list.length} notes{notes.loadingMore ? '…' : ''}</span>
    {#if notes.stale}<span class="sb-item stale" data-testid="list-stale" title="Última lista conhecida; atualiza quando a conexão voltar.">lista offline{notes.staleAt ? ` de ${new Date(notes.staleAt).toLocaleString()}` : ''}</span>{/if}
    {#if ws.explorer.yanked}<span class="sb-item">yanked {ws.explorer.yanked.name}</span>{/if}
  {/if}
  {#if ed.mode && ed.session}
    {#if ed.stats}
      <span class="sb-item">{ed.stats.words} {ed.stats.words === 1 ? 'word' : 'words'}</span>
      <span class="sb-item">Ln {ed.stats.line}, Col {ed.stats.col}</span>
    {/if}
    <span class="sb-item">{editorSettings.value.editMode === 'live' ? 'Live Preview' : 'Source'}</span>
  {/if}
  {#if editorSettings.value.legend}
    <!-- One bar, not two: the which-key legend lives inside the status
         line and shows as many keys as fit between its ends. -->
    <span class="sb-legend"><CommandLegend embedded items={cmd.legendItems} pending={cmd.legendPending} mode={ed.mode && ed.session && cmd.eff.vim && !ws.explorer.fx ? null : cmd.legendMode} onaction={cmd.onLegendAction} onmore={() => (uiState.helpOpen = true)} /></span>
  {:else}
    <span class="sb-spacer"></span>
  {/if}
  {#if ed.mode && ed.session}
    {@const s = ed.session}
    <span class="sb-item sync" class:pending={s.pending} class:offline={!s.pending && !s.liveSynced} data-testid="editor-sync-state" title={s.persistence
      ? 'Edits sync live; offline they are kept in this browser and sent when the connection returns.'
      : 'Edits sync live; the file on disk follows within ~500 ms.'}>
      {s.pending
        ? 'Pending sync…'
        : s.liveSynced
          ? 'Saved live'
          : s.persistence
            ? 'Offline — kept on this device'
            : 'Offline — kept in this tab'}
    </span>
  {/if}
  <button class="sb-help" type="button" onclick={() => (uiState.helpOpen = true)} title="Keyboard shortcuts (?)">?</button>
</footer>

<style>
  .mono { font-family: var(--font-mono); }
  .statusbar {
    flex: none;
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    height: var(--bar-h);
    padding: 0 0 0 var(--sp-3);
    border-top: 1px solid var(--hairline-soft);
    background: color-mix(in oklch, var(--surface-1) 50%, var(--surface-0));
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    color: var(--ink-3);
    white-space: nowrap;
    overflow: hidden;
    font-variant-numeric: tabular-nums;
  }
  .sb-pending { color: var(--color-warning); font-weight: 600; }
  .sync::before {
    content: '';
    display: inline-block;
    width: 6px;
    height: 6px;
    margin-right: 6px;
    border-radius: 50%;
    background: var(--color-accent);
    box-shadow: 0 0 6px color-mix(in oklch, var(--color-accent) 60%, transparent);
    vertical-align: 1px;
    transition: background var(--dur-fade) var(--ease);
  }
  .sync.pending::before { background: var(--color-warning); animation: sync-breathe 1.6s var(--ease-breath) infinite; }
  .sync.offline::before { background: var(--ink-4); box-shadow: none; }
  .sb-path { flex: none; color: var(--ink-2); overflow: hidden; text-overflow: ellipsis; min-width: 0; max-width: 24%; }
  .sb-spacer { flex: 1; }
  .sb-item { flex: none; }
  .stale { color: var(--color-warning); font-size: var(--text-xs); }
  .sb-legend { flex: 1; min-width: 0; display: flex; align-self: stretch; align-items: center; padding-left: var(--sp-2); border-left: 1px solid var(--hairline-soft); }
  .sb-legend > :global(.legend) { height: 100%; }
  .sb-help {
    align-self: stretch;
    width: 28px;
    border: none;
    border-left: 1px solid var(--hairline-soft);
    background: transparent;
    color: var(--ink-3);
    font-family: var(--font-mono);
    cursor: pointer;
    transition: background var(--dur-tap) var(--ease), color var(--dur-fade) var(--ease);
  }
  .sb-help:hover { color: var(--color-text); background: var(--tint-hover); }

  /* zoom (tmux): the status line's badge */
  .sb-zoom {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 16px;
    padding: 0 7px;
    border: none;
    border-radius: var(--radius-pill);
    background: var(--accent-soft);
    color: var(--accent-ink);
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    font-weight: 600;
    letter-spacing: 0.02em;
    cursor: pointer;
    animation: badge-in var(--spring-bouncy-ms) var(--spring-bouncy) both;
  }
  .sb-zoom::before { content: ''; width: 5px; height: 5px; border-radius: 50%; background: currentColor; box-shadow: 0 0 6px currentColor; }
  @keyframes badge-in { from { opacity: 0; transform: scale(0.7); } }

  @media (max-width: 720px) {
    .sb-item:not(.sync):not(.stale) { display: none; }
  }
</style>
