<script lang="ts">
  // The primary pane while editing: a slim note bar (live status, title,
  // peers, view modes, split, Done) over the editor — or its read-only
  // preview until the server's SyncStep2 arrives.
  import { notes } from '../../lib/notes.svelte.ts';
  import { uiState } from '../../lib/uistate.svelte.ts';
  import { editorSettings } from '../../lib/editor-settings.svelte.ts';
  import { keyLabel } from '../../lib/platform.ts';
  import { renderBlocks, createDocRenderCache, taskToggle } from '../../lib/markdown.ts';
  import { MARKDOWN_VIEW } from '../../lib/note-views.ts';
  import type { EditorSession } from '../../lib/editor-session.svelte.ts';
  import MarkdownView from '../../components/MarkdownView.svelte';
  import SourceSplit from '../../components/SourceSplit.svelte';
  import ZoomBadge from './ZoomBadge.svelte';
  import ZoomButton from './ZoomButton.svelte';
  import type { NoteEditorComp } from './edit.svelte.ts';
  import { useWorkspace } from './context.ts';

  const { session, NoteEditor }: { session: EditorSession; NoteEditor: NoteEditorComp } = $props();

  const ws = useWorkspace();
  const { panes: pn, edit: ed, cmd } = ws;

  // Per-document cache: a one-block edit re-lexes and re-renders that
  // block only (lib/markdown.ts DocRenderCache).
  const docCache = createDocRenderCache();
  const previewBlocks = $derived(notes.content ? renderBlocks(notes.content.body ?? '', { cache: docCache }) : []);
  const ownsEdge = $derived(!pn.multi || pn.activeLeafId === pn.primaryLeaf);

  /** Split preview: the editor owns the doc — dispatch the 1-char
   *  change through CodeMirror (y-codemirror turns it into a ranged
   *  Y.Text op). */
  function toggleTaskInEditor(index: number): void {
    const v = ed.editorRef?.editorView();
    if (!v) return;
    const ch = taskToggle(v.state.doc.toString(), index);
    if (ch) v.dispatch({ changes: ch, userEvent: 'input.toggle-task' });
  }

  function zoomOnDblClick(e: MouseEvent): void {
    if (pn.multi && !(e.target as Element).closest('button, input')) pn.toggleZoom(pn.primaryLeaf);
  }
</script>

