// The editor's markdown language (lib/markdown-lang.ts) keeps what
// lang-markdown's markdown() gave the editor, without importing
// lang-html eagerly.
import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import { ensureSyntaxTree, foldable, LanguageDescription } from '@codemirror/language';
import { lumiMarkdown, loadHTMLSupport, hasHTML } from './markdown-lang.ts';

function tree(doc: string, ext = lumiMarkdown([])) {
  const st = EditorState.create({ doc, extensions: [ext] });
  return { st, tree: ensureSyntaxTree(st, doc.length, 5000)! };
}

describe('lumiMarkdown', () => {
  it('parses GFM (tables, tasks, strikethrough)', () => {
    const { tree: t } = tree('| a |\n|---|\n| 1 |\n\n- [ ] t\n\n~~s~~\n');
    const names = new Set<string>();
    t.iterate({ enter: (n) => { names.add(n.name); } });
    for (const n of ['Table', 'Task', 'Strikethrough']) expect(names.has(n)).toBe(true);
  });
  it('folds a heading section', () => {
    const { st } = tree('# A\n\ntext\n\n# B\n');
    expect(foldable(st, 0, 3)).toEqual({ from: 3, to: 9 });
  });
  it('nests a fenced code grammar from the language list', async () => {
    const js = LanguageDescription.of({ name: 'JavaScript', alias: ['js'], load: async () => (await import('@codemirror/lang-javascript')).javascript() });
    await js.load();
    const doc = '```js\nlet a = 1;\n```\n';
    const { tree: t } = tree(doc, lumiMarkdown([js]));
    expect(t.resolveInner(doc.indexOf('a ='), 1).name).toBe('VariableDefinition');
  });
  it('parses inline HTML as HTML once the lazy support is given', async () => {
    const h = await loadHTMLSupport();
    const doc = '<div class="x">hi</div>\n';
    const { tree: t } = tree(doc, lumiMarkdown([], h));
    expect(t.resolveInner(doc.indexOf('class'), 1).name).toBe('AttributeName');
    const { tree: plain } = tree(doc);
    expect(plain.resolveInner(doc.indexOf('class'), 1).name).not.toBe('AttributeName');
  });
  it('hasHTML', () => {
    for (const y of ['<div>', 'a <span class="x">', '<!-- c -->', '<br/>']) expect(hasHTML(y)).toBe(true);
    for (const n of ['a < b', '<3', 'x <= y', '`<`']) expect(hasHTML(n)).toBe(false);
  });
});
