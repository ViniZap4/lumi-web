// Note-to-note links (markdown link helper).
//
// Canonical style: a standard relative markdown link,
//   [Title](../folder/note.md)
// It renders as a link in every markdown viewer (GitHub, Obsidian, the
// TUI, the Apple client), survives the server's markdown mirror as
// plain text, and needs no renderer extension — so the reading view
// and live preview only have to intercept clicks on relative `.md`
// hrefs and route them inside the app. `[[` is accepted as a TRIGGER
// in the editor but is always rewritten to the markdown form.
//
// Pure helpers: candidate ranking (fuzzy on title + path), relative
// path computation, link text, href resolution and URL detection.

import type { NoteSummary } from './types.ts';
import { baseName, dirOf, normalizePath } from './notetree.ts';

export interface LinkCandidate {
  id: string;
  title: string;
  path: string;
  folder: string;
  score: number;
}

/**
 * Subsequence fuzzy score (higher is better), or null when `query` is
 * not a subsequence of `text`. Rewards consecutive runs, word starts
 * and an early first hit; case-insensitive.
 */
export function fuzzyScore(query: string, text: string): number | null {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const t = text.toLowerCase();
  let score = 0;
  let ti = 0;
  let run = 0;
  let first = -1;
  for (let qi = 0; qi < q.length; qi++) {
    const c = q[qi];
    if (c === ' ') continue;
    const found = t.indexOf(c, ti);
    if (found < 0) return null;
    if (first < 0) first = found;
    const prev = found > 0 ? t[found - 1] : ' ';
    const wordStart = /[\s/_\-.(]/.test(prev);
    run = found === ti && qi > 0 ? run + 1 : 0;
    score += 1 + run * 3 + (wordStart ? 4 : 0);
    ti = found + 1;
  }
  score -= Math.min(first, 20) * 0.25;
  // Shorter targets rank above long ones for the same hits.
  score -= t.length * 0.01;
  if (t.includes(q)) score += 6;
  return score;
}

/** Notes ranked for the link helper (title weighs more than path). */
export function linkCandidates(
  notes: readonly NoteSummary[],
  query: string,
  opts: { excludeID?: string | null; limit?: number } = {},
): LinkCandidate[] {
  const limit = opts.limit ?? 50;
  const out: LinkCandidate[] = [];
  for (const n of notes) {
    if (n.id === opts.excludeID) continue;
    const path = normalizePath(n.path || n.id + '.md');
    const title = n.title?.trim() || baseName(path).replace(/\.md$/i, '');
    const st = fuzzyScore(query, title);
    const sp = fuzzyScore(query, path);
    if (st == null && sp == null) continue;
    const score = Math.max(st != null ? st * 1.5 : -Infinity, sp ?? -Infinity);
    out.push({ id: n.id, title, path, folder: dirOf(path), score });
  }
  out.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title) || a.path.localeCompare(b.path));
  return out.slice(0, limit);
}

/** Path of `to` relative to the folder holding `from` (both note paths). */
export function relativeNotePath(from: string, to: string): string {
  const fromDir = dirOf(normalizePath(from)).split('/').filter(Boolean);
  const toParts = normalizePath(to).split('/').filter(Boolean);
  let i = 0;
  while (i < fromDir.length && i < toParts.length - 1 && fromDir[i] === toParts[i]) i++;
  const ups = fromDir.length - i;
  return [...Array<string>(ups).fill('..'), ...toParts.slice(i)].join('/');
}

/** Escape a link destination: spaces and the few characters that end
 *  or break a CommonMark destination; unicode stays readable. */
export function encodeLinkPath(p: string): string {
  return p.replace(/[ ()<>#?%]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'));
}

/** Escape link text so `]`/`[`/`\` cannot end the label early. */
export function escapeLinkLabel(s: string): string {
  return s.replace(/[\\[\]]/g, '\\$&').replace(/\n/g, ' ');
}

/** `[Title](relative/path.md)` from note `fromPath` to `toPath`. */
export function markdownLink(label: string, fromPath: string, toPath: string): string {
  return `[${escapeLinkLabel(label)}](${encodeLinkPath(relativeNotePath(fromPath, toPath))})`;
}

/** Just the destination part (for the `](` trigger). */
export function linkDestination(fromPath: string, toPath: string): string {
  return encodeLinkPath(relativeNotePath(fromPath, toPath));
}

const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Resolve an href found in note `fromPath` to a book-relative note path
 * (normalised, `.md`), or null when it is external (has a scheme, is
 * protocol-relative or a pure #fragment). `/x.md` is from the book root;
 * `..` is clamped at the root. Extension-less targets get `.md`.
 */
export function resolveNoteHref(fromPath: string, href: string): string | null {
  let h = (href ?? '').trim().replace(/^<|>$/g, '');
  if (!h || h.startsWith('#') || h.startsWith('//') || SCHEME_RE.test(h)) return null;
  h = h.replace(/[?#].*$/, '');
  try {
    h = decodeURIComponent(h);
  } catch {
    // keep as-is
  }
  if (/[\u0000-\u001f\u007f]/.test(h)) return null;
  const abs = h.startsWith('/');
  const parts = abs ? [] : dirOf(normalizePath(fromPath)).split('/').filter(Boolean);
  for (const seg of h.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  if (parts.length === 0) return null;
  let p = parts.join('/');
  if (!/\.md$/i.test(p)) p += '.md';
  return p;
}

/** Find the note an href points at (path match, case-insensitive
 *  fallback). */
export function findNoteByHref(notes: readonly NoteSummary[], fromPath: string, href: string): NoteSummary | null {
  const target = resolveNoteHref(fromPath, href);
  if (!target) return null;
  const norm = (n: NoteSummary) => normalizePath(n.path || n.id + '.md');
  return notes.find((n) => norm(n) === target) ?? notes.find((n) => norm(n).toLowerCase() === target.toLowerCase()) ?? null;
}

/** A single pasted absolute URL (http/https/mailto), else null. */
export function pastedUrl(text: string): string | null {
  const s = (text ?? '').trim();
  if (!s || /\s/.test(s) || s.length > 2048) return null;
  try {
    const u = new URL(s);
    if (u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'mailto:') return s;
  } catch {
    // not a URL
  }
  return null;
}

/** `[selection](url)`, or null when the selection should not become a
 *  link (empty, multi-line, already a link). */
export function linkFromPaste(selection: string, clipboard: string): string | null {
  const url = pastedUrl(clipboard);
  if (!url || !selection || selection.includes('\n') || /^\s*\[.*\]\(.*\)\s*$/.test(selection)) return null;
  return `[${escapeLinkLabel(selection)}](${url.replace(/[()<>]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())})`;
}
