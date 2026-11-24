// Registers the part-2 structured note views with the pane registry
// (lib/note-views.ts): the kanban board for Obsidian Kanban notes
// (frontmatter `kanban-plugin: board|basic`) and the JSON Canvas view
// for `.canvas` files. Both default over markdown and offer a
// Board/Canvas ⇄ Note/Source switch in the pane header. Imported once
// by main.ts (and by tests that render panes).

import { registerNoteView } from './note-views.ts';
import { noteViewKind } from './note-kind.ts';

let done = false;

export function registerStructuredViews(): void {
  if (done) return;
  done = true;
  const load = () => import('../components/StructuredPaneView.svelte').then((m) => m.default);
  registerNoteView({
    id: 'kanban',
    label: 'Board',
    priority: 10,
    match: (n) => noteViewKind({ path: n.path, kind: n.kind, frontmatter: n.frontmatter ?? null }) === 'kanban',
    load,
  });
  registerNoteView({
    id: 'canvas',
    label: 'Canvas',
    priority: 10,
    match: (n) => noteViewKind({ path: n.path, kind: n.kind }) === 'canvas',
    load,
  });
}
