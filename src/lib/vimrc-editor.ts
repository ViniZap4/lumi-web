// The .vimrc editor in Settings → Vim: a small CodeMirror instance with
// vimscript-ish highlighting and inline per-line diagnostics from the
// parser (lib/vimrc.ts). Lazy-loaded with the rest of the editor chunk.

import { EditorState, StateEffect, StateField, RangeSetBuilder, type Extension } from '@codemirror/state';
import { EditorView, Decoration, WidgetType, keymap, lineNumbers, type DecorationSet } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { StreamLanguage, syntaxHighlighting, HighlightStyle } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { vim } from '@replit/codemirror-vim';
import type { VimrcDiagnostic } from './vimrc.ts';

const COMMANDS = /^(n|i|v|x)?(nore)?map$|^(n|i|v|x)?unmap$|^(let|set|se|setlocal|setl|syntax|filetype|colorscheme|no|nn|ino|vn|xn|nm|im|vm|xm|unm)$/;

interface VS {
  cmd: string | null;
}

const vimscript = StreamLanguage.define<VS>({
  name: 'vimrc',
  startState: () => ({ cmd: null }),
  token(stream, st) {
    if (stream.sol()) {
      st.cmd = null;
      stream.eatSpace();
      if (stream.peek() === '"') {
        stream.skipToEnd();
        return 'comment';
      }
      stream.eat(':');
    }
    if (stream.eatSpace()) return null;
    if (st.cmd == null) {
      const w = stream.match(/^[A-Za-z!#:]+/);
      if (w) {
        const word = (w as RegExpMatchArray)[0];
        st.cmd = word;
        return COMMANDS.test(word) ? 'keyword' : 'invalid';
      }
    }
    if (stream.match(/^<(?:[A-Za-z]-)*[A-Za-z0-9]+>/)) return 'atom';
    if ((st.cmd === 'set' || st.cmd === 'se' || st.cmd === 'let') && stream.match(/^[a-z:]+/)) return 'propertyName';
    if (stream.match(/^"(?:[^"\\]|\\.)*"/) || stream.match(/^'(?:[^']|'')*'/)) {
      return 'string';
    }
    if (stream.match(/^\d+/)) return 'number';
    if (stream.match(/^\s"[^"]*$/)) return 'comment';
    if (stream.match(/^[=]/)) return 'operator';
    stream.next();
    return null;
  },
});

const vimrcHighlight = HighlightStyle.define([
  { tag: t.comment, color: 'var(--color-text-dim)', fontStyle: 'italic' },
  { tag: t.keyword, color: 'var(--color-secondary)', fontWeight: '600' },
  { tag: t.atom, color: 'var(--color-accent)' },
  { tag: t.string, color: 'var(--color-warning)' },
  { tag: t.number, color: 'var(--color-warning)' },
  { tag: t.propertyName, color: 'var(--color-primary)' },
  { tag: t.invalid, color: 'var(--color-error)', textDecoration: 'underline wavy' },
]);

// ---- inline diagnostics -------------------------------------------------------

const setDiagEffect = StateEffect.define<readonly VimrcDiagnostic[]>();

class DiagWidget extends WidgetType {
  constructor(readonly d: VimrcDiagnostic) {
    super();
  }
  eq(o: DiagWidget): boolean {
    return o.d.message === this.d.message && o.d.severity === this.d.severity;
  }
  toDOM(): HTMLElement {
    const el = document.createElement('span');
    el.className = `cm-vimrc-diag cm-vimrc-${this.d.severity}`;
    el.textContent = this.d.message;
    return el;
  }
}

function buildDiag(state: EditorState, diags: readonly VimrcDiagnostic[]): DecorationSet {
  const b = new RangeSetBuilder<Decoration>();
  const byLine = new Map<number, VimrcDiagnostic>();
  const rank = { error: 3, warning: 2, info: 1 } as const;
  for (const d of diags) {
    const cur = byLine.get(d.line);
    if (!cur || rank[d.severity] > rank[cur.severity]) byLine.set(d.line, d);
  }
  for (const n of [...byLine.keys()].sort((a, c) => a - c)) {
    if (n < 1 || n > state.doc.lines) continue;
    const line = state.doc.line(n);
    const d = byLine.get(n)!;
    b.add(line.from, line.from, Decoration.line({ class: `cm-vimrc-line-${d.severity}` }));
    b.add(line.to, line.to, Decoration.widget({ widget: new DiagWidget(d), side: 1 }));
  }
  return b.finish();
}

