// LFM 1.0 render-tree adapter for the web renderer (docs/SPEC-LFM.md §5).
//
// Maps what lib/markdown.ts actually emits (sanitised HTML blocks from
// renderBlocks) back onto the normalised render tree the shared vectors
// pin, so the vectors test the real renderer output and not a parallel
// parser. The mapping is structural only: anything the HTML cannot
// express (a callout's raw kind, a YouTube URL before it became an
// iframe) is left out of the tree by the spec itself.
//
// Needs a DOM (jsdom), like markdown.test.ts.

import { renderBlocks } from '../lib/markdown.ts';
import { stripFrontmatter } from '../lib/hover-preview.ts';

export type Inline = Record<string, unknown> & { t: string };
export type Block = Record<string, unknown> & { t: string };
export interface DocTree {
  t: 'doc';
  frontmatter: string | null;
  c: Block[];
}

const BLOCK_TAGS = new Set([
  'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'BLOCKQUOTE', 'PRE', 'TABLE', 'HR', 'DIV', 'DETAILS', 'SECTION', 'IFRAME',
]);

/** Render `src` with the web renderer and map the output to the tree. */
export function webRenderTree(src: string): DocTree {
  const { frontmatter, body } = splitFrontmatter(src);
  const host = document.createElement('div');
  host.innerHTML = renderBlocks(body).map((b) => b.html).join('');
  return { t: 'doc', frontmatter, c: blocks(Array.from(host.childNodes)) };
}

/** The web client's own frontmatter split (hover-preview.ts) plus the
 *  raw YAML between the fences, for the tree's `frontmatter` field. */
function splitFrontmatter(src: string): { frontmatter: string | null; body: string } {
  const body = stripFrontmatter(src);
  if (body.length === src.length) return { frontmatter: null, body: src };
  const head = src.slice(0, src.length - body.length).replace(/\r\n?/g, '\n');
  const lines = head.split('\n');
  // lines[0] is the opening fence; the closing fence is the last
  // non-empty line of `head`.
  let end = lines.length - 1;
  while (end > 0 && lines[end] === '') end--;
  return { frontmatter: lines.slice(1, end).join('\n'), body };
}

function blocks(nodes: Node[]): Block[] {
  const out: Block[] = [];
  let pending: Node[] = [];
  const flush = () => {
    if (!pending.length) return;
    const c = inlines(pending);
    pending = [];
    if (c.length) out.push({ t: 'para', c });
  };
  for (const n of nodes) {
    if (n.nodeType === 1 && BLOCK_TAGS.has((n as Element).tagName)) {
      flush();
      const b = block(n as Element);
      if (b) out.push(b);
    } else if (n.nodeType === 1 || n.nodeType === 3) {
      pending.push(n);
    }
  }
  flush();
  return out;
}

function block(el: Element): Block | null {
  const tag = el.tagName;
  if (/^H[1-6]$/.test(tag)) {
    const copy = el.cloneNode(true) as Element;
    copy.querySelectorAll('a.md-anchor').forEach((a) => a.remove());
    return { t: 'heading', level: Number(tag[1]), c: inlines(Array.from(copy.childNodes)) };
  }
  if (tag === 'P') {
    const kids = Array.from(el.childNodes).filter((n) => !(n.nodeType === 3 && !(n.textContent ?? '').trim()));
    if (kids.length === 1 && kids[0].nodeType === 1) {
      const k = kids[0] as Element;
      if (k.tagName === 'IMG' || (k.tagName === 'SPAN' && k.classList.contains('md-figure'))) {
        const img = inline(k)[0];
        return { ...img, t: 'embed', kind: 'image' };
      }
      if (k.tagName === 'IFRAME') return iframe(k);
    }
    const c = inlines(Array.from(el.childNodes));
    return c.length ? { t: 'para', c } : null;
  }
  if (tag === 'HR') return { t: 'hr' };
  if (tag === 'BLOCKQUOTE') return { t: 'quote', c: blocks(Array.from(el.childNodes)) };
  if (tag === 'UL' || tag === 'OL') return list(el);
  if (tag === 'PRE') return { t: 'code', lang: '', text: el.textContent ?? '' };
  if (tag === 'TABLE') return table(el);
  if (tag === 'IFRAME') return iframe(el);
  if (tag === 'SECTION' && el.classList.contains('md-footnotes')) return footnotes(el);
  if (el.classList.contains('md-callout')) return callout(el);
  if (tag === 'DIV') {
    if (el.classList.contains('md-code')) {
      return { t: 'code', lang: el.getAttribute('data-lang') ?? '', text: el.querySelector('code')?.textContent ?? '' };
    }
    if (el.classList.contains('md-math')) return { t: 'code', lang: 'math', text: el.querySelector('code')?.textContent ?? '' };
    if (el.classList.contains('md-mermaid')) return { t: 'code', lang: 'mermaid', text: el.querySelector('code')?.textContent ?? '' };
    if (el.classList.contains('md-table')) {
      const t = el.querySelector('table');
      return t ? table(t) : null;
    }
  }
  return { t: 'html' };
}

