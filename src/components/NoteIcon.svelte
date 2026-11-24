<script lang="ts">
  // Kind glyph for a note (lib/note-icons.ts): markdown page, canvas
  // graph, kanban columns, folder.
  import { NOTE_ICON_PATH, type NoteIconKind } from '../lib/note-icons.ts';

  const { kind, size = 14 }: { kind: NoteIconKind; size?: number } = $props();
</script>

<svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true" data-kind={kind} class="note-icon"><path d={NOTE_ICON_PATH[kind]} fill={kind === 'folder' ? 'currentColor' : 'none'} fill-opacity={kind === 'folder' ? 0.18 : undefined} stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" stroke-linecap="round"/></svg>
