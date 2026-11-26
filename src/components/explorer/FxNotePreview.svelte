<script lang="ts">
  // The explorer's note preview: an excerpt through the shared (sanitised)
  // renderer, or a mini canvas / mini board. A lazy chunk: markdown
  // rendering stays out of the app shell.
  import { untrack, onDestroy } from 'svelte';
  import { dirOf } from '../../lib/notetree.ts';
  import { loadNote, peekNote } from '../../lib/note-content.ts';
  import { previewExcerpt, updatedLabel } from '../../lib/hover-preview.ts';
  import { renderBlocks } from '../../lib/markdown.ts';
  import { previewKindFor } from '../../lib/preview/structured-preview.ts';
  import { editorSettings } from '../../lib/editor-settings.svelte.ts';
  import type { NoteContent, NoteSummary } from '../../lib/types.ts';
  import MarkdownView from '../MarkdownView.svelte';
  import CanvasMini from '../CanvasMini.svelte';
  import KanbanMini from '../KanbanMini.svelte';
  import NoteIcon from '../NoteIcon.svelte';

  const { vaultID, note, onopen }: { vaultID: string; note: NoteSummary; onopen: () => void } = $props();

  let previewBody = $state<string | null>(null);
  /** Full content: canvases / boards preview as a mini canvas / board. */
  let previewContent = $state<NoteContent | null>(null);
  let previewErr = $state<string | null>(null);
  let previewTimer: ReturnType<typeof setTimeout> | null = null;
  $effect(() => {
    const n = note;
    untrack(() => {
      if (previewTimer) clearTimeout(previewTimer);
      previewErr = null;
      const hit = peekNote(vaultID, n.id);
      previewBody = hit ? previewExcerpt(hit.content.body, 120).text : null;
      previewContent = hit ? hit.content : null;
      // Holding j/k must not fire one request per row.
      previewTimer = setTimeout(() => {
        loadNote(vaultID, n.id).then(
          (r) => {
            if (note.id !== n.id) return;
            previewContent = r.content;
            previewBody = previewExcerpt(r.content.body, 120).text;
          },
          (e) => { if (note.id === n.id) previewErr = (e as Error).message; },
        );
      }, hit ? 0 : 90);
    });
  });
  onDestroy(() => {
    if (previewTimer) clearTimeout(previewTimer);
  });

  const kind = $derived(previewKindFor(note, previewContent?.id === note.id ? previewContent : null));
  // Only markdown previews render the excerpt as blocks.
  const blocks = $derived(previewBody != null && kind === 'markdown' ? renderBlocks(previewBody) : []);
</script>

<div class="fx-note">
  <div class="fx-note-head">
    <span class="fx-note-title"><NoteIcon {kind} size={15} /> {note.title}</span>
    <span class="fx-note-meta">{dirOf(note.path) || '/'} · {updatedLabel(note.updated_at)}</span>
  </div>
  {#if kind === 'canvas' && previewContent?.id === note.id}
    <CanvasMini text={previewContent.body ?? ''} {onopen} />
  {:else if kind === 'kanban' && previewContent?.id === note.id}
    <KanbanMini text={previewContent.body ?? ''} {onopen} />
  {:else if previewBody != null && kind === 'markdown'}
    <div class="lumi-prose compact" data-prose={editorSettings.value.proseFont}><MarkdownView rise={false} {blocks} /></div>
  {:else if previewErr}
    <div class="fx-empty err">{previewErr}</div>
  {:else}
    <div class="fx-skel" aria-hidden="true"><span class="skeleton"></span><span class="skeleton short"></span><span class="skeleton"></span><span class="skeleton mid"></span></div>
  {/if}
</div>

<style>
  /* The preview: a note card that resolves out of its skeleton. */
  .fx-note { padding: var(--sp-5) var(--sp-5) var(--sp-6); animation: resolve-in var(--spring-gentle-ms) var(--spring-gentle) both; }
  .fx-note-head { display: flex; flex-direction: column; gap: 3px; padding-bottom: var(--sp-3); margin-bottom: var(--sp-4); border-bottom: 1px solid var(--hairline-soft); }
  .fx-note-title { font-weight: 700; font-size: var(--text-xl); letter-spacing: var(--tracking-tight); line-height: 1.2; }
  .fx-note-meta { font-family: var(--font-mono); font-size: var(--text-2xs); color: var(--ink-3); }
  .fx-empty { padding: var(--sp-6); text-align: center; color: var(--ink-3); font-size: var(--text-sm); }
  .fx-empty.err { color: var(--color-error); }
  .fx-skel { display: flex; flex-direction: column; gap: 10px; }
  .fx-skel span { display: block; height: 10px; border-radius: 5px; }
  .fx-skel .short { width: 55%; }
  .fx-skel .mid { width: 78%; }
</style>
