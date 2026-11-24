<script lang="ts">
  // Note-view adapter (lib/note-views.ts) for the kanban board and the
  // JSON canvas: maps the pane's NoteViewProps onto StructuredNoteView.
  // Canvas file nodes open through the pane's link routing (book-root
  // paths), so `gf` opens here and Ctrl-w f / Cmd-click open a split.
  import type { NoteViewProps } from '../lib/note-views.ts';
  import StructuredNoteView from './StructuredNoteView.svelte';

  const p: NoteViewProps = $props();
  const kind = $derived(p.view === 'canvas' ? 'canvas' : 'kanban');

  function openFile(path: string, o: { split: boolean }): void {
    p.openLink('/' + path.replace(/^\/+/, ''), o.split ? 'vsplit' : 'current');
  }
</script>

{#key `${p.vaultID}/${p.noteID}/${kind}`}
  <StructuredNoteView
    vaultID={p.vaultID}
    noteID={p.noteID}
    {kind}
    body={p.body}
    title={p.title ?? ''}
    onsource={p.onsource}
    onopenfile={openFile}
    onlink={p.onlink}
    acquireSession={p.acquireSession}
    releaseSession={p.releaseSession}
  />
{/key}
