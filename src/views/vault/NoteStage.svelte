<script lang="ts">
  // The stage while a note is open: the primary pane alone, or the pane
  // tree of splits (tabs on narrow screens), plus the drop ghost of a
  // note dragged from the explorer. The note's content (reader, editor,
  // board / canvas host) and secondary panes are lazy chunks: markdown
  // rendering stays out of the shell.
  import { onMount, untrack } from 'svelte';
  import { vaults } from '../../lib/vaults.svelte.ts';
  import { notes } from '../../lib/notes.svelte.ts';
  import { springTo, motionAllowed } from '../../lib/motion.ts';
  import { MARKDOWN_VIEW } from '../../lib/note-views.ts';
  import type { PaneLeaf } from '../../lib/pane-tree.ts';
  import PaneTree from '../../components/PaneTree.svelte';
  import TocRail from '../../components/TocRail.svelte';
  import { lazyComponent } from './lazy.svelte.ts';
  import { loadPrimaryNote, loadNotePane } from './chunks.ts';
  import { useWorkspace } from './context.ts';

  const PrimaryNote = lazyComponent(loadPrimaryNote);
  const NotePane = lazyComponent(loadNotePane);

  const ws = useWorkspace();
  const { panes: pn, edit: ed, cmd } = ws;

  onMount(() => ws.stageMounted());

  let paneHostEl = $state<HTMLElement | null>(null);
  let cometEl = $state<HTMLElement | null>(null);
  let cometFrom: string | null = null;
  // Pane focus travels: the light moves from the old pane's top edge to
  // the new one's (DOM focus already moved; this only shows the path).
  $effect(() => {
    const id = pn.activeLeafId;
    const host = paneHostEl;
    const comet = cometEl;
    const prev = untrack(() => cometFrom);
    cometFrom = id;
    if (!host || !comet || !prev || prev === id || untrack(() => pn.zoomed) || !motionAllowed()) return;
    const a = pn.leafElement(prev)?.getBoundingClientRect();
    const b = pn.leafElement(id)?.getBoundingClientRect();
    const h = host.getBoundingClientRect();
    if (!a || !b || !b.width) return;
    const render = (el: HTMLElement, v: { x: number; y: number; sx: number; opacity: number }) => {
      el.style.opacity = String(Math.max(0, Math.min(1, v.opacity)));
      el.style.transform = `translate3d(${v.x.toFixed(1)}px, ${v.y.toFixed(1)}px, 0) scaleX(${Math.max(0.01, v.sx).toFixed(4)})`;
    };
    const to = { x: b.left - h.left, y: b.top - h.top, sx: b.width / 100 };
    springTo(comet, { ...to, opacity: 1 }, {
      spring: 'glide',
      from: { x: a.left - h.left, y: a.top - h.top, sx: a.width / 100, opacity: 1 },
      absolute: true,
      jump: true,
      render,
      onRest: () => springTo(comet, { ...to, opacity: 0 }, { spring: 'soft', render }),
    });
  });

  const dropLabel = { left: 'Open left', right: 'Open right', top: 'Open above', bottom: 'Open below' } as const;
</script>

<!-- Right-click on the open note: the note's menu. -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<main
  class="stage preview"
  class:split-host={ed.mode && ed.splitOn && !pn.multi}
  class:multi={pn.multi}
  class:pane-focus={pn.multiPane && pn.activePane === 'main' && !pn.multi}
  data-pane={pn.multi ? undefined : 'main'}
  data-leaf={pn.multi ? undefined : pn.primaryLeaf}
  data-note-path={pn.multi ? undefined : ws.leafPath(pn.primaryLeaf)}
  data-testid="stage"
  bind:this={ws.previewEl}
  tabindex="-1"
  aria-label="Note"
  oncontextmenu={pn.multi ? undefined : cmd.onReaderContext}
  ondragover={pn.onStageDragOver}
  ondragleave={(e) => { if (!ws.previewEl?.contains(e.relatedTarget as Node | null)) pn.dropAt = null; }}
  ondrop={pn.onStageDrop}
