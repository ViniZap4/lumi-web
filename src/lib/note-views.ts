// Note view registry: which component shows a note in a pane.
//
// A pane renders a *note view* chosen by the note's kind. Markdown
// (the reader / Live Preview / Source editor) is built in and is the
// fallback; other kinds (kanban boards, JSON canvases, …) register a
// spec here and the pane renders their component instead, with a view
// switch in the pane header whenever more than one view matches (e.g.
// Board ⇄ Source for a kanban note).
//
// Registering a view (from the feature's own module, imported once by
// main.ts or lazily by the view):
//
//   registerNoteView({
//     id: 'kanban',
//     label: 'Board',
//     priority: 10,                      // > 0 beats markdown as default
//     match: (n) => n.frontmatter?.['kanban-plugin'] === 'board',
//     load: () => import('../components/KanbanView.svelte').then((m) => m.default),
//   });
//
// The component receives `NoteViewProps`. Edits MUST go through the
// live session (`acquireSession`) as minimal ranged Y.Text changes, so
// collaborative editing and the CRDT protocol rules hold.

import type { Component } from 'svelte';
import type { EditorSession } from './editor-session.svelte.ts';
import type { OpenWhere } from './link-open.ts';

export const MARKDOWN_VIEW = 'markdown';

export interface NoteViewMatch {
  /** Book-relative path (`notes/plan.md`, `boards/q3.canvas`). */
  path: string;
  /** Server file kind (`markdown` | `canvas`), when known. */
  kind?: string | null;
  /** Parsed frontmatter when known (null for files without it). */
  frontmatter?: Record<string, unknown> | null;
  /** Body text when already loaded (may be absent while loading). */
  body?: string | null;
}

export interface NoteViewProps {
  /** The registered view id being rendered (`kanban`, `canvas`, …). */
  view: string;
  vaultID: string;
  noteID: string;
  notePath: string;
  /** Latest known body (REST / replica); live edits arrive through
   *  the session once acquired. */
  body: string;
  /** This pane has keyboard focus. */
  active: boolean;
  /** Follow a link from this note (same routing as the reader). */
  openLink: (href: string, where: OpenWhere) => void;
  /** Join (or share) the note's live session. Returns an error string
   *  when editing is impossible (no account, signed out). */
  acquireSession: () => Promise<EditorSession | string>;
  releaseSession: (s: EditorSession) => void;
  /** Note title (for headers). */
  title?: string;
  /** Switch this pane to the markdown Source editor (Board ⇄ Source). */
  onsource?: () => void;
  /** A link clicked inside the view (plain / Cmd / Shift-Cmd click). */
  onlink?: (href: string, e: MouseEvent) => void;
}

export interface NoteViewSpec {
  id: string;
  /** Short label for the view switch (`Board`, `Canvas`). */
  label: string;
  /** Higher wins the default view; markdown is 0. */
  priority?: number;
  match: (n: NoteViewMatch) => boolean;
  load: () => Promise<Component<NoteViewProps>>;
}

const registry = new Map<string, NoteViewSpec>();

export function registerNoteView(spec: NoteViewSpec): () => void {
  if (spec.id === MARKDOWN_VIEW) throw new Error('markdown is built in');
  registry.set(spec.id, spec);
  return () => {
    if (registry.get(spec.id) === spec) registry.delete(spec.id);
  };
}

export function noteViewSpec(id: string): NoteViewSpec | null {
  return registry.get(id) ?? null;
}

/** Views available for a note, best first; markdown is always listed. */
export function viewsFor(n: NoteViewMatch): Array<{ id: string; label: string }> {
  const custom = [...registry.values()]
    .filter((s) => {
      try {
        return s.match(n);
      } catch {
        return false;
      }
    })
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  const md = { id: MARKDOWN_VIEW, label: /\.md$/i.test(n.path) || !/\.[a-z0-9]+$/i.test(n.path) ? 'Note' : 'Source' };
  const out = custom.map((s) => ({ id: s.id, label: s.label, p: s.priority ?? 0 }));
  const i = out.findIndex((s) => s.p <= 0);
  out.splice(i < 0 ? out.length : i, 0, { ...md, p: 0 });
  return out.map(({ id, label }) => ({ id, label }));
}

/** The view a pane shows: its override when still valid, else the
 *  note's default. */
export function resolveView(n: NoteViewMatch, override?: string | null): string {
  const vs = viewsFor(n);
  if (override && vs.some((v) => v.id === override)) return override;
  return vs[0].id;
}
