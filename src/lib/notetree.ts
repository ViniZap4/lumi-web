// Folder tree derived from note paths (wave 3, yazi/miller browser).
//
// The server has no folder objects: a folder exists because some note
// path lives under it. `buildTree` turns the flat note list into one
// sorted entry list per folder — folders first, then notes, both in
// natural, case-insensitive order (the TUI tree's ordering). It is
// pure and O(n log n); 10k notes build in a few ms, so callers simply
// re-derive it whenever the list changes.

import type { NoteSummary } from './types.ts';

export interface FolderEntry {
  kind: 'folder';
  /** Stable identity within the tree ("d:" + path). */
  key: string;
  name: string;
  /** Folder path relative to the book root, no leading/trailing '/'. */
  path: string;
  /** Direct children (folders + notes). */
  count: number;
}

export interface NoteEntry {
  kind: 'note';
  key: string;
  name: string;
  /** Normalised note path. */
  path: string;
  note: NoteSummary;
}

export type Entry = FolderEntry | NoteEntry;

export interface NoteTree {
  /** Folder path ('' = book root) → sorted entries. */
  folders: Map<string, Entry[]>;
  /** Note id → folder path. */
  noteDir: Map<string, string>;
  noteCount: number;
}

export const ROOT = '';

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** `./a//b\\c.md` → `a/b/c.md`. Drops empty, `.` and `..` segments so a
 *  hostile path can never climb above the book root in the UI. */
export function normalizePath(p: string): string {
  return (p ?? '')
    .replace(/\\/g, '/')
    .split('/')
    .filter((s) => s !== '' && s !== '.' && s !== '..')
    .join('/');
}

/** Folder of a (normalised) note path. */
export function dirOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? ROOT : path.slice(0, i);
}

/** Parent of a folder; null for the root. */
export function parentDir(dir: string): string | null {
  if (dir === ROOT) return null;
  return dirOf(dir);
}

export function baseName(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? path : path.slice(i + 1);
}

function stem(path: string): string {
  return baseName(path).replace(/\.md$/i, '');
}

export function folderKey(path: string): string {
  return 'd:' + path;
}

export function noteKey(id: string): string {
  return 'n:' + id;
}

export function buildTree(notes: readonly NoteSummary[]): NoteTree {
  const subdirs = new Map<string, Set<string>>([[ROOT, new Set()]]);
  const files = new Map<string, NoteEntry[]>([[ROOT, []]]);
  const noteDir = new Map<string, string>();

  const ensureDir = (dir: string): void => {
    // Register `dir` and every ancestor, linking each to its parent,
    // stopping at the first one already known (ROOT always is).
    let child: string | null = null;
    for (;;) {
      const known = subdirs.has(dir);
      if (!known) {
        subdirs.set(dir, new Set());
        files.set(dir, []);
      }
      if (child !== null) subdirs.get(dir)!.add(child);
      if (known) return;
      child = dir;
      dir = dirOf(dir);
    }
  };

  for (const n of notes) {
    if (noteDir.has(n.id)) continue;
    const path = normalizePath(n.path || n.id + '.md');
    const dir = dirOf(path);
    ensureDir(dir);
    noteDir.set(n.id, dir);
    files.get(dir)!.push({
      kind: 'note',
      key: noteKey(n.id),
      name: n.title?.trim() || stem(path),
      path,
      note: n,
    });
  }

  const folders = new Map<string, Entry[]>();
  for (const [dir, subs] of subdirs) {
    const folderEntries: FolderEntry[] = [];
    for (const sub of subs) {
      folderEntries.push({
        kind: 'folder',
        key: folderKey(sub),
        name: baseName(sub),
        path: sub,
        count: subdirs.get(sub)!.size + files.get(sub)!.length,
      });
    }
    folderEntries.sort((a, b) => collator.compare(a.name, b.name));
    const noteEntries = files.get(dir)!;
    noteEntries.sort((a, b) => collator.compare(a.name, b.name) || collator.compare(a.path, b.path));
    folders.set(dir, [...folderEntries, ...noteEntries]);
  }
  return { folders, noteDir, noteCount: noteDir.size };
}

export const EMPTY_TREE: NoteTree = buildTree([]);

/** Case-insensitive substring filter on the entry name (and, for
 *  notes, the file name). Empty query = identity. */
export function filterEntries(entries: readonly Entry[], query: string): readonly Entry[] {
  const q = query.trim().toLowerCase();
  if (!q) return entries;
  return entries.filter(
    (e) => e.name.toLowerCase().includes(q) || (e.kind === 'note' && baseName(e.path).toLowerCase().includes(q)),
  );
}

/** Nearest folder that still exists (notes moved/deleted under us). */
export function nearestExisting(tree: NoteTree, dir: string): string {
  let d: string | null = dir;
  while (d != null && !tree.folders.has(d)) d = parentDir(d);
  return d ?? ROOT;
}

/** Breadcrumb segments from the root to `dir` (root first). */
export function breadcrumb(dir: string): Array<{ name: string; path: string }> {
  const out = [{ name: '/', path: ROOT }];
  if (dir === ROOT) return out;
  const parts = dir.split('/');
  for (let i = 0; i < parts.length; i++) {
    out.push({ name: parts[i], path: parts.slice(0, i + 1).join('/') });
  }
  return out;
}
