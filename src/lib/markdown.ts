// Markdown rendering for the reader, the split preview and the
// read-only previews. marked → DOMPurify, one top-level block at a
// time.
//
// Block rendering serves two needs:
//   - scroll sync: every block carries the source line it starts at
//     (`data-line`) so the split preview can map editor lines to
//     rendered offsets;
//   - incremental re-render: a block's sanitised HTML is cached by its
//     source, so typing in one paragraph re-renders one paragraph.
//
// Sanitisation is conservative: HTML profile + an explicit forbid
// list. Style attributes and event handlers are dropped. The only
// form control that survives is a *disabled* checkbox (GFM task
// lists); interactivity is added by the view, never by note content.

import { Marked, Renderer, type Tokens, type Token } from 'marked';
import DOMPurify from 'dompurify';

// Allow-list of iframe sources for media embeds. Anything else gets
// scrubbed during sanitisation.
const EMBED_HOST_ALLOWLIST = new Set<string>([
  'www.youtube-nocookie.com',
  'www.youtube.com',
  'player.vimeo.com',
]);

const INPUT_ATTRS = new Set(['type', 'checked', 'disabled', 'class']);

// DOMPurify hook: iframes are checked against the allow-list and
// sandboxed; inputs survive only as disabled checkboxes.
DOMPurify.addHook('uponSanitizeElement', (node, data) => {
  if (data.tagName === 'input') {
    const el = node as HTMLInputElement;
    if ((el.getAttribute('type') ?? '').toLowerCase() !== 'checkbox') {
      el.remove();
      return;
    }
    for (const a of Array.from(el.attributes)) {
      if (!INPUT_ATTRS.has(a.name.toLowerCase())) el.removeAttribute(a.name);
    }
    el.setAttribute('disabled', '');
    return;
  }
  if (data.tagName !== 'iframe') return;
  const el = node as HTMLIFrameElement;
  const src = el.getAttribute('src') ?? '';
  try {
    const url = new URL(src);
    if (!EMBED_HOST_ALLOWLIST.has(url.host)) {
      el.remove();
      return;
    }
  } catch {
    el.remove();
    return;
  }
  el.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-presentation');
  el.setAttribute('loading', 'lazy');
  el.setAttribute('referrerpolicy', 'no-referrer');
});