>
  {#if pn.multi && pn.state}
    {#if pn.narrowView}
      <div class="pane-tabs" role="tablist" aria-label="Panes">
        {#each pn.leafList as l (l.id)}
          <button type="button" role="tab" class="pane-tab" class:active={l.id === pn.activeLeafId} aria-selected={l.id === pn.activeLeafId}
            onclick={() => pn.focusLeaf(l.id)}>{notes.list.find((n) => n.id === l.note)?.title ?? l.note}</button>
        {/each}
      </div>
      <div class="pane-stack">
        {#each pn.leafList as l (l.id)}
          <div class="pane-slot" class:hidden={l.id !== pn.activeLeafId}>{@render paneLeaf(l)}</div>
        {/each}
      </div>
    {:else}
      <div class="pane-host" data-testid="pane-host" bind:this={paneHostEl}>
        <div class="focus-comet" aria-hidden="true" bind:this={cometEl}></div>
        <PaneTree
          node={pn.state.root}
          leaf={paneLeaf}
          zoomed={pn.zoomed}
          onresize={(id, i, at) => pn.resize(id, i, at)}
          onequalize={() => pn.equalize()}
        />
      </div>
    {/if}
  {:else}
    {@render primaryContent()}
    {#if !ed.mode && notes.content && ws.primaryView === MARKDOWN_VIEW}
      <!-- Wide screens: the empty gutter holds the note's outline. -->
      <TocRail scrollEl={ws.previewEl ?? null} />
    {/if}
  {/if}
  {#if pn.dropAt}
    <!-- Where the dragged note will land (edge highlight). -->
    {@const st = ws.previewEl?.getBoundingClientRect()}
    {@const r = pn.dropAt.rect}
    <div class="drop-ghost" data-side={pn.dropAt.t.side} aria-hidden="true"
      style="left: {r.left - (st?.left ?? 0)}px; top: {r.top - (st?.top ?? 0)}px; width: {r.width}px; height: {r.height}px"
    ><span class="drop-edge"></span><span class="drop-label">{dropLabel[pn.dropAt.t.side]}</span></div>
  {/if}
</main>

{#snippet primaryContent()}
  {#if PrimaryNote.current}
    <PrimaryNote.current />
  {:else}
    <div class="reader-skel" aria-busy="true" aria-label="Loading note">
      {#each [94, 88, 97, 62] as w, i (i)}<span class="skeleton" style="width: {w}%"></span>{/each}
    </div>
  {/if}
{/snippet}

{#snippet paneLeaf(l: PaneLeaf)}
  {#if l.id === pn.primaryLeaf}
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div
      class="preview primary-pane"
      class:split-host={ed.mode && ed.splitOn}
      class:active={pn.activeLeafId === l.id}
      class:pane-focus={pn.activePane === 'main'}
      data-pane="main"
      data-leaf={l.id}
      data-note-path={ws.leafPath(pn.primaryLeaf)}
      data-testid="primary-pane"
      tabindex="-1"
      role="region"
      aria-label="Pane: {notes.selected?.title ?? 'note'}"
      bind:this={pn.primaryWrapEl}
      oncontextmenu={cmd.onReaderContext}
      onpointerdown={() => pn.markActive(l.id)}
    >
      {@render primaryContent()}
    </div>
  {:else if vaults.selectedID && NotePane.current}
    <NotePane.current
      bind:this={pn.refs[l.id]}
      leaf={l}
      vaultID={vaults.selectedID}
      active={pn.activeLeafId === l.id}
      onfocus={() => { pn.markActive(l.id); pn.focusedPane = 'leaf'; }}
      onclose={() => pn.closeLeaf(l.id)}
      zoomed={pn.zoomed === l.id}
      onzoom={() => pn.toggleZoom(l.id)}
      onfollow={(href, where, from, wiki) => ws.followLink(href, where, from, wiki, l.id)}
      onlink={(href, e, from) => ws.routeClick(href, e, from, l.id)}
      onhover={(link, rect, from) => ws.hover.key(link, rect, from, l.id)}
      onexplore={() => ws.explorer.open()}
      onwin={(c, o) => pn.runWin(c, o)}
      onpane={pn.navigate}
      onpanepending={(p) => (cmd.panePending = p)}
      onvimstate={(st) => (ed.vimState = st)}
      onstate={(st) => (pn.info = { ...pn.info, [l.id]: st })}
      onview={(v) => pn.setLeafView(l.id, v)}
    />
  {/if}
{/snippet}

<style>
  .stage { position: relative; flex: 1; min-height: 0; min-width: 0; }
  .stage.preview { view-transition-name: lumi-pane; }
  /* Kept before the base rule, as it always was: the base wins. */
  @media (max-width: 720px) {
    .preview { --pad-top: var(--sp-2); padding: var(--pad-top) var(--sp-3) var(--sp-6); }
  }
  .preview {
    --pad-top: var(--sp-4);
    overflow-y: auto;
    padding: var(--pad-top) clamp(var(--sp-4), 3vw, var(--sp-6)) var(--sp-7);
    outline: none;
  }
  /* The pane is the editor (or a board / canvas): it scrolls itself. */
  .preview:has(> :global(.editor-frame)) { padding: 0; overflow: hidden; }
  .preview:has(> :global(.view-frame)) { padding: 0; overflow: hidden; }
  .reader-skel { display: flex; flex-direction: column; gap: 12px; padding-top: var(--sp-2); max-width: calc(var(--md-measure) + 2px); margin: 0 auto; }
  .reader-skel .skeleton { height: 12px; border-radius: 6px; }

  /* ── split note panes (SPEC-PARTE2 §3) ─────────────────── */
  .preview.multi { padding: 0; overflow: hidden; display: flex; flex-direction: column; background: var(--surface-sunk); }
  .pane-host { flex: 1; min-height: 0; display: flex; position: relative; }
  /* Pane focus (motion v2): a bar of light TRAVELS along the top edges
     from the pane you left to the one you entered (glide), then fades
     into that pane's own lit edge. Transform + opacity only. */
  .focus-comet {
    position: absolute;
    left: 0;
    top: 0;
    width: 100px;
    height: 2px;
    z-index: 30;
    pointer-events: none;
    opacity: 0;
    transform-origin: 0 0;
    border-radius: 2px;
    background: linear-gradient(90deg, transparent, var(--accent) 18%, color-mix(in oklch, var(--accent) 70%, white) 50%, var(--accent) 82%, transparent);
    box-shadow: 0 0 14px 1px var(--accent-glow);
  }
  .pane-host > .focus-comet { flex: none; }
  .pane-host > :global(*) { flex: 1; min-width: 0; }
  .primary-pane {
    position: relative;
    height: 100%;
    min-width: 0;
    overflow-y: auto;
    outline: none;
    --pad-top: var(--sp-3);
    padding: var(--pad-top) clamp(14px, 3%, 32px) var(--sp-7);
    background: var(--surface-0);
  }
  .primary-pane:has(> :global(.editor-frame)), .primary-pane:has(> :global(.view-frame)) { padding: 0; overflow: hidden; }
  .pane-tabs {
    flex: none;
    display: flex;
    gap: 2px;
    padding: 4px var(--sp-2) 0;
    border-bottom: 1px solid var(--hairline);
    overflow-x: auto;
    scrollbar-width: none;
  }
  .pane-tab {
    flex: none;
    max-width: 46vw;
    padding: 6px 10px;
    border: none;
    border-bottom: 2px solid transparent;
    background: transparent;
    color: var(--ink-3);
    font-size: var(--text-xs);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: pointer;
    transition: color var(--dur-fade) var(--ease), border-color var(--spring-snappy-ms) var(--spring-snappy);
  }
  .pane-tab.active { color: var(--color-text); border-bottom-color: var(--accent); font-weight: 600; }
  .pane-stack { flex: 1; min-height: 0; display: flex; }
  .pane-slot { flex: 1; min-width: 0; min-height: 0; display: flex; }
  .pane-slot > :global(*) { flex: 1; min-width: 0; }
  .pane-slot.hidden { display: none; }

  /* drag a note from the explorer onto a pane edge */
  .drop-ghost {
    position: absolute;
    z-index: 30;
    pointer-events: none;
    display: flex;
    animation: ui-fade var(--dur-fade) var(--ease);
  }
  .drop-edge {
    position: absolute;
    border-radius: var(--radius-lg);
    background: linear-gradient(var(--accent-soft), var(--accent-wash));
    box-shadow: inset 0 0 0 1.5px var(--accent-line), 0 0 40px -8px var(--accent-glow);
    transition: inset var(--spring-glide-ms) var(--spring-glide);
    inset: 8px 8px 8px 50%;
  }
  .drop-ghost[data-side='left'] .drop-edge { inset: 8px 50% 8px 8px; }
  .drop-ghost[data-side='top'] .drop-edge { inset: 8px 8px 50% 8px; }
  .drop-ghost[data-side='bottom'] .drop-edge { inset: 50% 8px 8px 8px; }
  .drop-label {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    padding: 5px 11px;
    border-radius: var(--radius-pill);
    background: var(--glass-bg-strong);
    -webkit-backdrop-filter: var(--glass-blur);
    backdrop-filter: var(--glass-blur);
    box-shadow: var(--elev-2);
    color: var(--accent-ink);
    font-size: var(--text-xs);
    font-weight: 600;
  }
  .drop-ghost[data-side='left'] .drop-label { left: 25%; }
  .drop-ghost[data-side='right'] .drop-label { left: 75%; }
  .drop-ghost[data-side='top'] .drop-label { top: 25%; }
  .drop-ghost[data-side='bottom'] .drop-label { top: 75%; }

</style>
