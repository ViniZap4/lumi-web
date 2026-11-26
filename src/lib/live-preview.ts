// Obsidian-style "Live Preview" for CodeMirror 6.
//
// Markdown syntax is hidden and the text styled in place; the raw
// syntax comes back on every line that holds a cursor or selection.
// Everything here is PURELY VISUAL: decorations are derived from the
// editor state (doc + selection + lezer syntax tree) and never touch
// the document. The single programmatic edit — toggling a task
// checkbox — is a 1-character ranged change (`[ ]` <-> `[x]`), so
// y-codemirror.next forwards it as a minimal Y.Text delete+insert
// (CRDT-CLIENT-PROTOCOL rule 3: ranged ops only).
//
// The builder (`computeLivePreview`) is split from the CodeMirror
// glue so tests can assert "given doc + cursor, which ranges hide".
//
// Work per transaction is O(changed lines + viewport), never
// O(document) (docs/phase3, WP0.5):
// - Block widgets (tables, mermaid diagrams) must come from a
//   StateField, because a ViewPlugin may not replace line breaks. That
//   field holds ONLY the block widgets. It maps them through each
//   change and rescans just the changed lines, falling back to a
//   block-only scan (which skips every inline node) when the block
//   structure did not realign after the edit.
// - Everything else (inline marks, hidden syntax, line classes,
//   checkboxes, bullets, images) comes from a ViewPlugin that builds
//   decorations for the viewport only.
// Plain cursor moves within a line are free for both layers.

import { EditorState, StateField, Facet, Range, type Extension, type Text, type ChangeSpec, type ChangeSet, type Transaction } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import type { SyntaxNode, Tree } from '@lezer/common';
import { renderMarkdown } from './markdown.ts';
import { isMermaidLang } from './mermaid-detect.ts';
import { createMermaidBlock, paintMermaid, setMermaidSource } from './mermaid.ts';
import { modName } from './platform.ts';

// ---------------------------------------------------------------------------
// Pure helpers

/** Absolute http(s)/mailto URL safe to open, else null. Anything else —
 *  `javascript:`, `data:`, `vbscript:`, relative paths — is not
 *  clickable. Parsing via URL normalises tricks like `java\tscript:`. */
export function safeHref(raw: string): string | null {
  const s = raw.trim().replace(/^<|>$/g, '');
  if (!s || /[\u0000-\u001f\u007f]/.test(s.replace(/[\t\n\r]/g, ''))) return null;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:' && u.protocol !== 'mailto:') return null;
  return u.href;
}

/** Relative note link (`other.md`, `../a/b.md`, `/x`) — opened inside
 *  the app, never by the browser. Anything with a scheme, `//host` or a
 *  pure `#fragment` is not a note link. */
export function noteHref(raw: string): string | null {
  const s = raw.trim().replace(/^<|>$/g, '');
  if (!s || s.startsWith('#') || s.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(s)) return null;
  if (/[\u0000-\u001f\u007f]/.test(s)) return null;
  return s;
}

/** In-app handler for note links (Ctrl/Cmd+click in Live Preview). */
export const noteLinkHandler = Facet.define<(href: string, e?: MouseEvent) => void>();

/** Image source safe for an <img> (CSP img-src: self data: blob: https:). */
export function safeImageSrc(raw: string): string | null {
  const s = raw.trim().replace(/^<|>$/g, '');
  if (!s) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) {
    // Relative path: same treatment as the reading view. Protocol-
    // relative `//host` would be a cross-origin fetch; refuse it.
    return s.startsWith('//') ? null : s;
  }
  try {
    const u = new URL(s);
    if (u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'blob:') return u.href;
    if (u.protocol === 'data:' && /^data:image\/(png|jpe?g|gif|webp|avif);/i.test(s)) return s;
  } catch {
    // fall through
  }
  return null;
}

/** Ranged change that toggles the task marker starting at `pos`
 *  (`[ ]` <-> `[x]`), or null when `pos` is not a task marker. Only the
 *  single inner character is replaced. */
export function taskToggleChange(doc: Text, pos: number): ChangeSpec | null {
  if (pos < 0 || pos + 3 > doc.length) return null;
  const marker = doc.sliceString(pos, pos + 3);
  if (!/^\[[ xX]\]$/.test(marker)) return null;
  const checked = marker[1] !== ' ';
  return { from: pos + 1, to: pos + 2, insert: checked ? ' ' : 'x' };
}

