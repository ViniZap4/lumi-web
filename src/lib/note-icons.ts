// One glyph per note kind (explorer rows, palette results, pane headers,
// breadcrumbs) and a kind suffix when two notes in one list share a
// title ("test · canvas" next to "test"). Kanban needs the frontmatter,
// which only the note's content has: callers pass it when they have it
// (e.g. a cached body), otherwise a board shows as a note.

import { noteViewKind, type NoteViewKind } from './note-kind.ts';

export type NoteIconKind = NoteViewKind | 'folder';

/** 16×16 stroke paths (currentColor, stroke-width 1.2). */
export const NOTE_ICON_PATH: Record<NoteIconKind, string> = {
  // A page with a folded corner.
  markdown: 'M4.5 2h4.6L12 4.9v8.6a.5.5 0 0 1-.5.5h-7a.5.5 0 0 1-.5-.5v-11a.5.5 0 0 1 .5-.5z M9 2v3h3',
  // Three linked nodes (a graph / board).
  canvas: 'M2.5 3.5h4v3h-4z M9.5 2.5h4v3h-4z M7 10h4v3.5H7z M6.5 5l3-1 M4.5 6.5 7.5 10 M11.5 5.5 9.5 10',
  // Three columns of different heights.
  kanban: 'M2.5 2.5h3v11h-3z M6.5 2.5h3v7h-3z M10.5 2.5h3v9h-3z',
  folder: 'M2 4.5A1.5 1.5 0 0 1 3.5 3h2.8l1.4 1.5h4.8A1.5 1.5 0 0 1 14 6v5.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5z',
};

export const NOTE_KIND_LABEL: Record<NoteViewKind, string> = { markdown: 'note', canvas: 'canvas', kanban: 'board' };

/** Icon kind of a note (summary + optional content for kanban). */
export function noteIconKind(
  note: { path?: string | null; kind?: string | null } | null | undefined,
  content?: { kind?: string | null; frontmatter?: Record<string, unknown> | null } | null,
): NoteViewKind {
  return noteViewKind({ path: note?.path ?? null, kind: content?.kind ?? note?.kind ?? null, frontmatter: content?.frontmatter ?? null });
}

/**
 * Display names for a list: a name shared by notes of different kinds
 * gets its kind as a suffix (`test · canvas`). Same-kind duplicates and
 * unique names are left alone (folders and paths tell those apart).
 */
export function disambiguateTitles<T extends { name: string; kind: NoteViewKind | null }>(items: readonly T[]): string[] {
  const kinds = new Map<string, Set<string>>();
  for (const it of items) {
    if (!it.kind) continue;
    const k = it.name.trim().toLowerCase();
    let s = kinds.get(k);
    if (!s) kinds.set(k, (s = new Set()));
    s.add(it.kind);
  }
  return items.map((it) => {
    if (!it.kind) return it.name;
    const s = kinds.get(it.name.trim().toLowerCase());
    return s && s.size > 1 ? `${it.name} · ${NOTE_KIND_LABEL[it.kind]}` : it.name;
  });
}