const PURIFY_CONFIG = {
  USE_PROFILES: { html: true },
  ADD_TAGS: ['iframe'],
  ADD_ATTR: ['allow', 'allowfullscreen', 'frameborder', 'scrolling', 'sandbox', 'loading', 'decoding', 'referrerpolicy', 'target', 'rel'],
  FORBID_TAGS: ['style', 'script', 'object', 'embed', 'form', 'button', 'textarea', 'select', 'meta', 'link'],
  FORBID_ATTR: ['style', 'onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'onblur', 'formaction', 'name'],
};

function sanitize(html: string): string {
  return DOMPurify.sanitize(html, PURIFY_CONFIG) as unknown as string;
}

export function escapeHTML(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Heading slug: lowercase words joined by `-`, prefixed so it never
 *  clobbers a document property (DOMPurify drops such ids). */
export function slugify(text: string): string {
  const s = text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/<[^>]*>/g, '')
    .replace(/&[a-z0-9#]+;/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 64);
  return 'h-' + (s || 'section');
}

// ── footnotes ──────────────────────────────────────────────────────────

/** Footnote state of the current render pass (render is synchronous). */
let footnoteOrder: string[] = [];

const FOOTNOTE_DEF = /^\[\^([^\]\s]+)\]:[ \t]+(.*)$/;

/** Lines inside fenced code blocks (never footnotes or tasks). */
function codeLines(lines: string[]): boolean[] {
  const inCode: boolean[] = [];
  let fence: string | null = null;
  for (const l of lines) {
    const m = /^\s{0,3}(`{3,}|~{3,})/.exec(l);
    if (fence) {
      inCode.push(true);
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length) fence = null;
    } else if (m) {
      fence = m[1];
      inCode.push(true);
    } else inCode.push(false);
  }
  return inCode;
}

interface FootnoteScan {
  /** Source with definition lines blanked (line count unchanged). */
  src: string;
  defs: Map<string, { text: string; line: number }>;
  order: string[];
}

function scanFootnotes(src: string): FootnoteScan {
  const lines = src.split('\n');
  const code = codeLines(lines);
  const defs = new Map<string, { text: string; line: number }>();
  const order: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (code[i]) continue;
    const m = FOOTNOTE_DEF.exec(lines[i]);
    if (m) {
      if (!defs.has(m[1])) defs.set(m[1], { text: m[2], line: i });
      lines[i] = '';
      continue;
    }
    for (const r of lines[i].matchAll(/\[\^([^\]\s]+)\](?!:)/g)) {
      if (!order.includes(r[1])) order.push(r[1]);
    }
  }
  return { src: defs.size ? lines.join('\n') : src, defs, order: order.filter((id) => defs.has(id)) };
}

// ── task markers ───────────────────────────────────────────────────────

const TASK_LINE = /^(\s*(?:>\s*)*(?:[-*+]|\d{1,9}[.)])\s+)\[([ xX])\](?=\s|$)/;

/**
 * Offsets (UTF-16) of the character inside each task marker `[ ]` /
 * `[x]`, in document order — the same order the renderer emits task
 * checkboxes. Fenced code is skipped.
 */
export function taskMarkers(src: string): number[] {
  const out: number[] = [];
  const lines = src.split('\n');
  const code = codeLines(lines);
  let off = 0;
  for (let i = 0; i < lines.length; i++) {
    if (!code[i]) {
      const m = TASK_LINE.exec(lines[i]);
      if (m) out.push(off + m[1].length + 1);
    }
    off += lines[i].length + 1;
  }
  return out;
}

/** The single-character ranged change that toggles task `index`, or
 *  null when there is no such task. */
export function taskToggle(src: string, index: number): { from: number; to: number; insert: string } | null {
  const pos = taskMarkers(src)[index];
  if (pos == null) return null;
  const cur = src[pos];
  return { from: pos, to: pos + 1, insert: cur === ' ' ? 'x' : ' ' };
}

// ── renderer ───────────────────────────────────────────────────────────

const base = new Renderer();

const CALLOUT = /^\[!([A-Za-z][\w-]*)\]([+-]?)[ \t]*(.*)$/;
const CALLOUT_ALIASES: Record<string, string> = {
  summary: 'abstract', tldr: 'abstract', hint: 'tip', important: 'tip', check: 'success', done: 'success',
  help: 'question', faq: 'question', caution: 'warning', attention: 'warning', fail: 'danger', failure: 'danger',
  missing: 'danger', error: 'danger', bug: 'danger', cite: 'quote',
};
const CALLOUT_KINDS = new Set(['note', 'abstract', 'info', 'todo', 'tip', 'success', 'question', 'warning', 'danger', 'example', 'quote']);

function cleanLang(lang: string | undefined): string {
  return (lang ?? '').trim().split(/\s+/)[0].replace(/[^\w+#.-]/g, '').slice(0, 24).toLowerCase();
}

const markedInstance = new Marked({ gfm: true, breaks: true, pedantic: false });

markedInstance.use({
  extensions: [
    {
      name: 'footnoteRef',
      level: 'inline',
      start: (src: string) => src.indexOf('[^'),
      tokenizer(src: string) {
        const m = /^\[\^([^\]\s]+)\]/.exec(src);
        if (!m || !footnoteOrder.includes(m[1])) return undefined;
        return { type: 'footnoteRef', raw: m[0], id: m[1] };
      },
      renderer(tok) {
        const id = String((tok as unknown as { id: string }).id);
        const n = footnoteOrder.indexOf(id) + 1;
        const safe = escapeHTML(id);
        return `<sup class="md-fn-ref"><a href="#fn-${safe}" id="fnref-${safe}" aria-label="Footnote ${n}">${n}</a></sup>`;
      },
    },
  ],
  renderer: {
    heading(this: Renderer, { tokens, depth }: Tokens.Heading) {
      const inner = this.parser.parseInline(tokens);
      const id = slugify(inner);
      return `<h${depth} id="${id}" class="md-h">${inner}<a class="md-anchor" href="#${id}" aria-label="Link to this section" tabindex="-1">#</a></h${depth}>\n`;
    },
    code({ text, lang }: Tokens.Code) {
      const l = cleanLang(lang);
      const cls = l ? ` class="language-${l}"` : '';
      if (l === 'math' || l === 'latex' || l === 'tex') {
        return `<div class="md-math" data-lang="math"><code>${escapeHTML(text)}</code></div>\n`;
      }
      return `<div class="md-code" data-lang="${l}"><pre><code${cls}>${escapeHTML(text)}</code></pre></div>\n`;
    },
    table(this: Renderer, token: Tokens.Table) {
      base.parser = this.parser;
      return `<div class="md-table">${base.table(token)}</div>\n`;
    },
    image({ href, title, text }: Tokens.Image) {
      const alt = escapeHTML(text ?? '');
      const t = title ? escapeHTML(title) : '';
      const img = `<img src="${escapeHTML(href)}" alt="${alt}"${t ? ` title="${t}"` : ''} loading="lazy" decoding="async">`;
      return t ? `<span class="md-figure">${img}<span class="md-caption">${t}</span></span>` : img;
    },
    blockquote(this: Renderer, token: Tokens.Blockquote) {
      const lines = token.text.split('\n');
      const m = CALLOUT.exec(lines[0].trim());
      if (!m) {
        base.parser = this.parser;
        return base.blockquote(token);
      }
      const raw = m[1].toLowerCase();
      const kind = CALLOUT_ALIASES[raw] ?? (CALLOUT_KINDS.has(raw) ? raw : 'note');
      const titleHtml = m[3] ? markedInstance.parseInline(m[3], { async: false }) as string : escapeHTML(raw[0].toUpperCase() + raw.slice(1));
      const body = lines.slice(1).join('\n');
      const bodyHtml = body.trim() ? (markedInstance.parse(body, { async: false }) as string) : '';
      if (m[2]) {
        return `<details class="md-callout" data-callout="${kind}"${m[2] === '+' ? ' open' : ''}><summary class="md-callout-title">${titleHtml}</summary><div class="md-callout-body">${bodyHtml}</div></details>\n`;
      }
      return `<div class="md-callout" data-callout="${kind}"><p class="md-callout-title">${titleHtml}</p>${bodyHtml ? `<div class="md-callout-body">${bodyHtml}</div>` : ''}</div>\n`;
    },
    checkbox({ checked }: Tokens.Checkbox) {
      return `<input type="checkbox" class="md-task"${checked ? ' checked' : ''} disabled> `;
    },
    listitem(this: Renderer, item: Tokens.ListItem) {
      base.parser = this.parser;
      const html = base.listitem(item);
      if (!item.task) return html;
      return html.replace(/^<li>/, `<li class="md-task-item${item.checked ? ' done' : ''}">`);
    },
  },
});

export interface RenderOptions {
  /** Absolute base URL for relative image / link resolution. Optional. */
  baseURL?: string;
}

export interface MdBlock {
  /** Stable identity for keyed rendering (source + occurrence). */
  key: string;
  /** 0-based source line the block starts at. */
  line: number;
  /** 0-based line after the block's last line. */
  endLine: number;
  html: string;
}

// Sanitised HTML per block source (+ render context). Bounded.
const blockCache = new Map<string, string>();
const CACHE_MAX = 800;

function cacheGet(k: string): string | undefined {
  const v = blockCache.get(k);
  if (v !== undefined) {
    blockCache.delete(k);
    blockCache.set(k, v);
  }
  return v;
}
function cacheSet(k: string, v: string): void {
  blockCache.set(k, v);
  if (blockCache.size > CACHE_MAX) blockCache.delete(blockCache.keys().next().value as string);
}

let renderCount = 0;
/** Blocks actually parsed + sanitised (cache misses) — for tests. */
export function renderStats(): { parsed: number } {
  return { parsed: renderCount };
}

function countNL(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 10) n++;
  return n;
}