<div class="editor-frame" class:split={ed.splitOn} class:mode-edge={ownsEdge}>
  {#if cmd.eff.vim && ownsEdge}
    <!-- Mode change (motion v2): the new mode's colour sweeps down
         the editor's edge (one compositor layer, restarts per mode). -->
    {#key ed.vimState.mode}<span class="mode-sweep" aria-hidden="true"></span>{/key}
  {/if}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <header class="note-bar" data-testid="note-bar" ondblclick={zoomOnDblClick}>
    <div class="nb-lead">
      {#if pn.zoomed === pn.primaryLeaf}<ZoomBadge />{/if}
      <span class="conn-dot conn-{session.status}" data-testid="conn-status" title="Live sync: {session.status}">{session.status}</span>
      {#if ws.noteCrumbs.length > 0}
        <span class="nb-crumbs" aria-hidden="true">{ws.noteCrumbs.join(' / ')}<span class="nb-sep">/</span></span>
      {/if}
      <button type="button" class="nb-title" data-vt-target="note-title" onclick={ws.explorer.beginRename} title="Rename or move (r)">{notes.selected?.title}</button>
      {#if session.peers.length > 0}
        <span class="peers">
          {#each session.peers as p (p.clientID)}
            <span class="peer-chip" style="--peer-color: {p.color}" title="{p.name} is here" data-testid="peer-chip">{p.name.slice(0, 1).toUpperCase()}<span class="peer-live" aria-hidden="true"></span></span>
          {/each}
        </span>
      {/if}
    </div>
    <div class="nb-actions">
      {#if ws.primaryViews.length > 1}
        <div class="ui-seg nb-seg" role="group" aria-label="View">
          {#each ws.primaryViews.filter((v) => v.id !== MARKDOWN_VIEW) as v (v.id)}
            <button type="button" onclick={() => { ed.exit(); pn.setPrimaryView(null); }} title="Back to the {v.label.toLowerCase()}">{v.label}</button>
          {/each}
        </div>
      {/if}
      <div class="ui-seg nb-seg" role="group" aria-label="View mode" data-testid="view-mode">
        <button type="button" onclick={ed.exitAnimated} title="Reading view ({keyLabel('⌘E')})">Reading</button>
        <button type="button" class:active={editorSettings.value.editMode === 'live'}
          aria-pressed={editorSettings.value.editMode === 'live'}
          onclick={() => ed.setEditMode('live')} title="Live Preview ({keyLabel('⌘⇧E')})">Live</button>
        <button type="button" class:active={editorSettings.value.editMode === 'source'}
          aria-pressed={editorSettings.value.editMode === 'source'}
          onclick={() => ed.setEditMode('source')} title="Source ({keyLabel('⌘⇧E')})">Source</button>
      </div>
      <button class="ui-btn ghost sm icon nb-icon split-btn" type="button" onclick={ed.toggleSplit}
        aria-pressed={ed.splitOn} aria-label="Preview beside source"
        title="Preview beside source ({cmd.eff.leader}p · {keyLabel('⌘⌥P')} · :preview split)">
        <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M8 3v10" stroke="currentColor" stroke-width="1.3"/><path d="M10 6h2.5M10 8.5h2.5M10 11h1.5" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" opacity=".7"/></svg>
      </button>
      <button class="ui-btn ghost sm icon nb-icon nb-settings" type="button" onclick={() => uiState.openSettings('editor')}
        aria-label="Editor settings" title="Editor settings (:settings)">
        <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path d="M2.5 4.5h6M11.5 4.5h2M2.5 11.5h2M7.5 11.5h6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><circle cx="10" cy="4.5" r="1.6" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="6" cy="11.5" r="1.6" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>
      </button>
      {#if pn.multi}<ZoomButton />{/if}
      {#if session.readOnly}<span class="ro-chip" data-testid="read-only-live" title="Você vê as edições ao vivo, mas não pode alterar esta nota">Somente leitura</span>{/if}
      <span class="nb-divider" aria-hidden="true"></span>
      <button class="ui-btn sm nb-done" onclick={ed.exitAnimated} type="button" title="Done (:q, {keyLabel('⌘E')})">Done</button>
    </div>
  </header>
  {#if ed.error}<div class="error">{ed.error}</div>{/if}
  {#if session.lastError}<div class="error" data-testid="session-error">{session.lastError}</div>{/if}
  {#if !session.editable}
    <!-- Join rule: read-only preview until the server's SyncStep2 has
         arrived. Never a local seed. -->
    <div class="editor-scroll">
      <div class="placeholder" data-testid="editor-syncing">
        {session.stopped ? 'Live editing unavailable.' : 'Connecting to live editor… (read-only until synced)'}
      </div>
      <article class="rendered lumi-prose readonly-preview" data-prose={editorSettings.value.proseFont}>
        <MarkdownView blocks={previewBlocks} onlink={ws.onMdLink} />
      </article>
    </div>
  {:else if session.emptyAtSync && (notes.content?.body ?? '') !== ''}
    <!-- Legacy note: server CRDT never initialised. Editing an empty doc
         would overwrite the file on the next mirror, so require an
         explicit action. -->
    <div class="editor-scroll">
      <div class="error" data-testid="editor-uninitialised">
        The server has no live-editing state for this note yet. Load the
        file's current contents into the shared document to start editing.
        <button class="ui-btn sm" onclick={ed.initialiseFromFile} type="button">Load file contents</button>
      </div>
      <article class="rendered lumi-prose readonly-preview" data-prose={editorSettings.value.proseFont}>
        <MarkdownView blocks={previewBlocks} onlink={ws.onMdLink} />
      </article>
    </div>
  {:else}
    <SourceSplit
      bind:this={ed.splitRef}
      enabled={ed.splitOn}
      focused={pn.multiPane && (pn.activePane === 'editor' || pn.activePane === 'split') ? pn.activePane : null}
      onnarrow={(n) => (pn.splitNarrow = n)}
      ytext={session.ytext}
      editorView={() => ed.editorRef?.editorView() ?? null}
      ratio={editorSettings.value.previewRatio}
      prose={editorSettings.value.proseFont}
      onratio={(r) => editorSettings.update({ previewRatio: r })}
      ontoggletask={session.readOnly ? undefined : toggleTaskInEditor}
      onlink={ws.onMdLink}
    >
      <NoteEditor
        bind:this={ed.editorRef}
        {session}
        initialLine={ed.sourceLine}
        settings={editorSettings.value}
        onexit={ed.exitAnimated}
        onopensettings={() => uiState.openSettings('editor')}
        ontogglemode={() => editorSettings.toggleEditMode()}
        ontogglesplit={ed.toggleSplit}
        onstats={(st) => (ed.stats = st)}
        notes={() => notes.list}
        notePath={() => notes.selected?.path ?? notes.content?.path ?? ''}
        onopennote={ws.openLinkedNote}
        onvimstate={(st) => (ed.vimState = st)}
        onpane={pn.navigate}
        onpanepending={(p) => (cmd.panePending = p)}
        onquit={() => (pn.multi ? pn.closeLeaf(pn.primaryLeaf) : ed.exitAnimated())}
        onwin={(c, o) => pn.runWin(c, o)}
        onfollow={(l, where) => ws.followLink(l.href, where, ws.leafPath(pn.primaryLeaf), l.wiki, pn.primaryLeaf)}
        onhover={(l, r) => ws.hover.key(l, r, ws.leafPath(pn.primaryLeaf), pn.primaryLeaf)}
        onexplore={ws.explorer.open}
        onfocus={() => pn.markActive(pn.primaryLeaf)}
      />
    </SourceSplit>
  {/if}
</div>

<style>
  .editor-frame {
    position: relative;
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }
  /* Mode edge: the editing pane's left edge carries the vim mode's
     colour (normal = accent, insert = cyan, visual = violet, replace =
     red), fading downwards. Colour transitions only — never on the
     key path's critical work (it is one 2px layer). */
  .editor-frame.mode-edge::after {
    content: '';
    position: absolute;
    left: 0;
    top: var(--notebar-h);
    bottom: 0;
    width: 2px;
    background-color: var(--mode);
    -webkit-mask-image: linear-gradient(to bottom, black, transparent 75%);
    mask-image: linear-gradient(to bottom, black, transparent 75%);
    opacity: 0.85;
    pointer-events: none;
    transition: background-color 320ms var(--ease);
  }
  :global(.vault-home[data-vim='none']) .editor-frame.mode-edge::after { opacity: 0.35; }
  .mode-sweep {
    position: absolute;
    left: 0;
    top: var(--notebar-h);
    width: 3px;
    height: 38%;
    z-index: 3;
    pointer-events: none;
    border-radius: 2px;
    background: linear-gradient(to bottom, transparent, var(--mode) 40%, color-mix(in oklch, var(--mode) 60%, white) 85%, transparent);
    box-shadow: 0 0 14px 2px color-mix(in oklch, var(--mode) 55%, transparent);
    opacity: 0;
    animation: mode-sweep 520ms cubic-bezier(0.3, 0.6, 0.2, 1) both;
  }
  :global(.vault-home[data-vim='none']) .mode-sweep { display: none; }
  @keyframes mode-sweep {
    0% { opacity: 0; transform: translateY(-40%); }
    12% { opacity: 1; }
    75% { opacity: 0.9; }
    100% { opacity: 0; transform: translateY(190%); }
  }
  .editor-frame > .error { flex: none; padding: var(--sp-3) var(--sp-4); }
  .editor-scroll { flex: 1; min-height: 0; overflow-y: auto; padding: var(--sp-5) var(--sp-5) 0; }
  .rendered { max-width: calc(var(--md-measure) + 2px); margin: 0 auto; padding-bottom: 20vh; }
  .rendered :global(.md-body) { animation: resolve-in var(--spring-gentle-ms) var(--spring-gentle) both; }
  .note-bar {
    position: relative;
    flex: none;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-3);
    height: var(--notebar-h);
    padding: 0 var(--sp-2) 0 var(--sp-3);
    border-bottom: 1px solid var(--hairline-soft);
    background: color-mix(in oklch, var(--surface-1) 40%, var(--surface-0));
  }
  /* The mode also tints the bar's bottom edge (a soft line of light). */
  .editor-frame.mode-edge > .note-bar::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    bottom: -1px;
    height: 1px;
    background-color: var(--mode);
    -webkit-mask-image: linear-gradient(to right, black, transparent 60%);
    mask-image: linear-gradient(to right, black, transparent 60%);
    opacity: 0.6;
    transition: background-color var(--dur-fade) var(--ease);
  }
  .nb-lead { display: flex; gap: var(--sp-2); align-items: center; min-width: 0; flex: 1; }
  .nb-crumbs { flex: none; max-width: 30%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--ink-3); font-size: var(--text-sm); }
  .nb-sep { margin-left: 6px; color: var(--ink-4); }
  .nb-title {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    margin: 0 -6px;
    padding: 3px 6px;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text);
    font-size: var(--text-sm);
    font-weight: 600;
    letter-spacing: var(--tracking-ui);
    cursor: text;
    transition: background var(--dur-tap) var(--ease);
  }
  .nb-title:hover { background: var(--tint-hover); }
  .nb-actions { flex: none; display: flex; gap: 2px; align-items: center; }
  .nb-seg { margin-right: var(--sp-1); }
  .nb-seg button { height: 22px; padding: 0 10px; }
  .nb-icon { color: var(--ink-3); }
  .nb-icon:hover { color: var(--color-text); }
  .split-btn[aria-pressed='true'] { color: var(--accent-ink); background: var(--accent-soft); }
  .nb-divider { width: 1px; height: 16px; margin: 0 var(--sp-2); background: var(--hairline); }
  .nb-done { height: 26px; padding: 0 12px; }
  .conn-dot {
    position: relative;
    flex: none;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--ink-4);
    font-size: 0;
    color: transparent;
    transition: background var(--dur-fade) var(--ease), box-shadow var(--spring-gentle-ms) var(--spring-gentle);
  }
  .conn-connected { background: var(--color-accent); box-shadow: 0 0 0 3px color-mix(in oklch, var(--color-accent) 16%, transparent), 0 0 8px color-mix(in oklch, var(--color-accent) 50%, transparent); }
  .conn-connecting { background: var(--color-warning); animation: sync-breathe 1.6s var(--ease-breath) infinite; }
  .conn-disconnected { background: var(--color-error); }
  /* Presence: collaborators as living avatars — a ring in their colour,
     a breathing live dot, and a pop when they arrive. */
  .peers { display: flex; margin-left: var(--sp-1); padding-left: 4px; }
  .peer-chip {
    position: relative;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    font-size: 10px;
    font-weight: 700;
    color: var(--color-background);
    background:
      radial-gradient(circle at 30% 25%, color-mix(in oklch, white 35%, transparent), transparent 60%),
      var(--peer-color, var(--color-secondary));
    box-shadow: 0 0 0 2px var(--surface-0), 0 0 0 3.5px color-mix(in oklch, var(--peer-color) 45%, transparent), 0 2px 8px -2px color-mix(in oklch, var(--peer-color) 70%, transparent);
    margin-left: -5px;
    animation: peer-in var(--spring-bouncy-ms) var(--spring-bouncy) both;
    transition: transform var(--spring-snappy-ms) var(--spring-snappy);
  }
  .peer-chip:hover { transform: translateY(-2px) scale(1.08); z-index: 1; }
  .peer-live {
    position: absolute;
    right: -1px;
    bottom: -1px;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--ok);
    box-shadow: 0 0 0 2px var(--surface-0);
  }
  .peer-live::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: 50%;
    background: var(--ok);
    animation: presence-breathe var(--dur-breath) var(--ease-breath) infinite;
  }
  @keyframes peer-in { from { opacity: 0; transform: scale(0.4); } }

  .placeholder,
  .error {
    padding: var(--sp-6) var(--sp-4);
    color: var(--ink-3);
    text-align: center;
    font-size: var(--text-sm);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--sp-3);
  }
  .error { color: var(--color-error); }

  @media (max-width: 720px) {
    .note-bar { padding: 0 var(--sp-2) 0 var(--sp-3); gap: var(--sp-2); }
    .nb-crumbs, .nb-divider, .nb-settings { display: none; }
    .nb-seg button { padding: 0 8px; }
  }
</style>
