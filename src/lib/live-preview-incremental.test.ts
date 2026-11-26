// @vitest-environment jsdom
// The incremental Live Preview layers (mapped through each change,
// rebuilt only on dirty lines) must always equal a fresh build. A
// seeded random walk of edits and cursor moves over a note with every
// block kind is checked step by step against a from-scratch rebuild.
import { describe, it, expect } from 'vitest';
import { EditorState, RangeSet, type Transaction } from '@codemirror/state';
import { EditorView, type DecorationSet } from '@codemirror/view';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { ensureSyntaxTree } from '@codemirror/language';
import {
  blockKind, inlineKindFor, freshLayer, stepLayerTr, livePreview, specsToDecorations, computeLivePreview, type Layer, type LayerKind,
} from './live-preview.ts';

const BASE = [
  '# Title',
  '',
  'Some **bold** and *it* and `code` and [a link](https://x.test) and [note](a/b.md).',
  'a second line with ~~strike~~ text',
  '',
  '- [ ] task one',
  '- [x] task two',
  '  - nested *item*',
  '1. ordered',
  '',
  '> quoted **text**',
  '> more quote',
  '',
  '| h | i |',
  '|---|---|',
  '| 1 | 2 |',
  '',
  '```js',
  'let a = 1;',
  '```',
  '',
  '```mermaid',
  'flowchart TD',
  '  A --> B',
  '```',
  '',
  '![img](https://x.test/i.png)',
  '',
  '---',
  '',
  'Setext',
  '===',
  '',
  '<div>html</div>',
  '',
  'tail paragraph with \\*escape\\* and <https://auto.test>',
  '',
].join('\n');

const SNIPPETS = ['x', ' ', '\n', '\n\n', '`', '```', '```\n', '~~~', '|', '| a |', '|---|', '- [ ] ', '- ', '> ', '**', '*', '# ', '](u)', '[', '![', '<div>', '<!--', '-->', '---\n', '===', '\\', 'https://y.test '];

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function describeSet(set: DecorationSet): string[] {
  const out: string[] = [];
  for (let c = set.iter(); c.value; c.next()) {
    const spec = c.value.spec as { class?: string; widget?: { constructor: { name: string }; source?: string; checked?: boolean; src?: string } };
    const w = spec.widget;
    out.push(`${c.from}-${c.to}:${spec.class ?? ''}${w ? `<${w.constructor.name}${w.source !== undefined ? ':' + w.source : ''}${w.checked !== undefined ? ':' + w.checked : ''}>` : ''}`);
  }
  return out.sort();
}

function same(a: DecorationSet, b: DecorationSet, from: number, to: number): boolean {
  return RangeSet.eq([a], [b], from, to) && RangeSet.eq([b], [a], from, to);
}

function randomTr(st: EditorState, r: () => number): Transaction {
  const len = st.doc.length;
  const roll = r();
  if (roll < 0.3) {
    // Cursor move, sometimes a multi-line selection.
    const a = Math.floor(r() * (len + 1));
    const b = r() < 0.2 ? Math.min(len, a + Math.floor(r() * 80)) : a;
    return st.update({ selection: { anchor: a, head: b } });
  }
  if (roll < 0.55 && len > 0) {
    const from = Math.floor(r() * len);
    const to = Math.min(len, from + 1 + Math.floor(r() * 6));
    return st.update({ changes: { from, to }, selection: { anchor: from } });
  }
  const at = r() < 0.5 ? st.selection.main.head : Math.floor(r() * (len + 1));
  const ins = SNIPPETS[Math.floor(r() * SNIPPETS.length)];
  return st.update({ changes: { from: at, insert: ins }, selection: { anchor: at + ins.length } });
}