/** 1-based line numbers touched by any selection range. */
export function activeLines(state: EditorState): Set<number> {
  const out = new Set<number>();
  for (const r of state.selection.ranges) {
    const a = state.doc.lineAt(r.from).number;
    const b = state.doc.lineAt(r.to).number;
    for (let n = a; n <= b; n++) out.add(n);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Spec model (what the builder decides; turned into Decorations later)

export type LPWidget =
  | { kind: 'checkbox'; checked: boolean }
  | { kind: 'bullet' }
  | { kind: 'image'; src: string | null; alt: string }
  | { kind: 'table'; source: string }
  | { kind: 'mermaid'; source: string };

export type LPSpec =
  | { type: 'hide'; from: number; to: number }
  | { type: 'mark'; from: number; to: number; cls: string; href?: string | null; note?: string | null }
  | { type: 'line'; pos: number; cls: string }
  | { type: 'widget'; from: number; to: number; widget: LPWidget; block?: boolean };

const HEADING_RE = /^ATXHeading([1-6])$/;
const SETEXT_RE = /^SetextHeading([12])$/;

/** Any line of [from, to] is in `active`. */
function anyRevealed(doc: Text, active: Set<number>, from: number, to: number): boolean {
  if (active.size === 0) return false;
  const a = doc.lineAt(from).number;
  const b = doc.lineAt(Math.max(from, to)).number;
  if (b - a + 1 > active.size) {
    for (const n of active) if (n >= a && n <= b) return true;
    return false;
  }
  for (let n = a; n <= b; n++) if (active.has(n)) return true;
  return false;
}

const FENCE_CLOSE_RE = /^\s*(`{3,}|~{3,})\s*$/;

/** The block widget a Table / FencedCode node draws as, or null when it
 *  stays source (revealed, unclosed, not mermaid). Shared by both
 *  layers so they always agree on which ranges a block widget owns. */
function blockWidgetFor(state: EditorState, active: Set<number>, node: SyntaxNode): LPSpec | null {
  const doc = state.doc;
  if (node.name === 'Table') {
    const first = doc.lineAt(node.from);
    const last = doc.lineAt(node.to);
    if (anyRevealed(doc, active, first.from, last.to)) return null;
    return {
      type: 'widget', from: first.from, to: last.to, block: true,
      widget: { kind: 'table', source: doc.sliceString(first.from, last.to) },
    };
  }
  if (node.name === 'FencedCode') {
    // A closed ```mermaid fence draws as a diagram unless the cursor
    // is inside it (then the source is edited as code).
    const info = node.getChild('CodeInfo');
    if (!info || !isMermaidLang(doc.sliceString(info.from, info.to))) return null;
    const first = doc.lineAt(node.from);
    const last = doc.lineAt(node.to);
    if (last.number <= first.number + 1 || !FENCE_CLOSE_RE.test(last.text)) return null;
    if (anyRevealed(doc, active, first.from, last.to)) return null;
    const source = doc.sliceString(doc.line(first.number + 1).from, doc.line(last.number - 1).to);
    return { type: 'widget', from: first.from, to: last.to, block: true, widget: { kind: 'mermaid', source } };
  }
  return null;
}

export interface LPOptions {
  /** Only build specs for [from, to] (line-aligned by the builder). */
  from?: number;
  to?: number;
  /** 'all' (default) includes block widgets; 'inline' leaves them out
   *  (the block layer draws them) and still skips the source they own. */
  layer?: 'all' | 'inline';
}

/**
 * Walk the markdown tree and decide what to hide/style. `active` is the
 * set of revealed line numbers (defaults to the selection's lines).
 * With `from`/`to`, only nodes overlapping that range are visited and
 * only specs inside it are returned.
 */
export function computeLivePreview(state: EditorState, active: Set<number> = activeLines(state), opts: LPOptions = {}): LPSpec[] {
  const doc = state.doc;
  const specs: LPSpec[] = [];
  const ranged = opts.from !== undefined || opts.to !== undefined;
  const rFrom = ranged ? doc.lineAt(Math.max(0, Math.min(opts.from ?? 0, doc.length))).from : 0;
  const rTo = ranged ? doc.lineAt(Math.max(0, Math.min(opts.to ?? doc.length, doc.length))).to : doc.length;
  const withBlocks = opts.layer !== 'inline';
  const lineOf = (pos: number) => doc.lineAt(pos).number;
  /** Any line in [from, to] is revealed. */
  const revealed = (from: number, to: number): boolean => anyRevealed(doc, active, from, to);
  const eachLine = (from: number, to: number, cls: string) => {
    const a = lineOf(Math.max(from, rFrom));
    const b = lineOf(Math.min(Math.max(from, to), rTo));
    for (let n = a; n <= b; n++) specs.push({ type: 'line', pos: doc.line(n).from, cls });
  };
  /** Hide a mark, swallowing one following space (`# `, `> `). */
  const hideWithSpace = (from: number, to: number) => {
    const end = to < doc.length && doc.sliceString(to, to + 1) === ' ' ? to + 1 : to;
    specs.push({ type: 'hide', from, to: end });
  };
  const hideChildren = (node: SyntaxNode, name: string) => {
    for (let c = node.firstChild; c; c = c.nextSibling) {
      if (c.name === name) specs.push({ type: 'hide', from: c.from, to: c.to });
    }
  };

  syntaxTree(state).iterate({
    from: rFrom,
    to: rTo,
    enter: (ref) => {
      const name = ref.name;
      const node = ref.node;
      const { from, to } = ref;

      let m = HEADING_RE.exec(name);
      if (m) {
        specs.push({ type: 'line', pos: doc.lineAt(from).from, cls: `cm-lp-h cm-lp-h${m[1]}` });
        if (!revealed(from, to)) {
          const mark = node.getChild('HeaderMark');
          // Leading marks only (`# Title #` closing marks stay visible).
          if (mark && mark.from === from) hideWithSpace(mark.from, mark.to);
        }
        return;
      }
      m = SETEXT_RE.exec(name);
      if (m) {
        specs.push({ type: 'line', pos: doc.lineAt(from).from, cls: `cm-lp-h cm-lp-h${m[1]}` });
        return;
      }

      switch (name) {
        case 'Emphasis':
        case 'StrongEmphasis':
        case 'Strikethrough': {
          const cls = name === 'Emphasis' ? 'cm-lp-em' : name === 'StrongEmphasis' ? 'cm-lp-strong' : 'cm-lp-strike';
          specs.push({ type: 'mark', from, to, cls });
          if (!revealed(from, to)) hideChildren(node, name === 'Strikethrough' ? 'StrikethroughMark' : 'EmphasisMark');
          return;
        }
        case 'InlineCode': {
          specs.push({ type: 'mark', from, to, cls: 'cm-lp-inline-code' });
          if (!revealed(from, to)) hideChildren(node, 'CodeMark');
          return false;
        }
        case 'Escape': {
          if (!revealed(from, to)) specs.push({ type: 'hide', from, to: from + 1 });
          return false;
        }
        case 'Link': {
          const marks = node.getChildren('LinkMark');
          const url = node.getChild('URL');
          const rawUrl = url ? doc.sliceString(url.from, url.to) : '';
          const href = url ? safeHref(rawUrl) : null;
          const note = url && !href ? noteHref(rawUrl) : null;
          // `[text](url)`: marks are `[`, `]`, `(`, `)`.
          if (marks.length >= 2 && marks[0].from === from && doc.sliceString(marks[0].from, marks[0].to) === '[') {
            const textFrom = marks[0].to;
            const textTo = marks[1].from;
            if (textTo > textFrom) specs.push({ type: 'mark', from: textFrom, to: textTo, cls: note ? 'cm-lp-link cm-lp-note-link' : 'cm-lp-link', href, note });
            if (!revealed(from, to) && url && textTo > textFrom) {
              specs.push({ type: 'hide', from, to: textFrom });
              specs.push({ type: 'hide', from: textTo, to });
            }
          }
          return; // descend: emphasis / code inside link text
        }
        case 'Autolink': {
          const url = node.getChild('URL');
          if (url) {
            specs.push({ type: 'mark', from: url.from, to: url.to, cls: 'cm-lp-link', href: safeHref(doc.sliceString(url.from, url.to)) });
            if (!revealed(from, to)) hideChildren(node, 'LinkMark');
          }
          return false;
        }
        case 'URL': {
          // Bare GFM URL (URLs inside Link/Autolink/Image are handled
          // by their parents, which don't descend into them).
          specs.push({ type: 'mark', from, to, cls: 'cm-lp-link', href: safeHref(doc.sliceString(from, to)) });
          return false;
        }
        case 'Image': {
          if (revealed(from, to)) return false;
          const marks = node.getChildren('LinkMark');
          const url = node.getChild('URL');
          if (!url || marks.length < 2) return false;
          const alt = doc.sliceString(marks[0].to, marks[1].from);
          specs.push({
            type: 'widget', from, to,
            widget: { kind: 'image', src: safeImageSrc(doc.sliceString(url.from, url.to)), alt },
          });
          return false;
        }
        case 'ListItem': {
          const mark = node.getChild('ListMark');
          const task = node.getChild('Task');
          const marker = task?.getChild('TaskMarker');
          const lineRevealed = revealed(from, from);
          if (marker) {
            const txt = doc.sliceString(marker.from, marker.to);
            const checked = /x/i.test(txt);
            if (checked) specs.push({ type: 'line', pos: doc.lineAt(from).from, cls: 'cm-lp-task-done' });
            if (!lineRevealed) {
              if (mark) specs.push({ type: 'hide', from: mark.from, to: marker.from });
              specs.push({ type: 'widget', from: marker.from, to: marker.to, widget: { kind: 'checkbox', checked } });
            }
          } else if (mark && !lineRevealed && /^[-*+]$/.test(doc.sliceString(mark.from, mark.to))) {
            specs.push({ type: 'widget', from: mark.from, to: mark.to, widget: { kind: 'bullet' } });
          }
          return;
        }
        case 'Blockquote': {
          eachLine(from, to, 'cm-lp-quote');
          return;
        }
        case 'QuoteMark': {
          if (!revealed(from, to)) hideWithSpace(from, to);
          return;
        }
        case 'HorizontalRule': {
          specs.push({ type: 'line', pos: doc.lineAt(from).from, cls: 'cm-lp-hr' });
          if (!revealed(from, to)) specs.push({ type: 'hide', from, to });
          return false;
        }
        case 'FencedCode':
        case 'CodeBlock': {
          if (name === 'FencedCode') {
            const block = blockWidgetFor(state, active, node);
            if (block) {
              if (withBlocks) specs.push(block);
              return false;
            }
          }
          eachLine(from, to, 'cm-lp-codeblock');
          if (name === 'FencedCode') {
            specs.push({ type: 'line', pos: doc.lineAt(from).from, cls: 'cm-lp-fence cm-lp-fence-open' });
            const last = doc.lineAt(to);
            if (last.number !== lineOf(from) && FENCE_CLOSE_RE.test(last.text)) {
              specs.push({ type: 'line', pos: last.from, cls: 'cm-lp-fence cm-lp-fence-close' });
            }
          }
          return false;
        }
        case 'Table': {
          const block = blockWidgetFor(state, active, node);
          if (block) {
            if (withBlocks) specs.push(block);
          } else {
            eachLine(from, to, 'cm-lp-table-src');
          }
          return false;
        }
        case 'HTMLBlock':
        case 'CommentBlock':
        case 'FrontMatter':
          return false;
      }
      return;
    },
  });
  if (!ranged) return specs;
  // Nodes that overlap the range can start or end outside it.
  return specs.filter((sp) => (sp.type === 'line' ? sp.pos >= rFrom && sp.pos <= rTo : sp.to >= rFrom && sp.from <= rTo));
}

/** Container nodes the block scan descends into (tables and fences
 *  can sit inside quotes and list items). Everything else is a leaf
 *  block whose inline content never holds a block widget. */
const BLOCK_CONTAINERS = new Set(['Document', 'Blockquote', 'BulletList', 'OrderedList', 'ListItem']);

/** Block widgets (tables, mermaid) overlapping [from, to]. Visits only
 *  block-level nodes, so a whole-document scan costs O(blocks), not
 *  O(inline nodes). */
export function scanBlockWidgets(state: EditorState, active: Set<number>, from = 0, to = state.doc.length): LPSpec[] {
  const out: LPSpec[] = [];
  syntaxTree(state).iterate({
    from,
    to,
    enter: (ref) => {
      const name = ref.name;
      if (name === 'Table' || name === 'FencedCode') {
        const w = blockWidgetFor(state, active, ref.node);
        if (w) out.push(w);
        return false;
      }
      return BLOCK_CONTAINERS.has(name) || ref.type.isAnonymous ? undefined : false;
    },
  });
  return out;
}

// ---------------------------------------------------------------------------
// Widgets

class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean) { super(); }
  eq(o: CheckboxWidget) { return o.checked === this.checked; }
  toDOM(view: EditorView): HTMLElement {
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.className = 'cm-lp-checkbox';
    box.checked = this.checked;
    box.setAttribute('aria-label', this.checked ? 'Mark task as not done' : 'Mark task as done');
    box.addEventListener('mousedown', (e) => {
      // Keep focus/selection where they are; toggle on our terms.
      e.preventDefault();
      e.stopPropagation();
      if (view.state.readOnly) return;
      const pos = view.posAtDOM(box);
      const change = taskToggleChange(view.state.doc, pos);
      if (change) view.dispatch({ changes: change, userEvent: 'input.toggle-task' });
    });
    box.addEventListener('click', (e) => e.preventDefault());
    return box;
  }
  ignoreEvent() { return true; }
}

