// @vitest-environment jsdom
//
// Undo through the real NoteEditor (its extension order, keymaps, vim
// plugin, link helper) over a real EditorSession on the fake server.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import NoteEditor from './NoteEditor.svelte';
import { EditorSession } from '../lib/editor-session.svelte.ts';
import { defaultSettings, type EditorSettings } from '../lib/editor-settings.ts';
import { fakeServer, fakeProviderFactory } from '../test/fake-provider.ts';
import type { EditorView } from '@codemirror/view';

const R = Range.prototype as unknown as Record<string, unknown>;
R.getClientRects ??= () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] });
R.getBoundingClientRect ??= () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 });

const ROOM = 'n1/sync';
const cleanup: Array<() => void> = [];

beforeEach(() => fakeServer.reset());
afterEach(() => {
  for (const f of cleanup.splice(0)) f();
  fakeServer.reset();
});

async function setup(body: string, over: Partial<EditorSettings> = {}) {
  const { Vim, getCM } = await import('@replit/codemirror-vim');
  fakeServer.seed(ROOM, body);
  const session = new EditorSession('v1', 'n1', 'tk', { id: 'u1', username: 'ana', display_name: 'Ana' }, {
    serverUrl: 'https://lumi.test',
    providerFactory: fakeProviderFactory(),
    probeAuth: async () => 'ok',
  });
  await session.whenSynced();
  const props = $state({
    session,
    settings: { ...defaultSettings(), vim: true, editMode: 'live', ...over } as EditorSettings,
    notes: () => [{ id: 'n2', title: 'Other note', path: 'other.md' }] as never,
    notePath: () => 'n1.md',
  });
  const target = document.createElement('div');
  document.body.appendChild(target);
  const cmp = mount(NoteEditor, { target, props }) as unknown as { editorView(): EditorView };
  flushSync();
  const view = cmp.editorView();
  cleanup.push(() => {
    unmount(cmp as never);
    target.remove();
    session.destroy();
  });
  const cm = over.vim === false ? null : getCM(view)!;
  const vim = (s: string) => {
    for (const k of s.match(/<[^>]+>|./g) ?? []) Vim.handleKey(cm!, k, 'user');
  };
  /** A real keydown (keymaps + vim plugin, in NoteEditor's order). */
  const key = (k: string, mods: KeyboardEventInit = {}) => {
    const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...mods });
    Object.defineProperty(ev, 'keyCode', { value: k === 'Escape' ? 27 : k.toUpperCase().charCodeAt(0) });
    view.contentDOM.dispatchEvent(ev);
    return ev;
  };
  /** Typing as CodeMirror's input handler dispatches it. */
  const type = (t: string) => {
    for (const ch of t) {
      const at = view.state.selection.main.head;
      view.dispatch({ changes: { from: at, insert: ch }, selection: { anchor: at + 1 }, userEvent: 'input.type' });
    }
  };
  const text = () => view.state.doc.toString();
  const insertMode = () => (getCM(view)!.state.vim as { insertMode: boolean }).insertMode;
  return { session, view, cm, vim, key, type, text, props, insertMode };
}

describe('NoteEditor undo', () => {
  it('vim u / Ctrl-r (real keydown) undo and redo through the session', async () => {
    const t = await setup('one two\n');
    t.vim('<Esc>0dw');
    expect(t.text()).toBe('two\n');
    t.key('u');
    expect(t.text()).toBe('one two\n');
    expect(t.session.ytext.toString()).toBe('one two\n');
    t.key('r', { ctrlKey: true });
    expect(t.text()).toBe('two\n');
    expect(fakeServer.text(ROOM)).toBe('two\n');
  });

  it('<Esc> right after typing leaves INSERT although a link query is pending; u then undoes', async () => {
    const { completionStatus } = await import('@codemirror/autocomplete');
    const t = await setup('abc');
    t.vim('<Esc>A');
    t.type('def');
    expect(completionStatus(t.view.state)).toBe('pending');
    t.key('Escape');
    expect(t.insertMode()).toBe(false);
    t.key('u');
    expect(t.text()).toBe('abc');
  });

  it('Esc still closes a visible link picker first (stays in INSERT)', async () => {
    const { startCompletion, completionStatus } = await import('@codemirror/autocomplete');
    const t = await setup('x ');
    t.vim('<Esc>A');
    t.type('[[');
    startCompletion(t.view);
    await new Promise((r) => setTimeout(r, 150));
    expect(completionStatus(t.view.state)).toBe('active');
    t.key('Escape');
    expect(completionStatus(t.view.state)).toBe(null);
    expect(t.insertMode()).toBe(true);
  });

  it('Ctrl-Z / Ctrl-Shift-Z with vim off, then vim switched on live', async () => {
    const t = await setup('abc', { vim: false });
    t.view.dispatch({ selection: { anchor: 3 } });
    t.type('def');
    expect(t.key('z', { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(t.text()).toBe('abc');
    t.key('Z', { ctrlKey: true, shiftKey: true });
    expect(t.text()).toBe('abcdef');
    t.props.settings = { ...t.props.settings, vim: true };
    flushSync();
    const { Vim, getCM } = await import('@replit/codemirror-vim');
    const cm = getCM(t.view)!;
    for (const k of ['<Esc>', '0', 'x', 'x']) Vim.handleKey(cm, k, 'user');
    expect(t.text()).toBe('cdef');
    t.key('z', { ctrlKey: true });
    expect(t.text()).toBe('bcdef');
    Vim.handleKey(cm, 'u', 'user');
    expect(t.text()).toBe('abcdef');
  });

  it('a Live Preview checkbox click is one undo step of its own', async () => {
    const t = await setup('- [ ] task\nabc\n');
    t.vim('<Esc>');
    t.view.dispatch({ selection: { anchor: 11 } });
    t.vim('x');
    const box = t.view.dom.querySelector('.cm-lp-checkbox') as HTMLElement;
    expect(box).not.toBeNull();
    box.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    t.vim('x');
    expect(t.text()).toBe('- [x] task\nc\n');
    t.vim('u');
    expect(t.text()).toBe('- [x] task\nbc\n');
    t.vim('u');
    expect(t.text()).toBe('- [ ] task\nbc\n');
  });
});