function iframe(el: Element): Block {
  const src = el.getAttribute('src') ?? '';
  let m = /youtube-nocookie\.com\/embed\/([^?/#]+)/.exec(src);
  if (m) return { t: 'embed', kind: 'youtube', id: decodeURIComponent(m[1]) };
  m = /player\.vimeo\.com\/video\/([^?/#]+)/.exec(src);
  if (m) return { t: 'embed', kind: 'vimeo', id: decodeURIComponent(m[1]) };
  return { t: 'html' };
}

function list(el: Element): Block {
  const ordered = el.tagName === 'OL';
  const lis = Array.from(el.children).filter((c) => c.tagName === 'LI');
  const tight = !lis.some((li) => Array.from(li.children).some((c) => c.tagName === 'P'));
  const items = lis.map((li) => {
    const copy = li.cloneNode(true) as Element;
    // The task checkbox is a direct child of the <li> (tight list) or
    // of its first <p> (loose list), never a nested item's.
    const first = copy.firstElementChild;
    const box = [copy, first?.tagName === 'P' ? first : null]
      .flatMap((p) => (p ? Array.from(p.children) : []))
      .find((c) => c.tagName === 'INPUT' && c.getAttribute('type') === 'checkbox');
    const item: Block = { t: 'item', c: [] };
    if (box) {
      item.checked = box.hasAttribute('checked');
      const next = box.nextSibling;
      box.remove();
      if (next && next.nodeType === 3) next.textContent = (next.textContent ?? '').replace(/^[ \t]+/, '');
    }
    item.c = blocks(Array.from(copy.childNodes));
    return item;
  });
  const out: Block = { t: 'list', ordered, tight, items };
  if (ordered) out.start = Number(el.getAttribute('start') ?? '1');
  return out;
}

function table(el: Element): Block {
  const head = Array.from(el.querySelectorAll('thead tr:first-child > th'));
  const align = head.map((th) => {
    const a = (th.getAttribute('align') ?? (th as HTMLElement).style?.textAlign ?? '').toLowerCase();
    return a === 'left' || a === 'center' || a === 'right' ? a : 'none';
  });
  const rows = Array.from(el.querySelectorAll('tbody > tr')).map((tr) =>
    Array.from(tr.children).map((td) => inlines(Array.from(td.childNodes))),
  );
  return { t: 'table', align, head: head.map((th) => inlines(Array.from(th.childNodes))), rows };
}

function callout(el: Element): Block {
  const kind = el.getAttribute('data-callout') ?? 'note';
  const fold = el.tagName === 'DETAILS' ? (el.hasAttribute('open') ? 'open' : 'closed') : 'none';
  const titleEl = el.querySelector(':scope > .md-callout-title');
  const bodyEl = el.querySelector(':scope > .md-callout-body');
  return {
    t: 'callout',
    kind,
    fold,
    title: titleEl ? inlines(Array.from(titleEl.childNodes)) : [],
    c: bodyEl ? blocks(Array.from(bodyEl.childNodes)) : [],
  };
}

function footnotes(el: Element): Block {
  const items = Array.from(el.querySelectorAll('ol > li')).map((li, i) => {
    const copy = li.cloneNode(true) as Element;
    copy.querySelectorAll('a.md-fn-back').forEach((a) => a.remove());
    return { id: (li.getAttribute('id') ?? '').replace(/^fn-/, ''), n: i + 1, c: inlines(Array.from(copy.childNodes)) };
  });
  return { t: 'footnotes', items };
}

// ── inline ─────────────────────────────────────────────────────────────

/** Inline nodes, adjacent text merged, outer whitespace trimmed. */
function inlines(nodes: Node[], trim = true): Inline[] {
  const raw = nodes.flatMap((n) => inline(n));
  const merged = mergeText(raw);
  if (trim) trimEdges(merged);
  return merged.filter((n) => !(n.t === 'text' && n.v === ''));
}

function mergeText(list: Inline[]): Inline[] {
  const out: Inline[] = [];
  for (const n of list) {
    const last = out[out.length - 1];
    if (n.t === 'text' && last?.t === 'text') last.v = String(last.v) + String(n.v);
    else out.push(n.t === 'text' ? { ...n } : n);
  }
  return out;
}

function trimEdges(list: Inline[]): void {
  // Leading/trailing whitespace of a paragraph is not content, and the
  // HTML serialiser's "\n" between a <br> and the next line is not
  // either: strip it at the edges and around breaks.
  for (let i = 0; i < list.length; i++) {
    const n = list[i];
    if (n.t !== 'text') continue;
    let v = String(n.v);
    if (i === 0 || list[i - 1].t === 'br') v = v.replace(/^[ \t\n]+/, '');
    if (i === list.length - 1 || list[i + 1].t === 'br') v = v.replace(/[ \t\n]+$/, '');
    n.v = v;
  }
}

function inline(n: Node): Inline[] {
  if (n.nodeType === 3) return [{ t: 'text', v: n.textContent ?? '' }];
  if (n.nodeType !== 1) return [];
  const el = n as Element;
  const kids = () => inlines(Array.from(el.childNodes), false);
  switch (el.tagName) {
    case 'BR':
      return [{ t: 'br' }];
    case 'STRONG':
    case 'B':
      return [{ t: 'strong', c: kids() }];
    case 'EM':
    case 'I':
      return [{ t: 'em', c: kids() }];
    case 'DEL':
    case 'S':
      return [{ t: 'del', c: kids() }];
    case 'MARK':
      return [{ t: 'mark', c: kids() }];
    case 'CODE':
      return [{ t: 'codespan', v: el.textContent ?? '' }];
    case 'KBD':
      return [{ t: 'kbd', v: el.textContent ?? '' }];
    case 'IMG': {
      const out: Inline = { t: 'img', src: el.getAttribute('src') ?? '', alt: el.getAttribute('alt') ?? '' };
      const title = el.getAttribute('title');
      if (title) out.title = title;
      return [out];
    }
    case 'SUP':
      if (el.classList.contains('md-fn-ref')) {
        const a = el.querySelector('a');
        return [{ t: 'fnref', id: (a?.getAttribute('href') ?? '').replace(/^#fn-/, ''), n: Number(a?.textContent ?? '0') }];
      }
      return Array.from(el.childNodes).flatMap(inline);
    case 'SPAN':
      if (el.classList.contains('md-tag')) return [{ t: 'tag', v: (el.textContent ?? '').replace(/^#/, '') }];
      if (el.classList.contains('md-figure')) return inline(el.querySelector('img')!);
      return Array.from(el.childNodes).flatMap(inline);
    case 'A': {
      const out: Inline = { t: 'link', href: el.getAttribute('href') ?? '', c: kids() };
      const title = el.getAttribute('title');
      if (title) out.title = title;
      return [out];
    }
    case 'INPUT':
      return [];
    default:
      // Inline HTML the profile does not name (sub, span, u…) is
      // unwrapped: its text stays, the tag does not (§3.9).
      return Array.from(el.childNodes).flatMap(inline);
  }
}