class BulletWidget extends WidgetType {
  eq() { return true; }
  toDOM(): HTMLElement {
    const s = document.createElement('span');
    s.className = 'cm-lp-bullet';
    s.textContent = '•';
    return s;
  }
}

class ImageWidget extends WidgetType {
  constructor(readonly src: string | null, readonly alt: string) { super(); }
  eq(o: ImageWidget) { return o.src === this.src && o.alt === this.alt; }
  toDOM(): HTMLElement {
    if (!this.src) {
      const s = document.createElement('span');
      s.className = 'cm-lp-image-blocked';
      s.textContent = `[image: ${this.alt || 'blocked source'}]`;
      return s;
    }
    const img = document.createElement('img');
    img.className = 'cm-lp-image';
    img.src = this.src;
    img.alt = this.alt;
    img.loading = 'lazy';
    img.referrerPolicy = 'no-referrer';
    return img;
  }
  ignoreEvent() { return false; }
}

class TableWidget extends WidgetType {
  constructor(readonly source: string) { super(); }
  eq(o: TableWidget) { return o.source === this.source; }
  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'cm-lp-table md-body';
    // Same marked -> DOMPurify path as the reading view.
    wrap.innerHTML = renderMarkdown(this.source);
    wrap.addEventListener('mousedown', (e) => {
      // Clicking the rendered table drops the cursor into its source.
      e.preventDefault();
      const pos = view.posAtDOM(wrap);
      view.dispatch({ selection: { anchor: pos } });
      view.focus();
    });
    return wrap;
  }
  ignoreEvent() { return true; }
}

