<script lang="ts">
  // The primary pane's reading view: a sticky head (crumbs, views,
  // words, split, publish, Edit, delete) over the rendered note.
  import { vaults } from '../../lib/vaults.svelte.ts';
  import { notes } from '../../lib/notes.svelte.ts';
  import { books } from '../../lib/books.svelte.ts';
  import * as api from '../../lib/api.ts';
  import { ApiError } from '../../lib/types.ts';
  import { toasts } from '../../lib/toasts.svelte.ts';
  import { editorSettings } from '../../lib/editor-settings.svelte.ts';
  import { keyLabel } from '../../lib/platform.ts';
  import { renderBlocks, taskToggle, startsWithTitle } from '../../lib/markdown.ts';
  import { toggleTaskHeadless } from '../../lib/editor-boot.ts';
  import { canTogglePublish, isPublished } from '../../lib/publish.ts';
  import { countWords, readingTime } from '../../lib/textstats.ts';
  import MarkdownView from '../../components/MarkdownView.svelte';
  import ZoomBadge from './ZoomBadge.svelte';
  import ZoomButton from './ZoomButton.svelte';
  import { OFFLINE_HINT } from './explorer.svelte.ts';
  import { useWorkspace } from './context.ts';

  const ws = useWorkspace();
  const { panes: pn, edit: ed, explorer: ex } = ws;

  // Sanitised preview HTML, recomputed on every content change (the
  // block cache in lib/markdown keeps unchanged blocks).
  const previewBlocks = $derived(notes.content ? renderBlocks(notes.content.body ?? '') : []);
  const readingWords = $derived(notes.content ? countWords(notes.content.body ?? '') : 0);
  const readingMinutes = $derived(readingTime(readingWords));
  /** The body opens with `# <title>`: don't print the title twice. */
  const titleInBody = $derived(!!notes.content && startsWithTitle(notes.content.body ?? '', notes.selected?.title ?? ''));

  // M3: per-note "Publicar" (frontmatter publish: true; markdown only,
  // needs note.edit). Offered on books that are a federation home, or
  // when the note is already published.
  const published = $derived(isPublished(notes.content?.frontmatter));
  const showPublish = $derived(
    !!notes.content &&
      canTogglePublish({ path: notes.content.path, kind: notes.content.kind, canEdit: !ws.readOnlyBook }) &&
      (published || (!!vaults.selectedID && books.info[vaults.selectedID]?.federation?.role === 'home')),
  );
  let publishBusy = $state(false);

  async function togglePublish(): Promise<void> {
    const v = vaults.selectedID;
    const c = notes.content;
    if (!v || !c || publishBusy) return;
    const next = !published;
    publishBusy = true;
    try {
      await api.updateNote(v, c.id, { publish: next });
      if (notes.content?.id === c.id) {
        const fm = { ...notes.content.frontmatter };
        if (next) fm.publish = true;
        else delete fm.publish;
        notes.content = { ...notes.content, frontmatter: fm };
      }
      toasts.push(next ? 'Nota marcada para publicação.' : 'Nota despublicada.', 'info');
    } catch (e) {
      toasts.push(e instanceof ApiError && e.status === 403 ? 'Sem permissão para publicar esta nota.' : `Não foi possível mudar a publicação: ${(e as Error).message}`, 'error');
    } finally {
      publishBusy = false;
    }
  }

  /** Toggle a task without opening the editor — a headless live session
   *  applies the single-character ranged change. The checkbox flips
   *  immediately; a failure reverts it. */
  async function toggleTaskFromReader(index: number): Promise<void> {
    const vid = vaults.selectedID;
    const id = notes.selectedID;
    const body = notes.content?.body ?? '';
    if (!vid || !id || books.isReadOnly(vid)) return; // viewer / mirror: never an edit ticket
    const ch = taskToggle(body, index);
    if (!ch) return;
    notes.applyLocalBody(id, body.slice(0, ch.from) + ch.insert + body.slice(ch.to));
    const r = await toggleTaskHeadless(vid, id, index);
    if ('error' in r) {
      if (notes.selectedID === id) notes.applyLocalBody(id, body);
      ws.flash(r.error, 'warn');
    } else if (notes.selectedID === id) {
      notes.applyLocalBody(id, r.text);
    }
  }

  function zoomOnDblClick(e: MouseEvent): void {
    if (pn.multi && !(e.target as Element).closest('button, input')) pn.toggleZoom(pn.primaryLeaf);
  }
</script>

