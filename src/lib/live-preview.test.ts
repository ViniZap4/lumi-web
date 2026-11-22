// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { EditorState, Text } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { ensureSyntaxTree } from '@codemirror/language';
import {
  computeLivePreview,
  livePreview,
  safeHref,
  safeImageSrc,
  taskToggleChange,
  type LPSpec,
} from './live-preview.ts';

function stateAt(doc: string, cursor: number | [number, number]): EditorState {
  const [anchor, head] = typeof cursor === 'number' ? [cursor, cursor] : cursor;
  const st = EditorState.create({ doc, selection: { anchor, head }, extensions: [markdown({ base: markdownLanguage })] });
  ensureSyntaxTree(st, st.doc.length, 5000);
  return st;
}

/** Text of every range that disappears (hidden or replaced by a widget). */
function hidden(doc: string, cursor: number | [number, number]): string[] {
  const st = stateAt(doc, cursor);
  return computeLivePreview(st)
    .filter((s): s is Extract<LPSpec, { from: number; to: number }> => s.type === 'hide' || s.type === 'widget')
    .sort((a, b) => a.from - b.from)
    .map((s) => doc.slice(s.from, s.to));
}

const END = (doc: string) => doc.length;

describe('live preview: cursor line reveals syntax', () => {
  const doc = '# Title\n\nSome **bold** and *it* and `code`.\n\nlast';

  it('hides heading, emphasis and code marks when the cursor is elsewhere', () => {
    expect(hidden(doc, END(doc))).toEqual(['# ', '**', '**', '*', '*', '`', '`']);
  });
  it('reveals the heading line under the cursor only', () => {
    expect(hidden(doc, 3)).toEqual(['**', '**', '*', '*', '`', '`']);
  });
  it('reveals the paragraph line under the cursor only', () => {
    const para = doc.indexOf('Some');
    expect(hidden(doc, para)).toEqual(['# ']);
  });
  it('a multi-line selection reveals every line it touches', () => {
    expect(hidden(doc, [0, doc.indexOf('Some') + 2])).toEqual([]);
  });
  it('styles headings by level regardless of cursor', () => {
    const lines = computeLivePreview(stateAt('## Sub\n', 0)).filter((s) => s.type === 'line');
    expect(lines).toEqual([{ type: 'line', pos: 0, cls: 'cm-lp-h cm-lp-h2' }]);
  });
});

describe('links and images', () => {
  it('hides the URL part of a link and keeps the text, with a safe href', () => {
    const doc = 'see [lumi](https://example.com "t") here\n\nx';
    expect(hidden(doc, END(doc))).toEqual(['[', '](https://example.com "t")']);
    const mark = computeLivePreview(stateAt(doc, END(doc))).find((s) => s.type === 'mark' && s.cls === 'cm-lp-link');
    expect(mark).toMatchObject({ href: 'https://example.com/' });
  });
  it('javascript: links are styled but not clickable', () => {
    const doc = '[x](javascript:alert(1))\n\ny';
    const mark = computeLivePreview(stateAt(doc, END(doc))).find((s) => s.type === 'mark' && s.cls === 'cm-lp-link');
    expect(mark).toMatchObject({ href: null });
  });
  it('replaces an image with a widget off the cursor line', () => {
    const doc = '![alt](https://x.test/a.png)\n\ny';
    const w = computeLivePreview(stateAt(doc, END(doc))).find((s) => s.type === 'widget');
    expect(w).toMatchObject({ from: 0, to: doc.indexOf('\n'), widget: { kind: 'image', src: 'https://x.test/a.png', alt: 'alt' } });
    expect(hidden(doc, 0)).toEqual([]);
  });
});