/** A ```mermaid block drawn in place (lib/mermaid.ts). Source edits
 *  that arrive while it is shown (collaborators) update the same DOM,
 *  debounced, so the old drawing stays until the new one is ready. */
class MermaidWidget extends WidgetType {
  constructor(readonly source: string) { super(); }
  eq(o: MermaidWidget) { return o.source === this.source; }
  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'cm-lp-mermaid md-body';
    const block = createMermaidBlock(this.source);
    block.dataset.surface = 'editor';
    wrap.append(block);
    paintMermaid(block);
    wrap.addEventListener('mousedown', (e) => {
      if ((e.target as HTMLElement).closest('button')) return;
      // Clicking the drawing drops the cursor into its source.
      e.preventDefault();
      const line = view.state.doc.lineAt(view.posAtDOM(wrap));
      const inner = Math.min(line.to + 1, view.state.doc.length);
      view.dispatch({ selection: { anchor: inner } });
      view.focus();
    });
    return wrap;
  }
  updateDOM(dom: HTMLElement): boolean {
    const block = dom.querySelector<HTMLElement>('.md-mermaid');
    if (!block) return false;
    setMermaidSource(block, this.source);
    paintMermaid(block, { debounce: 300 });
    return true;
  }
  ignoreEvent() { return true; }
}

