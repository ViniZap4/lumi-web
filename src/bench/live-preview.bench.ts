// @vitest-environment jsdom
//
// Live Preview (lib/live-preview.ts). Two views of the same cost:
//   - "full rebuild": computeLivePreview + specsToDecorations over the
//     whole document, today's per-transaction work;
//   - "keystroke": one inserted character dispatched to an EditorView
//     carrying markdown + livePreview(), which is the stable contract
//     WP 0.5 optimises (it stays valid when the field becomes a
//     viewport plugin).
// Budget: docs/PERF-BUDGETS.md, keystroke p95 <= 8.3 ms at 20 KB,
// p99 <= 16 ms at 200 KB (whole keystroke path, Live Preview is a part).
import { bench, describe } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import { computeLivePreview, livePreview, specsToDecorations } from '../lib/live-preview.ts';
import { corpus, KB } from './corpus.ts';

const OPTS = { time: 400, warmupTime: 100 };

/** ensureSyntaxTree parses into the language context; an empty
 *  transaction publishes that tree to `syntaxTree(state)`. */
function fullyParsed(state: EditorState): EditorState {
  ensureSyntaxTree(state, state.doc.length, 10_000);
  const next = state.update({}).state;
  if (syntaxTree(next).length !== next.doc.length) throw new Error('bench corpus did not parse fully');
  return next;
}

// `dense` 100 KB matches the research measurement (03 a.2, 13.1 ms).
for (const [kind, size] of [['prose', 20 * KB], ['prose', 100 * KB], ['prose', 200 * KB], ['dense', 100 * KB]] as const) {
  const doc = corpus(kind, size);
  const cursor = doc.indexOf('\n\n', doc.length >> 1) + 2;
  describe(`live preview ${kind} ${size / KB} KB`, () => {
    const state = fullyParsed(EditorState.create({ doc, selection: { anchor: cursor }, extensions: [markdown({ base: markdownLanguage })] }));
    bench('full rebuild (computeLivePreview + specsToDecorations)', () => {
      specsToDecorations(computeLivePreview(state));
    }, OPTS);

    let view: EditorView | null = null;
    let at = cursor;
    bench('keystroke (EditorView dispatch, one char)', () => {
      view!.dispatch({ changes: { from: at, insert: 'x' }, selection: { anchor: at + 1 } });
      at++;
    }, {
      ...OPTS,
      setup: () => {
        view?.destroy();
        const parent = document.createElement('div');
        document.body.appendChild(parent);
        view = new EditorView({
          parent,
          state: EditorState.create({ doc, selection: { anchor: cursor }, extensions: [markdown({ base: markdownLanguage }), livePreview()] }),
        });
        // A browser finishes the parse in idle time; do it up front so
        // every keystroke sees the whole tree, as it would after load.
        ensureSyntaxTree(view.state, view.state.doc.length, 10_000);
        view.dispatch({});
        at = cursor;
      },
      teardown: () => {
        view?.destroy();
        view = null;
      },
    });
  });
}
