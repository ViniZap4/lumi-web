// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import * as Y from 'yjs';
import NoteEditor from './NoteEditor.svelte';
import { defaultSettings, type EditorSettings } from '../lib/editor-settings.ts';

function fakeSession(body: string) {
  const ydoc = new Y.Doc();
  const ytext = ydoc.getText('content');
  ytext.insert(0, body);
  return { ydoc, ytext, undoManager: new Y.UndoManager(ytext), provider: null } as any;
}

describe('NoteEditor', () => {
  it('mounts in Live Preview, switches to Source live, never edits the doc', () => {
    const body = '# Title\n\n- [ ] task\n\ntext';
    const session = fakeSession(body);
    const props = $state({ session, settings: { ...defaultSettings() } as EditorSettings });
    const target = document.createElement('div');
    document.body.appendChild(target);
    const cmp = mount(NoteEditor, { target, props });
    flushSync();
    const host = target.querySelector('[data-testid="note-editor"]')!;
    expect(host.getAttribute('data-mode')).toBe('live');
    expect(target.querySelector('.cm-editor')).not.toBeNull();
    expect(target.querySelectorAll('.cm-lp-checkbox').length).toBe(1);

    props.settings = { ...props.settings, editMode: 'source', vim: false, lineNumbers: true };
    flushSync();
    expect(host.getAttribute('data-mode')).toBe('source');
    expect(target.querySelectorAll('.cm-lp-checkbox').length).toBe(0);
    expect(target.querySelector('.cm-lineNumbers')).not.toBeNull();
    expect(session.ytext.toString()).toBe(body);
    unmount(cmp);
    target.remove();
  });
});

describe('NoteEditor — vim visual mode + yank highlight', () => {
  // jsdom has no layout: vertical motions (j/k) measure text ranges.
  const R = Range.prototype as unknown as Record<string, unknown>;
  R.getClientRects ??= () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] });
  R.getBoundingClientRect ??= () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 });
  async function setup(body: string) {
    const { Vim, getCM } = await import('@replit/codemirror-vim');
    const { yankFlashField } = await import('../lib/yank-flash.ts');
    const session = fakeSession(body);
    const props = $state({ session, settings: { ...defaultSettings(), vim: true, editMode: 'source' } as EditorSettings });
    const target = document.createElement('div');
    document.body.appendChild(target);
    const cmp = mount(NoteEditor, { target, props }) as unknown as { editorView(): import('@codemirror/view').EditorView };
    flushSync();
    const view = cmp.editorView();
    const cm = getCM(view)!;
    const keys = (s: string) => { for (const k of s.match(/<[^>]+>|./g) ?? []) Vim.handleKey(cm, k, 'user'); };
    const flashes = () => {
      const out: [number, number][] = [];
      view.state.field(yankFlashField).between(0, view.state.doc.length, (f, t) => { out.push([f, t]); });
      return out;
    };
    const reg = (name = '"') => Vim.getRegisterController().getRegister(name).toString();
    const done = () => { unmount(cmp as never); target.remove(); };
    return { session, view, cm, keys, flashes, reg, done, target };
  }

  it('draws a selection layer (vim hides the native ::selection)', async () => {
    const t = await setup('alpha beta\ngamma delta\n');
    expect(t.target.querySelector('.cm-selectionLayer')).not.toBeNull();
    t.keys('<Esc>vee');
    const sel = t.view.state.selection.main;
    expect(sel.empty).toBe(false);
    expect(t.view.state.sliceDoc(sel.from, sel.to)).toBe('alpha beta');
    t.done();
  });

  it('charwise, linewise and blockwise visual y yank the shown range and flash it', async () => {
    const t = await setup('alpha beta\ngamma delta\nepsilon\n');
    t.keys('<Esc>gg0vey');
    expect(t.reg()).toBe('alpha');
    expect(t.flashes()).toEqual([[0, 5]]);
    t.keys('2GVy');
    expect(t.reg()).toBe('gamma delta\n');
    expect(t.flashes()).toEqual([[11, 23]]);
    t.keys('gg0<C-v>2Gl');
    expect(t.view.state.selection.ranges.length).toBe(2);
    t.keys('y');
    expect(t.reg()).toBe('al\nga');
    expect(t.flashes()).toEqual([[0, 2], [11, 13]]);
    expect(t.session.ytext.toString()).toBe('alpha beta\ngamma delta\nepsilon\n');
    t.done();
  });

  it('normal-mode yanks flash too (yiw, yy, counts, registers); visual d edits with ranged ops', async () => {
    const t = await setup('one two\nthree\nfour\n');
    t.keys('<Esc>gg0wyiw');
    expect(t.reg()).toBe('two');
    expect(t.flashes()).toEqual([[4, 7]]);
    t.keys('gg2yy');
    expect(t.reg()).toBe('one two\nthree\n');
    t.keys('"ayy');
    expect(t.reg('a')).toBe('one two\n');
    expect(t.flashes()).toEqual([[0, 8]]);
    t.keys('2GVd');
    expect(t.session.ytext.toString()).toBe('one two\nfour\n');
    t.done();
  });

  it('`,` in normal mode stays vim\'s repeat-find-backward (settings is :settings there)', async () => {
    const t = await setup('abcabc\n');
    t.keys('<Esc>gg0fc');
    expect(t.view.state.selection.main.head).toBe(2);
    t.keys(';');
    expect(t.view.state.selection.main.head).toBe(5);
    t.keys(',');
    expect(t.view.state.selection.main.head).toBe(2);
    expect(t.session.ytext.toString()).toBe('abcabc\n');
    t.done();
  });
});
