// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { ensureSyntaxTree } from '@codemirror/language';

const renderMermaid = vi.fn(async (_src: string) => ({ svg: '<svg id="lumimmd1q" viewBox="0 0 1 1"><text>D</text></svg>', id: 'lumimmd1q' }));
vi.mock('./mermaid-render.ts', () => ({ renderMermaid: (s: string) => renderMermaid(s) }));

import { computeLivePreview, livePreview } from './live-preview.ts';

function stateAt(doc: string, cursor: number): EditorState {
  const st = EditorState.create({ doc, selection: { anchor: cursor }, extensions: [markdown({ base: markdownLanguage })] });
  ensureSyntaxTree(st, st.doc.length, 5000);
  return st;
}

const DOC = 'intro\n\n```mermaid\nflowchart TD\n  A --> B\n```\n\nafter';

describe('live preview: mermaid fences', () => {
  it('draws a closed mermaid fence as one block widget when the cursor is outside', () => {
    const w = computeLivePreview(stateAt(DOC, 0)).find((s) => s.type === 'widget');
    expect(w).toMatchObject({ block: true, widget: { kind: 'mermaid', source: 'flowchart TD\n  A --> B' } });
    expect(DOC.slice((w as any).from, (w as any).to)).toBe('```mermaid\nflowchart TD\n  A --> B\n```');
  });

  it('shows the source when the cursor is on any line of the block', () => {
    for (const at of [DOC.indexOf('```mermaid'), DOC.indexOf('A -->'), DOC.lastIndexOf('```')]) {
      const specs = computeLivePreview(stateAt(DOC, at));
      expect(specs.some((s) => s.type === 'widget')).toBe(false);
      expect(specs.filter((s) => s.type === 'line' && s.cls === 'cm-lp-codeblock').length).toBe(4);
    }
  });

  it('leaves an unclosed or empty fence and other languages as code', () => {
    for (const doc of ['x\n\n```mermaid\nflowchart TD\n  A --> B', 'x\n\n```mermaid\n```\n\ny', 'x\n\n```js\nlet a\n```\n\ny']) {
      expect(computeLivePreview(stateAt(doc, 0)).some((s) => s.type === 'widget')).toBe(false);
    }
  });

  it('mounts a diagram in the editor and edits the source on click', async () => {
    const view = new EditorView({
      state: EditorState.create({ doc: DOC, selection: { anchor: 0 }, extensions: [markdown({ base: markdownLanguage }), livePreview()] }),
      parent: document.body,
    });
    ensureSyntaxTree(view.state, view.state.doc.length, 5000);
    view.dispatch({ selection: { anchor: 1 } });
    const block = view.dom.querySelector<HTMLElement>('.cm-lp-mermaid .md-mermaid');
    expect(block).not.toBeNull();
    expect(block!.dataset.surface).toBe('editor');
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(renderMermaid).toHaveBeenCalledWith('flowchart TD\n  A --> B');
    expect(block!.dataset.state).toBe('done');
    block!.querySelector('.md-mermaid-fig')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    expect(view.state.doc.lineAt(view.state.selection.main.head).text).toBe('flowchart TD');
    expect(view.dom.querySelector('.cm-lp-mermaid')).toBeNull();
    view.destroy();
  });
});