function widgetFor(w: LPWidget): WidgetType {
  switch (w.kind) {
    case 'checkbox': return new CheckboxWidget(w.checked);
    case 'bullet': return new BulletWidget();
    case 'image': return new ImageWidget(w.src, w.alt);
    case 'table': return new TableWidget(w.source);
    case 'mermaid': return new MermaidWidget(w.source);
  }
}

const hideDeco = Decoration.replace({});

/**
 * Specs -> DecorationSet. With `doc` (the ViewPlugin layer), replacing
 * ranges never cross a line break, which plugins may not do: a hide is
 * split per line and an inline widget spanning lines (an image whose
 * alt text wraps) is left as source.
 */
export function specsToDecorations(specs: LPSpec[], doc?: Text): DecorationSet {
  return Decoration.set(specsToRanges(specs, doc), true);
}

function specsToRanges(specs: LPSpec[], doc?: Text): Range<Decoration>[] {
  const ranges: Range<Decoration>[] = [];
  for (const s of specs) {
    switch (s.type) {
      case 'hide':
        if (s.to <= s.from) break;
        if (doc) {
          let from = s.from;
          while (from < s.to) {
            const line = doc.lineAt(from);
            const to = Math.min(line.to, s.to);
            if (to > from) ranges.push(hideDeco.range(from, to));
            from = line.to + 1;
          }
        } else {
          ranges.push(hideDeco.range(s.from, s.to));
        }
        break;
      case 'mark': {
        if (s.to <= s.from) break;
        const attributes: Record<string, string> = {};
        if (s.href) attributes['data-lp-href'] = s.href;
        if (s.href) attributes.title = `${s.href} (${modName()}-click to open)`;
        if (s.note) {
          attributes['data-lp-note'] = s.note;
          attributes.title = `${s.note} (${modName()}-click to open the note)`;
        }
        ranges.push(Decoration.mark({ class: s.cls, attributes }).range(s.from, s.to));
        break;
      }
      case 'line':
        ranges.push(Decoration.line({ class: s.cls }).range(s.pos));
        break;
      case 'widget':
        if (doc && !s.block && doc.lineAt(s.from).to < s.to) break;
        ranges.push(Decoration.replace({ widget: widgetFor(s.widget), block: !!s.block }).range(s.from, s.to));
        break;
    }
  }
  return ranges;
}

// ---------------------------------------------------------------------------
// Extension

function linesKey(s: Set<number>): string {
  return Array.from(s).sort((a, b) => a - b).join(',');
}

/** [from, to] of each active line, so they can be mapped later. */
function lineSpans(state: EditorState, active: Set<number>): number[] {
  const out: number[] = [];
  for (const n of active) {
    if (n > state.doc.lines) continue;
    const l = state.doc.line(n);
    out.push(l.from, l.to);
  }
  return out;
}

/** The parse covers the whole document (an unfinished parse has holes
 *  that a later tree-only transaction fills in). */
function treeComplete(state: EditorState, tree: Tree): boolean {
  return tree.length >= state.doc.length;
}

interface ChainNode { name: string; from: number; to: number; head: number }

/** Chain of block nodes holding (or, between blocks, following) `pos`:
 *  every enclosing container down to the leaf block. */