/**
 * Render markdown into sanitised top-level blocks, each with the
 * source line it starts at. Unchanged blocks come from the cache.
 */
export function renderBlocks(src: string, opts: RenderOptions = {}): MdBlock[] {
  if (!src) return [];
  const text = liftMediaEmbeds(src.replace(/\r\n?/g, '\n'));
  const fn = scanFootnotes(text);
  footnoteOrder = fn.order;
  const tokens = markedInstance.lexer(fn.src);
  const links = (tokens as unknown as { links: Record<string, unknown> }).links ?? {};
  const ctx = fn.order.join('\u0001') + '\u0002' + Object.keys(links).join('\u0001') + '\u0002' + (opts.baseURL ?? '');

  const out: MdBlock[] = [];
  const seen = new Map<string, number>();
  let line = 0;
  for (const tok of tokens as Token[]) {
    const raw = tok.raw ?? '';
    const start = line;
    line += countNL(raw);
    if (tok.type === 'space' || tok.type === 'def') continue;
    const ck = raw + '\u0000' + ctx;
    let html = cacheGet(ck);
    if (html === undefined) {
      renderCount++;
      const list = [tok] as unknown as Token[] & { links: unknown };
      list.links = links;
      html = sanitize(markedInstance.parser(list as unknown as Token[]));
      if (opts.baseURL) html = resolveRelativeURLs(html, opts.baseURL);
      cacheSet(ck, html);
    }
    if (!html.trim()) continue;
    const n = (seen.get(raw) ?? 0) + 1;
    seen.set(raw, n);
    // A block's end is its last non-blank line + 1.
    const trailing = raw.length - raw.trimEnd().length;
    const end = Math.max(start + 1, line - countNL(raw.slice(raw.length - trailing)) + 1);
    out.push({ key: `${n}:${raw}`, line: start, endLine: end, html });
  }

  if (fn.order.length) {
    const items = fn.order
      .map((id) => {
        const d = fn.defs.get(id)!;
        const safe = escapeHTML(id);
        const body = markedInstance.parseInline(d.text, { async: false }) as string;
        return `<li id="fn-${safe}">${body} <a href="#fnref-${safe}" class="md-fn-back" aria-label="Back to reference">↩</a></li>`;
      })
      .join('');
    const html = sanitize(`<section class="md-footnotes" aria-label="Footnotes"><ol>${items}</ol></section>`);
    const firstLine = Math.min(...fn.order.map((id) => fn.defs.get(id)!.line));
    out.push({ key: 'footnotes', line: Math.max(firstLine, out.length ? out[out.length - 1].line : 0), endLine: line + 1, html });
  }
  footnoteOrder = [];
  return out;
}

