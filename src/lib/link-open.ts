// Following links (SPEC-PARTE2 §3 "Following links").
//
// One routing table for every surface (reader, split preview, Live
// Preview, the editor's normal mode, the hover card):
//   - `gf` / Enter / a plain click        → the current pane
//   - `Ctrl-w f` / `Ctrl-w Enter`, Cmd/Ctrl-click → a vertical split
//   - `Ctrl-w F`, Shift-Cmd/Ctrl-click     → a horizontal split
// External links never navigate the app: they open in a new tab
// (http/https/mailto only). Pure and DOM-free.

import type { NoteSummary } from './types.ts';
import { findNoteByHref, resolveNoteHref } from './links.ts';
import { baseName, normalizePath } from './notetree.ts';

export type OpenWhere = 'current' | 'vsplit' | 'hsplit';

export interface ClickMods {
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey?: boolean;
  button?: number;
}

/**
 * Where a click on a note link opens. The platform modifier is Cmd on
 * macOS and Ctrl elsewhere (Ctrl-click is the context menu on a Mac).
 * null = not ours (middle click, Alt-click: the browser's business).
 */
export function whereFromClick(e: ClickMods, mac: boolean): OpenWhere | null {
  if ((e.button ?? 0) !== 0 || e.altKey) return null;
  const mod = mac ? e.metaKey : e.ctrlKey;
  if (!mod) return e.shiftKey ? null : 'current';
  return e.shiftKey ? 'hsplit' : 'vsplit';
}

export type LinkTarget =
  | { kind: 'note'; note: NoteSummary }
  /** A note link whose target does not exist (yet). */
  | { kind: 'missing'; path: string }
  | { kind: 'external'; url: string }
  | { kind: 'anchor'; id: string }
  /** javascript:, data:, unknown schemes — never followed. */
  | { kind: 'unsafe' };

const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

/** `[[Name]]` / `[[folder/Name|alias]]` / `[[Name#Heading]]` → note. */
export function findNoteByWiki(notes: readonly NoteSummary[], raw: string): NoteSummary | null {
  const name = raw.split('|')[0].split('#')[0].trim();
  if (!name) return null;
  const lower = name.toLowerCase().replace(/\.md$/i, '');
  const path = (n: NoteSummary) => normalizePath(n.path || n.id + '.md').toLowerCase().replace(/\.md$/i, '');
  return (
    notes.find((n) => path(n) === lower) ??
    notes.find((n) => (n.title ?? '').trim().toLowerCase() === lower) ??
    notes.find((n) => baseName(path(n)) === lower) ??
    null
  );
}

/** Classify an href found in note `fromPath`. `wiki` = the `[[…]]` form. */
export function classifyLink(notes: readonly NoteSummary[], fromPath: string, href: string, wiki = false): LinkTarget {
  const h = (href ?? '').trim();
  if (wiki) {
    const n = findNoteByWiki(notes, h);
    return n ? { kind: 'note', note: n } : { kind: 'missing', path: h.split('|')[0].trim() };
  }
  if (h.startsWith('#')) return { kind: 'anchor', id: h.slice(1) };
  if (h.startsWith('//')) return { kind: 'unsafe' };
  if (SCHEME_RE.test(h)) return /^(https?|mailto):/i.test(h) ? { kind: 'external', url: h } : { kind: 'unsafe' };
  const n = findNoteByHref(notes, fromPath, h);
  if (n) return { kind: 'note', note: n };
  const p = resolveNoteHref(fromPath, h);
  return p ? { kind: 'missing', path: p } : { kind: 'unsafe' };
}

export interface LinkAt {
  href: string;
  wiki: boolean;
  /** Offsets of the whole link in the text. */
  from: number;
  to: number;
}

/**
 * The link under `pos` in `text` (editor cursor): `[label](href)`,
 * `![alt](src)` is skipped, `<https://…>` autolinks, `[[wiki]]` and bare
 * http(s) URLs. Only the line holding `pos` is scanned.
 */
export function linkAt(text: string, pos: number): LinkAt | null {
  const start = text.lastIndexOf('\n', pos - 1) + 1;
  let end = text.indexOf('\n', pos);
  if (end < 0) end = text.length;
  const line = text.slice(start, end);
  const col = pos - start;
  const hit = (from: number, to: number) => col >= from && col <= to;

  const patterns: Array<{ re: RegExp; get: (m: RegExpExecArray) => { href: string; wiki: boolean } | null }> = [
    { re: /\[\[([^\]\n]+)\]\]/g, get: (m) => ({ href: m[1], wiki: true }) },
    {
      re: /(!?)\[(?:[^\]\\\n]|\\.)*\]\(\s*(<[^>\n]*>|[^\s)]+)(?:\s+(?:"[^"\n]*"|'[^'\n]*'))?\s*\)/g,
      get: (m) => (m[1] ? null : { href: m[2].replace(/^<|>$/g, ''), wiki: false }),
    },
    { re: /<((?:https?|mailto):[^>\s]+)>/gi, get: (m) => ({ href: m[1], wiki: false }) },
    { re: /\bhttps?:\/\/[^\s<>()\]]+[^\s<>()\].,;:!?'"]/gi, get: (m) => ({ href: m[0], wiki: false }) },
  ];
  for (const { re, get } of patterns) {
    re.lastIndex = 0;
    for (let m = re.exec(line); m; m = re.exec(line)) {
      if (hit(m.index, m.index + m[0].length - 1)) {
        const r = get(m);
        if (r) return { ...r, from: start + m.index, to: start + m.index + m[0].length };
        break;
      }
    }
  }
  return null;
}

/** Short display parts of an external URL (hover card); no fetch. */
export function urlCard(url: string): { host: string; path: string; secure: boolean; mail: boolean } | null {
  try {
    const u = new URL(url);
    if (u.protocol === 'mailto:') return { host: decodeURIComponent(u.pathname), path: '', secure: false, mail: true };
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    const path = decodeURIComponent(u.pathname + u.search).replace(/\/$/, '');
    return { host: u.host, path: path.length > 80 ? path.slice(0, 79) + '…' : path, secure: u.protocol === 'https:', mail: false };
  } catch {
    return null;
  }
}
