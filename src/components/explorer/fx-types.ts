// Types shared by the floating explorer (FloatingExplorer.svelte) and
// the view that runs its file operations.

import type { Entry, FolderEntry, NoteEntry } from '../../lib/notetree.ts';
import type { CreatePlan, RenamePlan, FolderRenamePlan } from '../../lib/fileops.ts';
import type { MillerNav } from '../../lib/miller.svelte.ts';

export type FxPrompt = { kind: 'create'; text: string } | { kind: 'rename'; text: string; entry: Entry };
export type FxPlan = CreatePlan | RenamePlan | FolderRenamePlan;
export type FxLevel = 'files' | 'books';
/** What the overlay does right after it opens (reader `a`, `r`, the
 *  context menu's Delete, the palette's "Filter…"). */
export type FxInitial = 'create' | 'createCanvas' | 'newFolder' | 'rename' | 'delete' | 'filter' | 'paste' | null;

/** File operations, run by the view. */
export interface FxOps {
  offline(): boolean;
  run(p: FxPrompt, plan: FxPlan, nav: MillerNav): Promise<void>;
  remove(entry: Entry): Promise<void>;
  paste(src: Entry, nav: MillerNav): Promise<void>;
  /** Drag a note onto a folder: move it there. Returns a status line. */
  move?(noteKey: string, folder: FolderEntry): Promise<string | null>;
  /** Copy a markdown link to the note. */
  copyLink?(entry: NoteEntry): void;
  refresh?(): void;
}