describe('incremental Live Preview layers equal a fresh build', () => {
  for (const seed of Array.from({ length: 40 }, (_, i) => i + 1)) {
    it(`random walk, seed ${seed}`, () => {
      const r = rng(seed);
      let st = EditorState.create({ doc: BASE, selection: { anchor: 0 }, extensions: [markdown({ base: markdownLanguage })] });
      ensureSyntaxTree(st, st.doc.length, 5000);
      st = st.update({}).state;
      // The window covers the whole note here so every decoration is
      // compared; viewport clipping has its own test below.
      // 'inline' covers the whole note so every decoration is compared;
      // 'window' is a viewport that maps through each change, like the
      // editor's, compared inside the window only.
      let current = st;
      let win: [number, number] = [st.doc.line(10).from, st.doc.line(25).to];
      const kinds: [string, LayerKind][] = [
        ['block', blockKind],
        ['inline', inlineKindFor(() => [0, current.doc.length])],
        ['window', inlineKindFor(() => win)],
      ];
      const layers: Layer[] = kinds.map(([, k]) => freshLayer(k, st));
      for (let step = 0; step < 250; step++) {
        const tr = randomTr(st, r);
        current = tr.state;
        win = [tr.changes.mapPos(win[0], -1), tr.changes.mapPos(win[1], 1)];
        for (let k = 0; k < kinds.length; k++) {
          layers[k] = stepLayerTr(kinds[k][1], layers[k], tr);
          const fresh = freshLayer(kinds[k][1], tr.state);
          const [from, to] = kinds[k][0] === 'window'
            ? [tr.state.doc.lineAt(win[0]).from, tr.state.doc.lineAt(Math.min(win[1], tr.state.doc.length)).to]
            : [0, tr.state.doc.length];
          if (!same(layers[k].decos, fresh.decos, from, to)) {
            expect({ step, layer: kinds[k][0], before: tr.startState.doc.toString(), changes: JSON.stringify(tr.changes.toJSON()), got: describeSet(layers[k].decos) })
              .toEqual({ step, layer: kinds[k][0], got: describeSet(fresh.decos) });
          }
        }
        st = tr.state;
      }
    });
  }
});

describe('viewport inline layer', () => {
  it('builds only the window, and the window equals the full build clipped to it', () => {
    const doc = Array.from({ length: 400 }, (_, i) => `line ${i} with **bold** and \`c\``).join('\n');
    let st = EditorState.create({ doc, selection: { anchor: 0 }, extensions: [markdown({ base: markdownLanguage })] });
    ensureSyntaxTree(st, st.doc.length, 5000);
    st = st.update({}).state;
    const from = st.doc.line(100).from;
    const to = st.doc.line(140).to;
    const win = freshLayer(inlineKindFor(() => [from, to]), st);
    const all = specsToDecorations(computeLivePreview(st, undefined, { layer: 'inline' }), st.doc);
    const inWin = describeSet(all).filter((d) => {
      const [f, t] = d.split(':')[0].split('-').map(Number);
      return t >= from && f <= to;
    });
    expect(describeSet(win.decos)).toEqual(inWin);
    expect(describeSet(win.decos).length).toBeLessThan(describeSet(all).length / 5);
  });
});

describe('line-break safety for the plugin layer', () => {
  it('a link hide that crosses a line break is split per line', () => {
    const doc = 'see [text](\nhttps://x.test) here\n\nend';
    let st = EditorState.create({ doc, selection: { anchor: doc.length }, extensions: [markdown({ base: markdownLanguage })] });
    ensureSyntaxTree(st, st.doc.length, 5000);
    st = st.update({}).state;
    const set = specsToDecorations(computeLivePreview(st, undefined, { layer: 'inline' }), st.doc);
    for (let c = set.iter(); c.value; c.next()) {
      if (c.to > c.from) expect(st.doc.lineAt(c.from).number).toBe(st.doc.lineAt(c.to).number);
    }
    const view = new EditorView({ state: EditorState.create({ doc, selection: { anchor: doc.length }, extensions: [markdown({ base: markdownLanguage }), livePreview()] }), parent: document.body });
    view.dispatch({ selection: { anchor: 0 } });
    view.dispatch({ changes: { from: 0, insert: '**b** ' } });
    expect(view.state.doc.toString().startsWith('**b** see')).toBe(true);
    view.destroy();
  });
});

describe('editor integration', () => {
  it('typing keeps checkboxes, tables and marks rendered', () => {
    const view = new EditorView({
      state: EditorState.create({ doc: BASE, selection: { anchor: 0 }, extensions: [markdown({ base: markdownLanguage }), livePreview()] }),
      parent: document.body,
    });
    ensureSyntaxTree(view.state, view.state.doc.length, 5000);
    view.dispatch({ selection: { anchor: 1 } });
    for (const ch of 'abc') view.dispatch({ changes: { from: view.state.selection.main.head, insert: ch }, selection: { anchor: view.state.selection.main.head + 1 } });
    expect(view.dom.querySelectorAll('input.cm-lp-checkbox').length).toBe(2);
    expect(view.dom.querySelector('.cm-lp-table')).not.toBeNull();
    expect(view.dom.querySelector('.cm-lp-strong')).not.toBeNull();
    // Opening a fence above everything turns the rest into code: the
    // table widget must go (structural change past the edited line).
    const at = view.state.doc.line(4).from;
    view.dispatch({ changes: { from: at, insert: '```\n' }, selection: { anchor: at + 4 } });
    expect(view.dom.querySelector('.cm-lp-table')).toBeNull();
    view.destroy();
  });
});