function blockChain(tree: Tree, pos: number): ChainNode[] {
  const chain: ChainNode[] = [];
  let node: SyntaxNode = tree.topNode;
  for (;;) {
    // Block children only: a list or quote mark is not part of the
    // block structure.
    let c = node.childAfter(pos);
    while (c && !c.type.is('Block')) c = c.nextSibling;
    if (!c) return chain;
    // `head`: where a container's own decorations end (a list item's
    // hidden mark runs up to its task marker).
    chain.push({ name: c.name, from: c.from, to: c.to, head: c.name === 'ListItem' ? (c.getChild('Task')?.from ?? c.from) : c.from });
    if (!BLOCK_CONTAINERS.has(c.name)) return chain;
    // A container that starts after `pos` is followed down to its first
    // leaf, so a split of its first child is seen too.
    node = c;
    pos = Math.max(pos, c.from);
  }
}

/** After `changes`, the block structure realigned with the old tree
 *  right after every changed range: the same containers and leaf block,
 *  at the mapped positions. When it did not (an opened or closed fence,
 *  an HTML block), the change reaches past the edited lines. */
function blocksRealigned(changes: ChangeSet, oldTree: Tree, newTree: Tree): boolean {
  let ok = true;
  /** Same chain at old `pa` / new `pb`: names, mapped ends, and mapped
   *  starts for blocks that start after the change. */
  const sameChain = (pa: number, pb: number, tA: number): ChainNode[] | null => {
    const a = blockChain(oldTree, pa);
    const b = blockChain(newTree, pb);
    if (a.length !== b.length) return null;
    for (let i = 0; i < a.length; i++) {
      if (a[i].name !== b[i].name || changes.mapPos(a[i].to, 1) !== b[i].to) return null;
      if (a[i].from >= tA && changes.mapPos(a[i].from, 1) !== b[i].from) return null;
    }
    return a;
  };
  changes.iterChangedRanges((_fA, tA, _fB, tB) => {
    if (!ok) return;
    // At the end of the change, and at the block right after the
    // edited leaf (children re-parented under the same container).
    const a = sameChain(tA, tB, tA);
    if (!a) { ok = false; return; }
    const leaf = a[a.length - 1];
    if (leaf && leaf.from <= tA && leaf.to >= tA && leaf.to + 1 <= oldTree.length) {
      if (!sameChain(leaf.to + 1, changes.mapPos(leaf.to + 1, 1), tA)) ok = false;
    }
  });
  return ok;
}

/** Ranges whose decorations an edit at `pos` can change beyond its own
 *  line: the leaf blocks touching `pos` (one ending exactly at `pos`
 *  included: an edit at the end of a line can change the block it
 *  ends, such as a setext underline), and the head of every enclosing
 *  container (a list item's bullet or checkbox depends on its
 *  children). */
function contextAt(tree: Tree, pos: number): [number, number][] {
  const out: [number, number][] = [];
  for (const p of pos > 0 ? [pos, pos - 1] : [pos]) {
    const chain = blockChain(tree, p);
    for (let i = 0; i < chain.length; i++) {
      const n = chain[i];
      if (n.from > pos || n.to < pos) continue;
      if (i === chain.length - 1 && !BLOCK_CONTAINERS.has(n.name)) out.push([n.from, n.to]);
      else out.push([n.from, n.head]);
    }
  }
  return out;
}

function blockBefore(parent: SyntaxNode, pos: number): SyntaxNode | null {
  let c = parent.childBefore(pos);
  while (c && !c.type.is('Block')) c = c.prevSibling;
  return c;
}

function prevBlock(node: SyntaxNode): SyntaxNode | null {
  let c = node.prevSibling;
  while (c && !c.type.is('Block')) c = c.prevSibling;
  return c;
}

/**
 * Where the old and new trees agree again before a change at old `fA`
 * / new `fB`: the end of the nearest block, walking back from the
 * change, that is identical (name and extent) in both trees. Blocks
 * before the edited line can change shape, because a leaf block's parse
 * looks at the line after it (a setext underline, a table delimiter row
 * typed into the next list item), so that whole stretch is dirty. A
 * container holding the change in both trees is searched first, then
 * the walk goes on before it. Returns 0 when nothing agrees (the whole
 * prefix is dirty) and null when the walk budget runs out.
 */
function agreeBefore(oldTop: SyntaxNode, newTop: SyntaxNode, fA: number, fB: number): number | null {
  const budget = { left: 64 };
  const walk = (o: SyntaxNode, n: SyntaxNode): number | null | undefined => {
    let oc = blockBefore(o, fA);
    let nc = blockBefore(n, fB);
    if (oc && nc && oc.from === nc.from && oc.name === nc.name && BLOCK_CONTAINERS.has(oc.name) && oc.to >= fA && nc.to >= fB) {
      const inner = walk(oc, nc);
      if (inner !== undefined) return inner;
      oc = prevBlock(oc);
      nc = prevBlock(nc);
    }
    while (oc && nc) {
      if (budget.left-- <= 0) return null;
      if (oc.name === nc.name && oc.from === nc.from && oc.to === nc.to && oc.to < fA) return oc.to;
      const of = oc.from;
      const nf = nc.from;
      if (of >= nf) oc = prevBlock(oc);
      if (nf >= of) nc = prevBlock(nc);
    }
    return undefined; // nothing agrees in this container
  };
  const r = walk(oldTop, newTop);
  return r === undefined ? 0 : r;
}

