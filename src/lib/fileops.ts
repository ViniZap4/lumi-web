// Explorer file operations, as pure plans (yazi grammar, Apple parity).
//
// The server has no folder objects: a folder exists because a note
// path lives under it, and POST /notes always creates `<slug>.md` at
// the book root. So:
//   - `a name`        → create note "name" in the current folder
//                       (POST, then PATCH path into the folder)
//   - `a a/b/name`    → same, in a/b under the current folder (made on
//                       the fly by the PATCH: the server mkdir -p's)
//   - `a dir/`        → a folder: kept client-side (virtual) until a
//                       note lands in it
//   - `r name`        → rename the title
//   - `r dir/name`    → move (relative to the note's folder; leading
//                       `/` = from the book root, `..` climbs) + retitle
//   - `r dir/`        → move, keep the title
//   - `r file.md`     → set the file name explicitly
//   - `a name.canvas` → create a JSON Canvas (POST kind:"canvas")
// Canvases have no title of their own (title = file name), so every
// canvas rename is a move that keeps the `.canvas` extension.
// Paths are validated with the server's canonical-form rules (no dot
// segments, no backslashes, bounded) so errors show before a request.

import { baseName, dirOf, normalizePath } from './notetree.ts';

export const MAX_PATH_BYTES = 512;

export type CreatePlan =
  | { kind: 'folder'; path: string }
  | { kind: 'note'; title: string; folder: string; noteKind?: 'canvas' }
  | { kind: 'error'; message: string };

export type RenamePlan =
  | { kind: 'note'; title?: string; path?: string }
  | { kind: 'none' }
  | { kind: 'error'; message: string };

export type FolderRenamePlan =
  | { kind: 'folder'; from: string; to: string }
  | { kind: 'none' }
  | { kind: 'error'; message: string };

/**
 * Resolve `input` against `base` (a folder path, '' = root): `/x` is
 * from the root, `..` climbs (clamped at the root), `.`/empty segments
 * vanish. Returns the normalised path (no leading/trailing slash).
 */
export function resolvePath(base: string, input: string): string {
  const abs = input.startsWith('/');
  const parts = abs ? [] : base.split('/').filter(Boolean);
  for (const seg of input.replace(/\\/g, '/').split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return parts.join('/');
}

/** Server canonical-form check for a folder or note path. */
export function pathError(path: string): string | null {
  if (!path) return 'empty path';
  if (new TextEncoder().encode(path).length > MAX_PATH_BYTES) return 'path is too long';
  if (/[\u0000-\u001f\u007f\\]/.test(path)) return 'control characters and backslashes are not allowed';
  for (const seg of path.split('/')) {
    if (seg.startsWith('.')) return `“${seg}”: names cannot start with a dot`;
    if (seg.trim() !== seg) return `“${seg}”: names cannot start or end with spaces`;
  }
  return null;
}

/** File stem used as a note title. */
export function stem(path: string): string {
  return baseName(path).replace(/\.(md|canvas)$/i, '');
}

export function planCreate(dir: string, raw: string): CreatePlan {
  const input = raw.trim();
  if (!input || input === '/') return { kind: 'error', message: 'type a name (end with / for a folder)' };
  const isFolder = input.endsWith('/');
  const rel = resolvePath(dir, input);
  if (!rel) return { kind: 'error', message: 'that resolves to the book root' };
  const err = pathError(rel);
  if (err) return { kind: 'error', message: err };
  if (isFolder) return { kind: 'folder', path: rel };
  const title = stem(rel).trim();
  if (!title) return { kind: 'error', message: 'the note needs a name' };
  if (/\.canvas$/i.test(rel)) return { kind: 'note', title, folder: dirOf(rel), noteKind: 'canvas' };
  return { kind: 'note', title, folder: dirOf(rel) };
}

/** Rename/move a note. `notePath` is its current path, `title` its
 *  current title. */
export function planRename(notePath: string, title: string, raw: string): RenamePlan {
  const input = raw.trim();
  if (!input) return { kind: 'error', message: 'type a new name' };
  const current = normalizePath(notePath);
  const dir = dirOf(current);
  if (/\.canvas$/i.test(current)) return planCanvasRename(current, input);
  if (!input.includes('/')) {
    if (/\.md$/i.test(input)) {
      const path = dir ? `${dir}/${input}` : input;
      const err = pathError(path);
      if (err) return { kind: 'error', message: err };
      return path === current ? { kind: 'none' } : { kind: 'note', path };
    }
    return input === title ? { kind: 'none' } : { kind: 'note', title: input };
  }
  const isFolder = input.endsWith('/');
  const rel = resolvePath(dir, input);
  const folder = isFolder ? rel : dirOf(rel);
  const last = isFolder ? '' : baseName(rel);
  const file = /\.md$/i.test(last) ? last : baseName(current);
  const path = folder ? `${folder}/${file}` : file;
  const err = pathError(path);
  if (err) return { kind: 'error', message: err };
  const plan: { kind: 'note'; title?: string; path?: string } = { kind: 'note' };
  if (path !== current) plan.path = path;
  if (last && !/\.md$/i.test(last) && last !== title) plan.title = last;
  return plan.path || plan.title ? plan : { kind: 'none' };
}

/** A canvas rename is always a move to `<name>.canvas` (the server
 *  rejects title PATCHes on canvases and kind changes on moves). */
function planCanvasRename(current: string, input: string): RenamePlan {
  if (/\.md$/i.test(input)) return { kind: 'error', message: 'a canvas keeps its .canvas extension' };
  const dir = dirOf(current);
  const isFolder = input.endsWith('/');
  const rel = input.includes('/') ? resolvePath(dir, input) : dir ? `${dir}/${input}` : input;
  const folder = isFolder ? rel : dirOf(rel);
  const last = isFolder ? '' : baseName(rel);
  const file = !last ? baseName(current) : /\.canvas$/i.test(last) ? last : `${last}.canvas`;
  const path = folder ? `${folder}/${file}` : file;
  const err = pathError(path);
  if (err) return { kind: 'error', message: err };
  return path === current ? { kind: 'none' } : { kind: 'note', path };
}

/** Rename/move a folder (every note under it moves). */
export function planFolderRename(folderPath: string, raw: string): FolderRenamePlan {
  const input = raw.trim().replace(/\/+$/, '');
  if (!input) return { kind: 'error', message: 'type a new folder name' };
  const parent = dirOf(folderPath);
  const to = input.includes('/') ? resolvePath(parent, input) : parent ? `${parent}/${input}` : input;
  if (!to) return { kind: 'error', message: 'that resolves to the book root' };
  const err = pathError(to);
  if (err) return { kind: 'error', message: err };
  if (to === folderPath) return { kind: 'none' };
  if (to.startsWith(folderPath + '/')) return { kind: 'error', message: 'a folder cannot move inside itself' };
  return { kind: 'folder', from: folderPath, to };
}

/** New path of a note when folder `from` becomes `to`. */
export function movedPath(notePath: string, from: string, to: string): string | null {
  const p = normalizePath(notePath);
  if (!p.startsWith(from + '/')) return null;
  return to + p.slice(from.length);
}

/** Title for a pasted copy that does not collide with `taken` titles. */
export function copyTitle(title: string, taken: ReadonlySet<string>): string {
  const base = `${title} copy`;
  if (!taken.has(base)) return base;
  for (let i = 2; i < 1000; i++) {
    const t = `${base} ${i}`;
    if (!taken.has(t)) return t;
  }
  return `${base} ${Date.now()}`;
}
