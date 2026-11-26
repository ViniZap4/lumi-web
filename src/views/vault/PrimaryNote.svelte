<script lang="ts">
  // The primary pane's content: the open note as a reader, the live
  // editor, or a structured view (board / canvas), with its loading,
  // error and conflict-copy states. A lazy chunk of the book shell
  // (it is where markdown rendering enters).
  import { vaults } from '../../lib/vaults.svelte.ts';
  import { notes } from '../../lib/notes.svelte.ts';
  import { offline } from '../../lib/offline.svelte.ts';
  import { acquireEditorSession, editorPool } from '../../lib/editor-boot.ts';
  import { MARKDOWN_VIEW } from '../../lib/note-views.ts';
  import NoteViewHost from '../../components/NoteViewHost.svelte';
  import EditorFrame from './EditorFrame.svelte';
  import NoteReader from './NoteReader.svelte';
  import { exportConflict, copyConflict } from './conflicts.ts';
  import { useWorkspace } from './context.ts';

  const ws = useWorkspace();
  const { panes: pn, edit: ed } = ws;

  function openSource(o: { line?: number } | undefined): void {
    ed.sourceLine = o?.line ?? null;
    pn.setPrimaryView(MARKDOWN_VIEW);
    void ed.enter().then(() => {
      if (o?.line != null) ed.editorRef?.gotoLine(o.line);
    });
  }
</script>

{#if !notes.selectedID}
  <div class="placeholder">No note open</div>
{:else if notes.loadingContent && !notes.content}
  <!-- Skeleton shimmer while the body loads. -->
  <article class="rendered lumi-prose" aria-busy="true" data-testid="reader-skeleton">
    <h1 class="rendered-title" data-vt-target="note-title">{notes.selected?.title ?? ''}</h1>
    <div class="reader-skel" aria-hidden="true">
      {#each [94, 88, 97, 62, 0, 91, 85, 73] as w, i (i)}{#if w}<span class="skeleton" style="width: {w}%"></span>{:else}<span class="gap"></span>{/if}{/each}
    </div>
  </article>
{:else if notes.contentError}
  <div class="error">{notes.contentError}</div>
{:else if notes.content}
  {#each ws.noteConflicts as c (c.id)}
    <div class="banner conflict" role="status" data-testid="conflict-copy">
      <span>
        Cópia local em conflito ({c.reason === 'deleted' ? 'a nota foi apagada no servidor' : c.reason === 'lineage' ? 'outra versão da nota' : 'acesso revogado'}),
        salva em {new Date(c.at).toLocaleString()}. Ela não foi mesclada.
      </span>
      <span class="banner-actions">
        <button class="ui-btn sm" type="button" onclick={() => exportConflict(c)}>Baixar</button>
        <button class="ui-btn sm" type="button" onclick={() => void copyConflict(c)}>Copiar</button>
        <button class="ui-btn sm ghost" type="button" onclick={() => void offline.discardConflict(c.id)}>Descartar</button>
      </span>
    </div>
  {/each}
  {#if ws.primaryView !== MARKDOWN_VIEW && vaults.selectedID && notes.selectedID}
    <!-- The board / canvas brings its own title bar and Board ⇄ Source toggle. -->
    <div class="view-frame">
      <NoteViewHost
        view={ws.primaryView}
        vaultID={vaults.selectedID}
        noteID={notes.selectedID}
        notePath={ws.leafPath(pn.primaryLeaf)}
        body={notes.content.body ?? ''}
        active={pn.activeLeafId === pn.primaryLeaf}
        openLink={(href, where) => ws.followLink(href, where, ws.leafPath(pn.primaryLeaf), false, pn.primaryLeaf)}
        acquireSession={() => acquireEditorSession(vaults.selectedID!, notes.selectedID!)}
        releaseSession={(x) => editorPool.release(x)}
        title={notes.selected?.title ?? ''}
        onsource={openSource}
        onlink={ws.onMdLink}
      />
    </div>
  {:else if ed.mode && ed.session && ed.NoteEditor}
    <EditorFrame session={ed.session} NoteEditor={ed.NoteEditor} />
  {:else if ed.loading}
    <div class="reader-skel editor-skel" aria-busy="true" aria-label="Loading editor">
      {#each [70, 92, 85, 40, 96, 77] as w, i (i)}<span class="skeleton" style="width: {w}%"></span>{/each}
    </div>
  {:else}
    <NoteReader />
  {/if}
{/if}

<style>
  .rendered {
    max-width: calc(var(--md-measure) + 2px);
    margin: 0 auto;
    padding-bottom: 20vh;
  }
  .rendered-title {
    margin: 0 0 0.6em;
    font-size: 2.05em;
    line-height: 1.12;
    font-weight: 720;
    letter-spacing: -0.028em;
    color: var(--md-heading);
    text-wrap: balance;
  }
  .reader-skel { display: flex; flex-direction: column; gap: 12px; padding-top: var(--sp-2); }
  .reader-skel .skeleton { height: 12px; border-radius: 6px; }
  .reader-skel .gap { height: 8px; }
  .editor-skel { max-width: calc(var(--md-measure) + 2px); margin: var(--sp-6) auto; padding: 0 var(--sp-5); }
  .view-frame { display: flex; flex-direction: column; height: 100%; min-height: 0; }
  .view-frame > :global(:last-child) { flex: 1; min-height: 0; }

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
  .banner {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--sp-3);
    flex-wrap: wrap;
    margin: 0 auto var(--sp-3);
    max-width: calc(var(--md-measure) + 2px);
    padding: 3px var(--sp-1) 3px var(--sp-3);
    min-height: 28px;
    background: var(--accent-wash);
    border: 1px solid var(--accent-soft);
    border-radius: var(--radius);
    font-size: var(--text-xs);
    animation: settle-in var(--spring-gentle-ms) var(--spring-gentle) both;
  }
  .banner.conflict {
    background: color-mix(in oklch, var(--color-warning) 10%, transparent);
    border-color: color-mix(in oklch, var(--color-warning) 40%, transparent);
  }
  .banner-actions { display: inline-flex; gap: var(--sp-1); flex-wrap: wrap; }
</style>