/** One decoration layer, kept in sync incrementally. */
export interface Layer {
  decos: DecorationSet;
  key: string;
  /** Active line spans (flat [from, to, ...]) for this layer's state. */
  spans: number[];
}

interface LayerStep {
  startState: EditorState;
  state: EditorState;
  changes: ChangeSet;
  docChanged: boolean;
  selectionSet: boolean;
}

export interface LayerKind {
  /** Decorations for [from, to] of `state`. */
  build(state: EditorState, active: Set<number>, from: number, to: number): Range<Decoration>[];
  /** The extent the layer covers (the doc, or the viewport). */
  extent(state: EditorState): [number, number];
}

export function freshLayer(kind: LayerKind, state: EditorState, active: Set<number> = activeLines(state), key = linesKey(active)): Layer {
  const [from, to] = kind.extent(state);
  return { decos: Decoration.set(kind.build(state, active, from, to), true), key, spans: lineSpans(state, active) };
}

/**
 * Next state of a layer. The decorations are mapped through the change
 * and only the dirty lines are rebuilt: the changed lines (grown to
 * their blocks, and back to where the old and new trees agree) plus the
 * lines that gained or lost the cursor. The whole extent is rebuilt only when asked (`force`), when
 * the parse is unfinished or progressed on its own, or when the block
 * structure did not realign after the edit.
 */
export function stepLayer(kind: LayerKind, value: Layer, u: LayerStep, force = false): Layer {
  const oldTree = syntaxTree(u.startState);
  const newTree = syntaxTree(u.state);
  const treeChanged = oldTree !== newTree;
  if (!force && !u.docChanged && !treeChanged && !u.selectionSet) return value;
  const state = u.state;
  const active = activeLines(state);
  const key = linesKey(active);
  if (!force && !u.docChanged && !treeChanged && key === value.key) return value;
  if (force || (!u.docChanged && treeChanged)) return freshLayer(kind, state, active, key);
  if (u.docChanged && (!treeComplete(u.startState, oldTree) || !treeComplete(state, newTree)
    || !blocksRealigned(u.changes, oldTree, newTree))) return freshLayer(kind, state, active, key);

  const doc = state.doc;
  const dirty: number[] = [];
  // A dirty range grows to its leaf blocks and container heads: inline
  // nodes (a two-line emphasis) live inside one leaf block, and a table
  // can grow or appear around the edited line.
  const grow = (tree: Tree, from: number, to: number, map: ((p: number, assoc: number) => number) | null) => {
    dirty.push(map ? map(from, -1) : from, map ? map(to, 1) : to);
    for (const leaf of [...contextAt(tree, from), ...contextAt(tree, to)]) {
      dirty.push(map ? map(leaf[0], -1) : leaf[0], map ? map(leaf[1], 1) : leaf[1]);
    }
  };
  const map = (p: number, assoc: number) => u.changes.mapPos(p, assoc);
  if (u.docChanged) {
    let lost = false;
    u.changes.iterChangedRanges((fA, tA, fB, tB) => {
      grow(newTree, fB, tB, null);
      grow(oldTree, fA, tA, map);
      const agree = lost ? null : agreeBefore(oldTree.topNode, newTree.topNode, fA, fB);
      if (agree === null) lost = true;
      else if (agree < fB) dirty.push(agree, fB);
    });
    if (lost) return freshLayer(kind, state, active, key);
  }
  // Line numbers shift under a doc change, so an equal key does not
  // mean the same lines: then compare by the mapped spans.
  if (key !== value.key || u.docChanged) {
    // Old spans are positions in the start state's doc.
    for (let i = 0; i < value.spans.length; i += 2) grow(oldTree, value.spans[i], value.spans[i + 1], map);
    const now = lineSpans(state, active);
    for (let i = 0; i < now.length; i += 2) grow(newTree, now[i], now[i + 1], null);
  }
  // Line-align, clip to the (line-aligned) extent and merge.
  const [eFrom, eTo] = kind.extent(state);
  const eA = doc.lineAt(eFrom).from;
  const eB = doc.lineAt(eTo).to;
  const ranges: [number, number][] = [];
  for (let i = 0; i < dirty.length; i += 2) {
    const f = Math.max(doc.lineAt(Math.min(dirty[i], doc.length)).from, eA);
    const t = Math.min(doc.lineAt(Math.min(dirty[i + 1], doc.length)).to, eB);
    if (f <= t) ranges.push([f, t]);
  }
  ranges.sort((x, y) => x[0] - y[0]);
  let decos = u.docChanged ? value.decos.map(u.changes) : value.decos;
  if (u.docChanged) {
    // Keep the invariant "the layer is a fresh build of its extent":
    // drop what the change pushed outside it (cheap, since nothing else
    // lives out there).
    if (eA > 0) decos = decos.update({ filterFrom: 0, filterTo: eA, filter: (_f, t) => t >= eA });
    if (eB < doc.length) decos = decos.update({ filterFrom: eB, filterTo: doc.length, filter: (f) => f <= eB });
  }
  let i = 0;
  while (i < ranges.length) {
    let [a, b] = ranges[i++];
    while (i < ranges.length && ranges[i][0] <= b + 1) b = Math.max(b, ranges[i++][1]);
    const add = kind.build(state, active, a, b);
    decos = decos.update({
      filterFrom: a,
      filterTo: b,
      filter: (f, t) => t < a || f > b,
      add: add.length ? add : undefined,
      sort: true,
    });
  }
  return { decos, key, spans: u.selectionSet || u.docChanged ? lineSpans(state, active) : value.spans };
}