const diagField = StateField.define<{ diags: readonly VimrcDiagnostic[]; deco: DecorationSet }>({
  create: (s) => ({ diags: [], deco: buildDiag(s, []) }),
  update(v, tr) {
    for (const e of tr.effects) if (e.is(setDiagEffect)) return { diags: e.value, deco: buildDiag(tr.state, e.value) };
    return tr.docChanged ? { diags: v.diags, deco: v.deco.map(tr.changes) } : v;
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
});

const theme = EditorView.theme({
  '&': {
    fontFamily: 'var(--font-mono)',
    fontSize: '12.5px',
    background: 'color-mix(in srgb, var(--color-overlay-bg) 60%, var(--color-background))',
    color: 'var(--color-text)',
    border: '1px solid var(--hairline)',
    borderRadius: '8px',
    minHeight: '220px',
    maxHeight: '420px',
  },
  '&.cm-focused': { outline: 'none', borderColor: 'var(--color-primary)' },
  '.cm-scroller': { fontFamily: 'inherit', lineHeight: '1.6' },
  '.cm-content': { padding: '8px 0', caretColor: 'var(--color-primary)' },
  '.cm-gutters': { background: 'transparent', border: 'none', color: 'var(--color-text-dim)' },
  '.cm-cursor': { borderLeftColor: 'var(--color-primary)' },
  '.cm-fat-cursor': { background: 'var(--color-primary) !important', color: 'var(--color-background) !important' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: 'var(--color-selected-bg) !important' },
  '.cm-vimrc-diag': { marginLeft: '1.5em', fontSize: '11px', fontStyle: 'italic', opacity: '0.9' },
  '.cm-vimrc-error': { color: 'var(--color-error)' },
  '.cm-vimrc-warning': { color: 'var(--color-warning)' },
  '.cm-vimrc-info': { color: 'var(--color-text-dim)' },
  '.cm-vimrc-line-error': { backgroundColor: 'color-mix(in srgb, var(--color-error) 9%, transparent)' },
  '.cm-vimrc-line-warning': { backgroundColor: 'color-mix(in srgb, var(--color-warning) 7%, transparent)' },
  '.cm-panels': { background: 'transparent', color: 'var(--color-text-dim)', fontSize: '11px', borderTop: '1px solid var(--hairline)' },
});

export interface VimrcEditorHandle {
  view: EditorView;
  setDiagnostics(d: readonly VimrcDiagnostic[]): void;
  setText(text: string): void;
  goToLine(n: number): void;
  destroy(): void;
}

export function createVimrcEditor(
  parent: HTMLElement,
  doc: string,
  opts: { onChange: (text: string) => void; onSave: () => void; vim: boolean },
): VimrcEditorHandle {
  const extensions: Extension[] = [
    opts.vim ? vim({ status: true }) : [],
    lineNumbers(),
    history(),
    keymap.of([
      { key: 'Mod-s', preventDefault: true, run: () => { opts.onSave(); return true; } },
      ...historyKeymap,
      ...defaultKeymap,
    ]),
    vimscript,
    syntaxHighlighting(vimrcHighlight),
    diagField,
    theme,
    EditorView.lineWrapping,
    EditorView.contentAttributes.of({ 'aria-label': '.vimrc', spellcheck: 'false', autocapitalize: 'off', autocorrect: 'off' }),
    EditorView.updateListener.of((u) => {
      if (u.docChanged) opts.onChange(u.state.doc.toString());
    }),
  ];
  const view = new EditorView({ state: EditorState.create({ doc, extensions }), parent });
  return {
    view,
    setDiagnostics: (d) => view.dispatch({ effects: setDiagEffect.of(d) }),
    setText: (text) => {
      // Whole-text replace is fine here: this is a local settings
      // buffer, not a CRDT-backed note.
      if (text !== view.state.doc.toString()) view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
    },
    goToLine: (n) => {
      const line = view.state.doc.line(Math.max(1, Math.min(view.state.doc.lines, n)));
      view.dispatch({ selection: { anchor: line.from }, scrollIntoView: true });
      view.focus();
    },
    destroy: () => view.destroy(),
  };
}