describe('lists, tasks, quotes, rules, tables', () => {
  it('task items become checkbox widgets (list mark hidden)', () => {
    const doc = '- [ ] todo\n- [x] done\n\nz';
    const specs = computeLivePreview(stateAt(doc, END(doc)));
    const boxes = specs.filter((s) => s.type === 'widget');
    expect(boxes.map((b) => (b as any).widget)).toEqual([
      { kind: 'checkbox', checked: false },
      { kind: 'checkbox', checked: true },
    ]);
    expect(hidden(doc, END(doc))).toEqual(['- ', '[ ]', '- ', '[x]']);
    // Cursor on the first task line: raw syntax there, widget on the other.
    expect(hidden(doc, 2)).toEqual(['- ', '[x]']);
  });
  it('bullets become a bullet widget; ordered markers stay', () => {
    const doc = '- a\n1. b\n\nz';
    const ws = computeLivePreview(stateAt(doc, END(doc))).filter((s) => s.type === 'widget');
    expect(ws).toEqual([{ type: 'widget', from: 0, to: 1, widget: { kind: 'bullet' } }]);
  });
  it('hides quote marks and the hr text off-cursor', () => {
    const doc = '> quoted\n\n---\n\nz';
    expect(hidden(doc, END(doc))).toEqual(['> ', '---']);
    expect(hidden(doc, doc.indexOf('---'))).toEqual(['> ']);
  });
  it('renders a table as one block widget unless the cursor is inside', () => {
    const doc = 'a\n\n| h | i |\n|---|---|\n| 1 | 2 |\n\nz';
    const t = computeLivePreview(stateAt(doc, 0)).find((s) => s.type === 'widget');
    expect(t).toMatchObject({ block: true, widget: { kind: 'table' } });
    expect(doc.slice((t as any).from, (t as any).to)).toBe('| h | i |\n|---|---|\n| 1 | 2 |');
    expect(computeLivePreview(stateAt(doc, doc.indexOf('| 1'))).some((s) => s.type === 'widget')).toBe(false);
  });
  it('code fences are styled, never hidden', () => {
    const doc = '```js\nlet a = `x`;\n```\n\nz';
    expect(hidden(doc, END(doc))).toEqual([]);
    const lines = computeLivePreview(stateAt(doc, END(doc))).filter((s) => s.type === 'line').map((s) => (s as any).cls);
    expect(lines.filter((c) => c === 'cm-lp-codeblock').length).toBe(3);
  });
});

describe('purely visual', () => {
  it('building decorations never changes the document', () => {
    const doc = '# T\n- [ ] a\n![i](https://x.test/i.png)\n| a |\n|---|\n| b |\n';
    const view = new EditorView({ state: EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage }), livePreview()] }), parent: document.body });
    view.dispatch({ selection: { anchor: doc.length } });
    view.dispatch({ selection: { anchor: 0 } });
    expect(view.state.doc.toString()).toBe(doc);
    view.destroy();
  });
});

describe('taskToggleChange (ranged CRDT op)', () => {
  it('replaces only the single inner character', () => {
    const doc = Text.of(['- [ ] a', '- [x] b']);
    expect(taskToggleChange(doc, 2)).toEqual({ from: 3, to: 4, insert: 'x' });
    expect(taskToggleChange(doc, 10)).toEqual({ from: 11, to: 12, insert: ' ' });
  });
  it('refuses positions that are not a task marker', () => {
    const doc = Text.of(['- [ ] a']);
    expect(taskToggleChange(doc, 0)).toBeNull();
    expect(taskToggleChange(doc, 6)).toBeNull();
  });
});

describe('URL safety', () => {
  it('safeHref allows only http(s)/mailto', () => {
    expect(safeHref('https://a.b/c')).toBe('https://a.b/c');
    expect(safeHref('mailto:x@y.z')).toBe('mailto:x@y.z');
    for (const bad of ['javascript:alert(1)', ' JaVaScRiPt:alert(1)', 'java\tscript:alert(1)', 'data:text/html,x', 'vbscript:x', '/rel', 'notes/a.md'])
      expect(safeHref(bad)).toBeNull();
  });
  it('safeImageSrc allows https, relative and raster data: URIs', () => {
    expect(safeImageSrc('img/a.png')).toBe('img/a.png');
    expect(safeImageSrc('https://x/a.png')).toBe('https://x/a.png');
    expect(safeImageSrc('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA');
    for (const bad of ['javascript:x', 'data:text/html,x', 'data:image/svg+xml;base64,x', '//evil/x.png']) expect(safeImageSrc(bad)).toBeNull();
  });
});

describe('checkbox widget → Y.Text', () => {
  it('clicking a checkbox emits a 1-char ranged delta on the Y.Text', async () => {
    const Y = await import('yjs');
    const { yCollab } = await import('y-codemirror.next');
    const ydoc = new Y.Doc();
    const ytext = ydoc.getText('content');
    const body = 'intro\n\n- [ ] first\n- [ ] second\n';
    ytext.insert(0, body);
    const view = new EditorView({
      state: EditorState.create({ doc: body, extensions: [markdown({ base: markdownLanguage }), livePreview(), yCollab(ytext, null)] }),
      parent: document.body,
    });
    ensureSyntaxTree(view.state, view.state.doc.length, 5000);
    view.dispatch({ selection: { anchor: 0 } }); // rebuild with full tree
    const deltas: unknown[] = [];
    ytext.observe((e) => deltas.push(e.delta));
    const boxes = view.dom.querySelectorAll<HTMLInputElement>('input.cm-lp-checkbox');
    expect(boxes.length).toBe(2);
    boxes[1].dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    expect(ytext.toString()).toBe('intro\n\n- [ ] first\n- [x] second\n');
    const at = body.indexOf('- [ ] second') + 3;
    expect(deltas).toEqual([[{ retain: at }, { delete: 1 }, { insert: 'x' }]]);
    view.destroy();
    ydoc.destroy();
  });
});