export const blockKind: LayerKind = {
  build: (state, active, from, to) => specsToRanges(scanBlockWidgets(state, active, from, to)),
  extent: (state) => [0, state.doc.length],
};

/** Inline layer over a fixed [from, to] window (tests and benchmark;
 *  the editor uses the live viewport). */
export function inlineKindFor(window: () => [number, number]): LayerKind {
  return {
    build: (state, active, from, to) => {
      // Pieces of a split multi-line hide can fall outside the range.
      const lo = state.doc.lineAt(from).from;
      const hi = state.doc.lineAt(to).to;
      return specsToRanges(computeLivePreview(state, active, { from, to, layer: 'inline' }), state.doc)
        .filter((r) => r.to >= lo && r.from <= hi);
    },
    extent: (state) => {
      const [f, t] = window();
      return [Math.min(f, state.doc.length), Math.min(t, state.doc.length)];
    },
  };
}

function stepOf(tr: Transaction): LayerStep {
  return { startState: tr.startState, state: tr.state, changes: tr.changes, docChanged: tr.docChanged, selectionSet: !!tr.selection };
}

/** `stepLayer` for one transaction. */
export function stepLayerTr(kind: LayerKind, value: Layer, tr: Transaction, force = false): Layer {
  return stepLayer(kind, value, stepOf(tr), force);
}

/** Block widgets (tables, mermaid). They replace line breaks, so they
 *  must come from state, not from a plugin. */
const blockLayerField = StateField.define<Layer>({
  create(state) {
    const active = activeLines(state);
    return freshLayer(blockKind, state, active, linesKey(active));
  },
  update: (value, tr) => stepLayerTr(blockKind, value, tr),
  provide: (f) => EditorView.decorations.from(f, (v) => v.decos),
});

function inlineKind(view: EditorView): LayerKind {
  return inlineKindFor(() => [view.viewport.from, view.viewport.to]);
}

/** Inline marks, hidden syntax, line classes and inline widgets, built
 *  for the viewport only and kept in sync change by change. */
const inlineLayer = ViewPlugin.fromClass(
  class {
    layer: Layer;
    kind: LayerKind;
    constructor(view: EditorView) {
      this.kind = inlineKind(view);
      const active = activeLines(view.state);
      this.layer = freshLayer(this.kind, view.state, active, linesKey(active));
    }
    update(u: ViewUpdate) {
      // A new viewport rebuilds it whole (O(viewport)); edits inside the
      // same viewport only touch their lines.
      this.layer = stepLayer(this.kind, this.layer, u, u.viewportChanged);
    }
    get decos() { return this.layer.decos; }
  },
  { decorations: (p) => p.decos },
);

const linkClicks = EditorView.domEventHandlers({
  mousedown(e, view) {
    if (!(e.metaKey || e.ctrlKey) || e.button !== 0) return false;
    const noteEl = (e.target as HTMLElement | null)?.closest?.('[data-lp-note]');
    const note = noteEl?.getAttribute('data-lp-note');
    if (note && noteHref(note)) {
      const handlers = view.state.facet(noteLinkHandler);
      if (handlers.length === 0) return false;
      e.preventDefault();
      handlers[0](note, e);
      return true;
    }
    const el = (e.target as HTMLElement | null)?.closest?.('[data-lp-href]');
    const href = el?.getAttribute('data-lp-href');
    // Re-validate: the attribute is ours, but never trust the DOM.
    const safe = href ? safeHref(href) : null;
    if (!safe) return false;
    e.preventDefault();
    window.open(safe, '_blank', 'noopener,noreferrer');
    return true;
  },
});

// Styles live in app.css (`.cm-lp-*`), next to `.md-body`, so Live
// Preview and the reader share one set of typographic tokens.

/** The Live Preview extension (block field + viewport plugin + click
 *  handling; styles live in app.css). */
export function livePreview(): Extension {
  return [blockLayerField, inlineLayer, linkClicks];
}