<article class="rendered lumi-prose" data-prose={editorSettings.value.proseFont}>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <header class="reading-head" ondblclick={zoomOnDblClick}>
    {#if pn.zoomed === pn.primaryLeaf}<ZoomBadge />{/if}
    {#if ws.noteCrumbs.length > 0}
      <nav class="note-crumbs" aria-label="Note location">
        {#each ws.noteCrumbs as c, i (i)}{#if i > 0}<span class="crumb-sep" aria-hidden="true">/</span>{/if}<span class="crumb-part">{c}</span>{/each}
      </nav>
    {/if}
    <div class="rendered-actions">
      {#if ws.primaryViews.length > 1}
        <div class="ui-seg nb-seg" role="group" aria-label="View">
          {#each ws.primaryViews as v (v.id)}
            <button type="button" class:active={ws.primaryView === v.id} aria-pressed={ws.primaryView === v.id} onclick={() => pn.setPrimaryView(v.id === ws.primaryViews[0].id ? null : v.id)}>{v.label}</button>
          {/each}
        </div>
      {/if}
      {#if notes.contentStale}<span class="stale" data-testid="content-stale">cópia local (offline)</span>{/if}
      <span class="reading-meta">{readingWords} {readingWords === 1 ? 'word' : 'words'} · {readingMinutes} min</span>
      <button class="ui-btn ghost sm icon" type="button" onclick={() => void pn.splitWith('row', null, pn.primaryLeaf)} aria-label="Split right" title="Split right (⌃w v · :vsplit)">
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M8 3v10" stroke="currentColor" stroke-width="1.3"/></svg>
      </button>
      {#if pn.multi}<ZoomButton />{/if}
      {#if showPublish}
        <button class="ui-btn ghost sm nb-publish" class:on={published} type="button" aria-pressed={published} disabled={publishBusy || ws.structuralOffline} onclick={() => void togglePublish()} data-testid="note-publish"
          title={published ? 'Publicada: o espelho pode mostrá-la a qualquer pessoa. Clique para despublicar.' : 'Publicar: o espelho com publicação poderá mostrá-la a qualquer pessoa, sem login.'}>{published ? 'Publicada' : 'Publicar'}</button>
      {/if}
      <button class="ui-btn sm nb-edit" onclick={() => void ed.enter()} disabled={ed.loading} type="button" title={ws.readOnlyBook ? 'Ver ao vivo, somente leitura (e)' : `Edit (e · ${keyLabel('⌘E')})`}>{ed.loading ? 'Loading…' : ws.readOnlyBook ? 'Ao vivo' : 'Edit'}</button>
      <button class="ui-btn ghost sm icon danger-hover" onclick={ex.beginDelete} type="button" aria-label="Delete note"
        disabled={ws.structuralOffline} title={ws.structuralOffline ? OFFLINE_HINT : 'Delete (d)'}>
        <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
    </div>
  </header>
  {#if !titleInBody}<h1 class="rendered-title" data-vt-target="note-title">{notes.selected?.title}</h1>{/if}
  <!-- DOMPurify-sanitised blocks, see lib/markdown.ts. -->
  <MarkdownView blocks={previewBlocks} onlink={ws.onMdLink} ontoggletask={ws.readOnlyBook ? undefined : (i) => void toggleTaskFromReader(i)} />
</article>

<style>
  /* Typeface, size and leading come from .lumi-prose (app.css), shared
     with the split preview and Live Preview. */
  .rendered {
    max-width: calc(var(--md-measure) + 2px);
    margin: 0 auto;
    padding-bottom: 20vh;
  }
  .reading-head {
    --zoom-badge-gap: var(--sp-2);
    position: sticky;
    top: calc(-1 * var(--pad-top));
    z-index: 2;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-3);
    min-height: 28px;
    margin: calc(-1 * var(--pad-top)) 0 var(--sp-3);
    padding: var(--sp-2) 0;
    font-family: var(--font-ui);
    font-size: var(--text-md);
    line-height: 1.4;
    background: linear-gradient(to bottom, var(--surface-0) 70%, transparent);
  }
  .note-crumbs {
    display: flex;
    align-items: baseline;
    gap: 6px;
    min-width: 0;
    font-size: var(--text-sm);
    color: var(--ink-3);
    overflow: hidden;
    white-space: nowrap;
  }
  .crumb-part { overflow: hidden; text-overflow: ellipsis; }
  .crumb-sep { color: var(--ink-4); }
  .rendered-actions { display: flex; gap: var(--sp-1); align-items: center; margin-left: auto; }
  .nb-seg { margin-right: var(--sp-1); }
  .nb-seg button { height: 22px; padding: 0 10px; }
  .stale { color: var(--color-warning); font-size: var(--text-xs); }
  .reading-meta { color: var(--ink-3); font-size: var(--text-xs); font-variant-numeric: tabular-nums; margin-right: var(--sp-2); }
  .rendered-title {
    margin: 0 0 0.6em;
    font-size: 2.05em;
    line-height: 1.12;
    font-weight: 720;
    letter-spacing: -0.028em;
    color: var(--md-heading);
    text-wrap: balance;
  }
  .rendered :global(.md-body) { animation: resolve-in var(--spring-gentle-ms) var(--spring-gentle) both; }
  .danger-hover:hover { color: var(--color-error); }
  .nb-publish.on { color: var(--color-primary); border-color: color-mix(in srgb, var(--color-primary) 45%, transparent); }

  @media (max-width: 720px) {
    .nb-seg button { padding: 0 8px; }
  }
</style>
