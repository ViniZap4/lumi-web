// @vitest-environment jsdom
// Live Preview cost per keystroke (WP0.5, docs/phase3/research/03 §a.2):
// the old whole-document rebuild vs the incremental layers (block
// widgets mapped through the change, inline decorations for the
// viewport, rebuilt only on the dirty lines).
//
// Run: npx vitest bench --run src/bench/live-preview-incremental.bench.ts
// The keystroke variants step a prebuilt transaction, so they measure
// only Live Preview work. "context" is CodeMirror's own incremental
// reparse of a keystroke, paid with or without Live Preview.
import { bench, describe } from 'vitest';
import { EditorState } from '@codemirror/state';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { ensureSyntaxTree } from '@codemirror/language';
import {
  computeLivePreview, specsToDecorations, blockKind, inlineKindFor, freshLayer, stepLayerTr, type Layer,
} from '../lib/live-preview.ts';
import { blockDenseNote, midParagraph } from './corpus.ts';

/** A generous browser viewport: the visible lines plus CodeMirror's
 *  1000 px margin on each side, in this block-dense note. */
const VIEWPORT_BYTES = 6000;

for (const kb of [10, 100, 300]) {
  const doc = blockDenseNote(kb * 1024);
  const at = midParagraph(doc);
  const lang = markdown({ base: markdownLanguage });
  const mk = (ext: unknown[]) => {
    const st = EditorState.create({ doc, selection: { anchor: at }, extensions: [lang, ...(ext as never[])] });
    ensureSyntaxTree(st, st.doc.length, 10_000);
    // Pull the finished tree into the state (ensureSyntaxTree advances
    // the parse context; the next transaction picks it up).
    return st.update({}).state;
  };
  const plain = mk([]);
  const viewport = (): [number, number] => [Math.max(0, at - VIEWPORT_BYTES / 2), at + VIEWPORT_BYTES / 2];
  const inline = inlineKindFor(viewport);

  // One keystroke (insert at the cursor), built once: both variants do
  // only the Live Preview work for it, so the parse is excluded.
  const tr = plain.update({ changes: { from: at, insert: 'x' }, selection: { anchor: at + 1 } });
  const blk0: Layer = freshLayer(blockKind, plain);
  const inl0: Layer = freshLayer(inline, plain);
  let typed = plain;

  describe(`live preview keystroke, ${kb} KB block-dense`, () => {
    bench('before: full rebuild (computeLivePreview + specsToDecorations)', () => {
      specsToDecorations(computeLivePreview(tr.state));
    });
    bench('after: block layer + viewport inline layer, stepped through the change', () => {
      stepLayerTr(blockKind, blk0, tr);
      stepLayerTr(inline, inl0, tr);
    });
    bench('context: CodeMirror reparse of one keystroke (paid with or without Live Preview)', () => {
      const pos = typed.selection.main.head;
      typed = typed.update({ changes: { from: pos, insert: 'x' }, selection: { anchor: pos + 1 } }).state;
    });
  });

  describe(`live preview cursor to another line, ${kb} KB block-dense`, () => {
    let st = plain;
    let layer: Layer = freshLayer(inline, st);
    let bl: Layer = freshLayer(blockKind, st);
    const lineA = st.doc.lineAt(at);
    const lineB = st.doc.line(lineA.number + 4);
    let k = 0;
    bench('before: full rebuild', () => {
      const tr = st.update({ selection: { anchor: (k++ % 2) ? lineA.from : lineB.from } });
      specsToDecorations(computeLivePreview(tr.state));
    });
    bench('after: incremental layers', () => {
      const tr = st.update({ selection: { anchor: (k++ % 2) ? lineA.from : lineB.from } });
      bl = stepLayerTr(blockKind, bl, tr);
      layer = stepLayerTr(inline, layer, tr);
      st = tr.state;
    });
  });
}
