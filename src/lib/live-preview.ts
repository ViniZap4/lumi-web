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
// Block widgets (tables) must come from a StateField — a ViewPlugin
// may not replace line breaks — so the whole thing is one StateField.
// It only rebuilds when the doc, the syntax tree, or the set of
// "active" lines changes; plain cursor moves within a line are free.

import { EditorState, StateField, Range, type Extension, type Text, type ChangeSpec } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import type { SyntaxNode } from '@lezer/common';
import { renderMarkdown } from './markdown.ts';

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
  | { kind: 'table'; source: string };

export type LPSpec =
  | { type: 'hide'; from: number; to: number }
  | { type: 'mark'; from: number; to: number; cls: string; href?: string | null }
  | { type: 'line'; pos: number; cls: string }
  | { type: 'widget'; from: number; to: number; widget: LPWidget; block?: boolean };

const HEADING_RE = /^ATXHeading([1-6])$/;
const SETEXT_RE = /^SetextHeading([12])$/;

/**
 * Walk the markdown tree and decide what to hide/style. `active` is the
 * set of revealed line numbers (defaults to the selection's lines).
 */
export function computeLivePreview(state: EditorState, active: Set<number> = activeLines(state)): LPSpec[] {
  const doc = state.doc;
  const specs: LPSpec[] = [];
  const lineOf = (pos: number) => doc.lineAt(pos).number;
  /** Any line in [from, to] is revealed. */
  const revealed = (from: number, to: number): boolean => {
    const a = lineOf(from);
    const b = lineOf(Math.max(from, to));
    for (let n = a; n <= b; n++) if (active.has(n)) return true;
    return false;
  };
  const eachLine = (from: number, to: number, cls: string) => {
    const a = lineOf(from);
    const b = lineOf(Math.max(from, to));
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
          const href = url ? safeHref(doc.sliceString(url.from, url.to)) : null;
          // `[text](url)`: marks are `[`, `]`, `(`, `)`.
          if (marks.length >= 2 && marks[0].from === from && doc.sliceString(marks[0].from, marks[0].to) === '[') {
            const textFrom = marks[0].to;
            const textTo = marks[1].from;
            if (textTo > textFrom) specs.push({ type: 'mark', from: textFrom, to: textTo, cls: 'cm-lp-link', href });
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
          eachLine(from, to, 'cm-lp-codeblock');
          if (name === 'FencedCode') {
            specs.push({ type: 'line', pos: doc.lineAt(from).from, cls: 'cm-lp-fence cm-lp-fence-open' });
            const last = doc.lineAt(to);
            if (last.number !== lineOf(from) && /^\s*(`{3,}|~{3,})\s*$/.test(last.text)) {
              specs.push({ type: 'line', pos: last.from, cls: 'cm-lp-fence cm-lp-fence-close' });
            }
          }
          return false;
        }
        case 'Table': {
          const first = doc.lineAt(from);
          const last = doc.lineAt(to);
          if (revealed(first.from, last.to)) {
            eachLine(from, to, 'cm-lp-table-src');
          } else {
            specs.push({
              type: 'widget', from: first.from, to: last.to, block: true,
              widget: { kind: 'table', source: doc.sliceString(first.from, last.to) },
            });
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
  return specs;
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
    wrap.className = 'cm-lp-table';
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

function widgetFor(w: LPWidget): WidgetType {
  switch (w.kind) {
    case 'checkbox': return new CheckboxWidget(w.checked);
    case 'bullet': return new BulletWidget();
    case 'image': return new ImageWidget(w.src, w.alt);
    case 'table': return new TableWidget(w.source);
  }
}

const hideDeco = Decoration.replace({});

export function specsToDecorations(specs: LPSpec[]): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  for (const s of specs) {
    switch (s.type) {
      case 'hide':
        if (s.to > s.from) ranges.push(hideDeco.range(s.from, s.to));
        break;
      case 'mark': {
        if (s.to <= s.from) break;
        const attributes: Record<string, string> = {};
        if (s.href) attributes['data-lp-href'] = s.href;
        if (s.href) attributes.title = `${s.href} (Ctrl/Cmd+click to open)`;
        ranges.push(Decoration.mark({ class: s.cls, attributes }).range(s.from, s.to));
        break;
      }
      case 'line':
        ranges.push(Decoration.line({ class: s.cls }).range(s.pos));
        break;
      case 'widget':
        ranges.push(Decoration.replace({ widget: widgetFor(s.widget), block: !!s.block }).range(s.from, s.to));
        break;
    }
  }
  return Decoration.set(ranges, true);
}

// ---------------------------------------------------------------------------
// Extension

interface LPState {
  key: string;
  decos: DecorationSet;
}

function linesKey(s: Set<number>): string {
  return Array.from(s).sort((a, b) => a - b).join(',');
}

function build(state: EditorState): LPState {
  const active = activeLines(state);
  return { key: linesKey(active), decos: specsToDecorations(computeLivePreview(state, active)) };
}

const livePreviewField = StateField.define<LPState>({
  create: build,
  update(value, tr) {
    const treeChanged = syntaxTree(tr.startState) !== syntaxTree(tr.state);
    if (tr.docChanged || treeChanged) return build(tr.state);
    if (tr.selection) {
      const key = linesKey(activeLines(tr.state));
      if (key !== value.key) return build(tr.state);
    }
    return value;
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.decos),
});

const linkClicks = EditorView.domEventHandlers({
  mousedown(e) {
    if (!(e.metaKey || e.ctrlKey) || e.button !== 0) return false;
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

const livePreviewTheme = EditorView.baseTheme({
  '.cm-lp-h': { fontWeight: '700', color: 'var(--color-primary)', lineHeight: '1.35' },
  '.cm-lp-h1': { fontSize: '1.75em', paddingTop: '0.4em' },
  '.cm-lp-h2': { fontSize: '1.45em', paddingTop: '0.3em' },
  '.cm-lp-h3': { fontSize: '1.25em', paddingTop: '0.2em' },
  '.cm-lp-h4': { fontSize: '1.1em' },
  '.cm-lp-h5': { fontSize: '1em' },
  '.cm-lp-h6': { fontSize: '0.95em', color: 'var(--color-text-dim, var(--color-muted))' },
  '.cm-lp-em': { fontStyle: 'italic' },
  '.cm-lp-strong': { fontWeight: '700' },
  '.cm-lp-strike': { textDecoration: 'line-through', opacity: '0.75' },
  '.cm-lp-inline-code': {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: '0.9em',
    background: 'var(--color-selected-bg, rgba(127,127,127,0.15))',
    borderRadius: '3px',
    padding: '0 0.2em',
  },
  '.cm-lp-link': { color: 'var(--color-accent, var(--color-primary))', textDecoration: 'underline', textUnderlineOffset: '2px' },
  '.cm-lp-link[data-lp-href]': { cursor: 'pointer' },
  '.cm-lp-quote': {
    borderLeft: '3px solid var(--color-secondary, var(--color-primary))',
    paddingLeft: '0.9em !important',
    color: 'var(--color-text-dim, var(--color-muted))',
    fontStyle: 'italic',
  },
  '.cm-lp-hr': {
    backgroundImage: 'linear-gradient(var(--color-border, var(--color-muted)), var(--color-border, var(--color-muted)))',
    backgroundSize: '100% 1px',
    backgroundRepeat: 'no-repeat',
    backgroundPosition: 'center',
  },
  '.cm-lp-codeblock': {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: '0.9em',
    background: 'var(--color-selected-bg, rgba(127,127,127,0.12))',
  },
  '.cm-lp-fence': { color: 'var(--color-text-dim, var(--color-muted))', fontSize: '0.8em' },
  '.cm-lp-fence-open': { borderTopLeftRadius: '4px', borderTopRightRadius: '4px' },
  '.cm-lp-fence-close': { borderBottomLeftRadius: '4px', borderBottomRightRadius: '4px' },
  '.cm-lp-table-src': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '0.9em' },
  '.cm-lp-task-done': { color: 'var(--color-text-dim, var(--color-muted))' },
  '.cm-lp-checkbox': {
    margin: '0 0.45em 0 0',
    verticalAlign: 'middle',
    cursor: 'pointer',
    accentColor: 'var(--color-primary)',
  },
  '.cm-lp-bullet': { color: 'var(--color-primary)', display: 'inline-block', width: '0.8em' },
  '.cm-lp-image': { maxWidth: '100%', maxHeight: '28em', verticalAlign: 'middle', borderRadius: '4px' },
  '.cm-lp-image-blocked': { color: 'var(--color-text-dim, var(--color-muted))', fontStyle: 'italic' },
  '.cm-lp-table': { padding: '0.3em 0', cursor: 'text', overflowX: 'auto' },
  '.cm-lp-table table': { borderCollapse: 'collapse', fontFamily: 'inherit' },
  '.cm-lp-table th, .cm-lp-table td': {
    border: '1px solid var(--color-border, var(--color-muted))',
    padding: '0.25em 0.6em',
  },
  '.cm-lp-table th': { background: 'var(--color-selected-bg, transparent)' },
});

/** The Live Preview extension (field + click handling + styles). */
export function livePreview(): Extension {
  return [livePreviewField, linkClicks, livePreviewTheme];
}