/** Joined HTML of rendered blocks (each wrapped with its source line). */
export function blocksToHTML(blocks: readonly MdBlock[]): string {
  return blocks.map((b) => `<div class="md-b" data-line="${b.line}">${b.html}</div>`).join('');
}

/**
 * Render markdown source to a sanitised HTML string suitable for
 * dropping into a `{@html ...}` Svelte tag. Never executes scripts;
 * stylesheets are dropped; only allow-listed iframes survive.
 */
export function renderMarkdown(src: string, opts: RenderOptions = {}): string {
  if (!src) return '';
  return blocksToHTML(renderBlocks(src, opts));
}

// liftMediaEmbeds rewrites `![alt](https://www.youtube.com/...)` and
// `![alt](https://player.vimeo.com/...)` paragraphs into raw
// <iframe> blocks so marked emits them as HTML rather than <img>.
function liftMediaEmbeds(src: string): string {
  return src.replace(
    /^\s*!\[([^\]]*)\]\(([^)]+)\)\s*$/gm,
    (match, _alt, url) => {
      const embed = embedHTMLFor(url);
      return embed ?? match;
    },
  );
}

function embedHTMLFor(rawURL: string): string | null {
  let u: URL;
  try {
    u = new URL(rawURL);
  } catch {
    return null;
  }
  // YouTube.
  if (u.host === 'www.youtube.com' || u.host === 'youtube.com' || u.host === 'youtu.be') {
    let id = '';
    if (u.host === 'youtu.be') {
      id = u.pathname.slice(1);
    } else if (u.pathname.startsWith('/watch')) {
      id = u.searchParams.get('v') ?? '';
    } else if (u.pathname.startsWith('/embed/')) {
      id = u.pathname.split('/')[2] ?? '';
    }
    if (!id) return null;
    return `<iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}" allowfullscreen frameborder="0"></iframe>`;
  }
  // Vimeo.
  if (u.host === 'vimeo.com' || u.host === 'player.vimeo.com') {
    const id =
      u.host === 'vimeo.com'
        ? u.pathname.split('/').filter(Boolean)[0] ?? ''
        : u.pathname.split('/').filter(Boolean)[1] ?? '';
    if (!id) return null;
    return `<iframe src="https://player.vimeo.com/video/${encodeURIComponent(id)}" allowfullscreen frameborder="0"></iframe>`;
  }
  return null;
}

function resolveRelativeURLs(html: string, base: string): string {
  return html.replace(/(\b(?:href|src)=")(?!https?:|data:|mailto:|#)([^"]+)"/g, (_m, p, ref) => {
    try {
      return `${p}${new URL(ref, base).toString()}"`;
    } catch {
      return `${p}${ref}"`;
    }
  });
}
