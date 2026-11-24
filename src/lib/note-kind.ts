// Which view a note gets: plain markdown (reader/editor), a kanban
// board or a canvas. This is the single switch a note pane consults
// (SPEC-PARTE2 §5/§6). Server DTOs may carry `kind: "markdown" |
// "canvas"`; older servers do not, so the file extension decides.

import { kanbanFormatOf, isKanbanText } from './kanban/kanban.ts';

export type NoteViewKind = 'markdown' | 'kanban' | 'canvas';

export interface NoteKindInput {
  path?: string | null;
  kind?: string | null;
  frontmatter?: Record<string, unknown> | null;
  /** Full file text (with frontmatter), when that is what the caller has. */
  text?: string | null;
}

export function isCanvasPath(path: string | null | undefined): boolean {
  return !!path && /\.canvas$/i.test(path);
}

export function noteViewKind(n: NoteKindInput | null | undefined): NoteViewKind {
  if (!n) return 'markdown';
  if (n.kind === 'canvas' || (!n.kind && isCanvasPath(n.path))) return 'canvas';
  if (kanbanFormatOf(n.frontmatter ?? null)) return 'kanban';
  if (n.text && isKanbanText(n.text)) return 'kanban';
  return 'markdown';
}
