// @vitest-environment jsdom
//
// Collaborative undo in the note editor: real CodeMirror + replit vim +
// y-codemirror.next over EditorSessions joined to a fake y-websocket
// server (a second session = a remote collaborator).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EditorView, keymap } from '@codemirror/view';
import { EditorState, Prec } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { vim, Vim, getCM } from '@replit/codemirror-vim';
import { yCollab } from 'y-codemirror.next';
import { EditorSession } from './editor-session.svelte.ts';
import { editorKeymap } from './editor-keys.ts';
import { installVimUndo, yUndoExtension, yUndoKeymap, yUndo, yRedo, VIM_CAPTURE_TIMEOUT } from './editor-undo.ts';
import { completionStatus } from '@codemirror/autocomplete';
import { insertLink, linkHelper, pasteLinkHandler } from './link-helper.ts';
import { taskToggleChange } from './live-preview.ts';
import { yLiveText } from './live-text-y.ts';
import { fakeServer, fakeProviderFactory } from '../test/fake-provider.ts';

// jsdom has no layout; CodeMirror measures through these.
(Range.prototype as any).getClientRects = () => [];
(Range.prototype as any).getBoundingClientRect = () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 });

const USER = { id: 'u1', username: 'ana', display_name: 'Ana' };
const PEER = { id: 'u2', username: 'bia', display_name: 'Bia' };
const ROOM = 'n1/sync';

const sessions: EditorSession[] = [];
const views: EditorView[] = [];

async function join(user = USER): Promise<EditorSession> {
  const s = new EditorSession('v1', 'n1', 'tk', user, {
    serverUrl: 'https://lumi.test',
    providerFactory: fakeProviderFactory(),
    probeAuth: async () => 'ok',
  });
  sessions.push(s);
  await s.whenSynced();
  return s;
}

/** The NoteEditor's undo-relevant stack. */
function mount(s: EditorSession, o: { vim?: boolean; links?: boolean } = {}): EditorView {
  const useVim = o.vim ?? true;
  installVimUndo();
  const view = new EditorView({
    state: EditorState.create({
      doc: s.ytext.toString(),
      extensions: [
        useVim ? vim({ status: false }) : [],
        keymap.of([...yUndoKeymap(useVim), ...editorKeymap(defaultKeymap, useVim)]),
        yUndoExtension(s.undoManager),
        yCollab(s.ytext, s.provider.awareness, { undoManager: false }),
        o.links ? linkHelper({ notes: () => [], fromPath: () => 'n.md', selfID: () => 'n1' }) : pasteLinkHandler(),
      ],
    }),
    parent: document.body,
  });
  views.push(view);
  return view;
}

function cmOf(v: EditorView) {
  return getCM(v)!;
}
function keys(v: EditorView, seq: string): void {
  const cm = cmOf(v);
  for (const k of seq.match(/<[^>]+>|./g) ?? []) Vim.handleKey(cm, k, 'user');
}
function ex(v: EditorView, cmd: string): void {
  Vim.handleEx(cmOf(v) as never, cmd);
}
/** Typing as CodeMirror's input handler dispatches it. */
function type(v: EditorView, text: string): void {
  for (const ch of text) {
    const at = v.state.selection.main.head;
    v.dispatch({ changes: { from: at, insert: ch }, selection: { anchor: at + 1 }, userEvent: 'input.type' });
  }
}
function backspace(v: EditorView, n = 1): void {
  for (let i = 0; i < n; i++) {
    const at = v.state.selection.main.head;
    v.dispatch({ changes: { from: at - 1, to: at }, selection: { anchor: at - 1 }, userEvent: 'delete.backward' });
  }
}
/** Let the UndoManager's capture clock run out (a "pause"). */
function pause(s: EditorSession, ms = 10_000): void {
  const um = s.undoManager as unknown as { lastChange: number };
  if (um.lastChange > 0) um.lastChange -= ms;
}
function key(v: EditorView, k: string, mods: { ctrl?: boolean; shift?: boolean } = {}): boolean {
  const ev = new KeyboardEvent('keydown', { key: k, ctrlKey: !!mods.ctrl, shiftKey: !!mods.shift, bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'keyCode', { value: k.toUpperCase().charCodeAt(0) });
  v.contentDOM.dispatchEvent(ev);
  return ev.defaultPrevented;
}
/** Put the cursor at an offset (jsdom has no layout for j/k). */
function at(v: EditorView, pos: number): void {
  v.dispatch({ selection: { anchor: pos } });
}
const text = (v: EditorView) => v.state.doc.toString();
const head = (v: EditorView) => v.state.selection.main.head;

beforeEach(() => fakeServer.reset());
afterEach(() => {
  for (const v of views.splice(0)) v.destroy();
  for (const s of sessions.splice(0)) s.destroy();
  fakeServer.reset();
});

describe('vim u / Ctrl-r drive the Y.UndoManager', () => {
  it('u undoes dd, Ctrl-r redoes it; Y.Text and the view agree', async () => {
    fakeServer.seed(ROOM, 'one\ntwo\nthree\n');
    const s = await join();
    const v = mount(s);
    at(v, 4);
    keys(v, 'dd');
    expect(s.ytext.toString()).toBe('one\nthree\n');
    keys(v, 'u');
    expect(s.ytext.toString()).toBe('one\ntwo\nthree\n');
    expect(text(v)).toBe('one\ntwo\nthree\n');
    expect(head(v)).toBe(4); // vim: cursor at the start of the change
    keys(v, '<C-r>');
    expect(s.ytext.toString()).toBe('one\nthree\n');
    expect(fakeServer.text(ROOM)).toBe('one\nthree\n');
  });

  it(':undo / :redo and counts (2u)', async () => {
    fakeServer.seed(ROOM, 'abcdef');
    const s = await join();
    const v = mount(s);
    keys(v, 'xxx');
    expect(text(v)).toBe('def');
    keys(v, '2u');
    expect(text(v)).toBe('bcdef');
    ex(v, 'redo');
    expect(text(v)).toBe('cdef');
    ex(v, 'undo');
    expect(text(v)).toBe('bcdef');
  });

  it('u with nothing to undo is a harmless no-op', async () => {
    fakeServer.seed(ROOM, 'abc');
    const s = await join();
    const v = mount(s);
    keys(v, 'u<C-r>');
    expect(text(v)).toBe('abc');
  });
});

describe('vim undo units', () => {
  it('one insert session is one unit, pauses included', async () => {
    fakeServer.seed(ROOM, 'x\n');
    const s = await join();
    const v = mount(s);
    keys(v, 'A');
    type(v, 'hello');
    pause(s);
    type(v, ' world');
    pause(s);
    backspace(v, 2);
    keys(v, '<Esc>');
    expect(text(v)).toBe('xhello wor\n');
    keys(v, 'u');
    expect(text(v)).toBe('x\n');
    expect(s.undoManager.undoStack.length).toBe(0);
  });

  it('ciw + typed text undo together; the next insert session is separate', async () => {
    fakeServer.seed(ROOM, 'foo bar baz');
    const s = await join();
    const v = mount(s);
    keys(v, 'wciw');
    type(v, 'QUX');
    keys(v, '<Esc>');
    keys(v, 'o');
    type(v, 'next');
    keys(v, '<Esc>');
    expect(text(v)).toBe('foo QUX baz\nnext');
    keys(v, 'u');
    expect(text(v)).toBe('foo QUX baz');
    keys(v, 'u');
    expect(text(v)).toBe('foo bar baz');
  });

  it('quick consecutive normal commands are separate units', async () => {
    fakeServer.seed(ROOM, 'a\nb\nc\nd\n');
    const s = await join();
    const v = mount(s);
    keys(v, 'ddddp'); // all well within 500 ms
    expect(text(v)).toBe('c\nb\nd\n');
    keys(v, 'u');
    expect(text(v)).toBe('c\nd\n');
    keys(v, 'u');
    expect(text(v)).toBe('b\nc\nd\n');
    keys(v, 'u');
    expect(text(v)).toBe('a\nb\nc\nd\n');
  });

  it(':s///g with many matches, 3>> and . are one unit each', async () => {
    fakeServer.seed(ROOM, 'a a a\na a\na\nz\n');
    const s = await join();
    const v = mount(s);
    ex(v, '%s/a/b/g');
    expect(text(v)).toBe('b b b\nb b\nb\nz\n');
    at(v, 0);
    keys(v, '3>>');
    expect(text(v)).toBe('  b b b\n  b b\n  b\nz\n');
    at(v, text(v).indexOf('z'));
    keys(v, '.');
    expect(text(v)).toBe('  b b b\n  b b\n  b\n  z\n');
    keys(v, 'u');
    expect(text(v)).toBe('  b b b\n  b b\n  b\nz\n');
    keys(v, 'u');
    expect(text(v)).toBe('b b b\nb b\nb\nz\n');
    keys(v, 'u');
    expect(text(v)).toBe('a a a\na a\na\nz\n');
  });

  it('a repeated insert (3ihi<Esc>) and its . repeat are one unit each', async () => {
    fakeServer.seed(ROOM, '\n');
    const s = await join();
    const v = mount(s);
    keys(v, '3i');
    type(v, 'hi');
    keys(v, '<Esc>');
    expect(text(v)).toBe('hihihi\n');
    keys(v, '.');
    // `.` repeats the 3-fold insert before the cursor (last `i`).
    expect(text(v)).toBe('hihihhihihii\n');
    keys(v, 'u');
    expect(text(v)).toBe('hihihi\n');
    keys(v, 'u');
    expect(text(v)).toBe('\n');
  });

  it('redo is cleared by a new edit', async () => {
    fakeServer.seed(ROOM, 'abc');
    const s = await join();
    const v = mount(s);
    keys(v, 'x');
    keys(v, 'u');
    expect(s.undoManager.redoStack.length).toBe(1);
    keys(v, '$x');
    expect(s.undoManager.redoStack.length).toBe(0);
    keys(v, '<C-r>');
    expect(text(v)).toBe('ab');
  });
});

describe('remote edits', () => {
  it('undo reverts only our own change and keeps the peer’s text and positions', async () => {
    fakeServer.seed(ROOM, 'line one\nline two\n');
    const a = await join();
    const b = await join(PEER);
    const v = mount(a);
    at(v, 9);
    keys(v, 'A');
    type(v, ' (mine)');
    // The peer edits before and inside our session's line meanwhile.
    b.ytext.insert(0, 'PEER ');
    b.ytext.insert(b.ytext.toString().indexOf('two'), 'X');
    type(v, '!');
    keys(v, '<Esc>');
    expect(a.ytext.toString()).toBe('PEER line one\nline Xtwo (mine)!\n');
    keys(v, 'u');
    expect(a.ytext.toString()).toBe('PEER line one\nline Xtwo\n');
    expect(b.ytext.toString()).toBe('PEER line one\nline Xtwo\n');
    expect(text(v)).toBe(a.ytext.toString());
    // Cursor at the start of the reverted span (end of line 2).
    expect(head(v)).toBe('PEER line one\nline Xtwo'.length - 1);
    keys(v, '<C-r>');
    expect(b.ytext.toString()).toBe('PEER line one\nline Xtwo (mine)!\n');
  });

  it('a peer typing concurrently does not split our insert session', async () => {
    fakeServer.seed(ROOM, '\n');
    const a = await join();
    const b = await join(PEER);
    const v = mount(a);
    keys(v, 'i');
    type(v, 'ab');
    b.ytext.insert(b.ytext.length, 'peer');
    type(v, 'cd');
    keys(v, '<Esc>');
    keys(v, 'u');
    expect(a.ytext.toString()).toBe('\npeer');
    expect(a.undoManager.undoStack.length).toBe(0);
  });

  it('remote changes are never on the undo stack', async () => {
    fakeServer.seed(ROOM, 'x');
    const a = await join();
    const b = await join(PEER);
    mount(a);
    b.ytext.insert(1, 'yz');
    expect(a.ytext.toString()).toBe('xyz');
    expect(a.undoManager.undoStack.length).toBe(0);
  });
});

describe('non-vim edits in a vim editor', () => {
  it('a Live Preview checkbox toggle is its own unit', async () => {
    fakeServer.seed(ROOM, '- [ ] task\nabc\n');
    const s = await join();
    const v = mount(s);
    at(v, 11);
    keys(v, 'x'); // normal command
    const change = taskToggleChange(v.state.doc, 2)!;
    v.dispatch({ changes: change, userEvent: 'input.toggle-task' });
    keys(v, 'x'); // another command right after
    expect(text(v)).toBe('- [x] task\nc\n');
    keys(v, 'u');
    expect(text(v)).toBe('- [x] task\nbc\n');
    keys(v, 'u');
    expect(text(v)).toBe('- [ ] task\nbc\n');
    keys(v, 'u');
    expect(text(v)).toBe('- [ ] task\nabc\n');
  });

  it('paste-a-URL-over-a-selection undoes back to the selected text', async () => {
    fakeServer.seed(ROOM, 'see docs here');
    const s = await join();
    const v = mount(s, { vim: false });
    v.dispatch({ selection: { anchor: 4, head: 8 } });
    const ev = new Event('paste', { bubbles: true, cancelable: true }) as Event & { clipboardData: unknown };
    Object.defineProperty(ev, 'clipboardData', { value: { getData: () => 'https://example.com' } });
    v.contentDOM.dispatchEvent(ev);
    expect(text(v)).toBe('see [docs](https://example.com) here');
    yUndo(v);
    expect(text(v)).toBe('see docs here');
    expect([v.state.selection.main.from, v.state.selection.main.to]).toEqual([4, 8]);
  });

  it('a ⌘K link insertion is its own unit (vim off)', async () => {
    fakeServer.seed(ROOM, 'ab');
    const s = await join();
    const v = mount(s, { vim: false });
    v.dispatch({ selection: { anchor: 2 } });
    type(v, 'c');
    insertLink(v, {});
    expect(text(v)).toBe('abc[[');
    yUndo(v);
    expect(text(v)).toBe('abc');
    yUndo(v);
    expect(text(v)).toBe('ab');
  });
});

describe('vim off: CodeMirror-like grouping and keys', () => {
  it('typing groups by time; typing vs deleting are separate; selection restored', async () => {
    fakeServer.seed(ROOM, 'start ');
    const s = await join();
    const v = mount(s, { vim: false });
    expect(s.undoManager.captureTimeout).not.toBe(VIM_CAPTURE_TIMEOUT);
    v.dispatch({ selection: { anchor: 6 } });
    type(v, 'one');
    pause(s);
    type(v, ' two');
    backspace(v, 2);
    expect(s.undoManager.undoStack.length).toBe(3);
    expect(text(v)).toBe('start one t');
    expect(key(v, 'z', { ctrl: true })).toBe(true); // Mod-z (non-mac)
    expect(text(v)).toBe('start one two');
    key(v, 'z', { ctrl: true });
    expect(text(v)).toBe('start one');
    expect(head(v)).toBe(9);
    key(v, 'z', { ctrl: true });
    expect(text(v)).toBe('start ');
    expect(head(v)).toBe(6);
    key(v, 'Z', { ctrl: true, shift: true });
    expect(text(v)).toBe('start one');
    expect(head(v)).toBe(9); // redo: after the change
    key(v, 'y', { ctrl: true });
    expect(text(v)).toBe('start one two');
  });

  it('beforeinput historyUndo (Edit menu) undoes through Yjs', async () => {
    fakeServer.seed(ROOM, '');
    const s = await join();
    const v = mount(s, { vim: false });
    type(v, 'abc');
    const ev = new InputEvent('beforeinput', { inputType: 'historyUndo', bubbles: true, cancelable: true });
    v.contentDOM.dispatchEvent(ev);
    expect(text(v)).toBe('');
    expect(ev.defaultPrevented).toBe(true);
  });
});

describe('<Esc>u right after typing', () => {
  it('Esc leaves INSERT even while a link-picker query is pending, so u undoes', async () => {
    fakeServer.seed(ROOM, 'abc');
    const s = await join();
    const v = mount(s, { links: true });
    keys(v, 'A');
    type(v, 'def');
    expect(completionStatus(v.state)).toBe('pending'); // activateOnTyping
    key(v, 'Escape');
    expect(cmOf(v).state.vim!.insertMode).toBe(false);
    expect(completionStatus(v.state)).toBe(null);
    key(v, 'u');
    expect(text(v)).toBe('abc');
  });
});

describe('vim on: ⌘Z / ⇧⌘Z', () => {
  it('work in normal and insert mode', async () => {
    fakeServer.seed(ROOM, 'abc\n');
    const s = await join();
    const v = mount(s);
    keys(v, 'x');
    expect(key(v, 'z', { ctrl: true })).toBe(true);
    expect(text(v)).toBe('abc\n');
    expect(key(v, 'Z', { ctrl: true, shift: true })).toBe(true);
    expect(text(v)).toBe('bc\n');
    keys(v, 'A');
    type(v, 'XY');
    key(v, 'z', { ctrl: true }); // mid-insert: the session so far
    expect(text(v)).toBe('bc\n');
    type(v, 'Z');
    keys(v, '<Esc>');
    expect(text(v)).toBe('bcZ\n');
    keys(v, 'u');
    expect(text(v)).toBe('bc\n');
  });
});

describe('split panes on one session', () => {
  it('share one stack; each pane’s units stay whole', async () => {
    fakeServer.seed(ROOM, 'top\n');
    const s = await join();
    const p1 = mount(s);
    const p2 = mount(s);
    keys(p1, 'A');
    type(p1, '1');
    keys(p2, 'A');
    type(p2, '2');
    type(p1, '1');
    keys(p1, '<Esc>');
    keys(p2, '<Esc>');
    // p2 inserted at p1's cursor, which stays before it.
    expect(s.ytext.toString()).toBe('top112\n');
    expect(text(p1)).toBe(text(p2));
    keys(p2, 'u'); // last unit: p1's resumed typing
    expect(s.ytext.toString()).toBe('top12\n');
    keys(p2, 'u');
    expect(s.ytext.toString()).toBe('top1\n');
    keys(p1, 'u');
    expect(s.ytext.toString()).toBe('top\n');
    expect(text(p1)).toBe('top\n');
    expect(text(p2)).toBe('top\n');
  });

  it('closing one pane keeps undo working in the other', async () => {
    fakeServer.seed(ROOM, 'abc');
    const s = await join();
    const p1 = mount(s);
    const p2 = mount(s);
    keys(p1, 'x');
    p1.destroy();
    keys(p2, 'u');
    expect(text(p2)).toBe('abc');
  });
});

describe('structured views (board/canvas) on the session stack', () => {
  it('each apply is one unit even in quick succession; editor units stay apart', async () => {
    fakeServer.seed(ROOM, 'abc');
    const s = await join();
    const v = mount(s);
    const live = yLiveText(s.ytext, { undoManager: s.undoManager });
    keys(v, 'A');
    type(v, 'd');
    live.apply([{ from: 0, to: 0, insert: '1' }]);
    live.apply([{ from: 0, to: 0, insert: '2' }]);
    type(v, 'e');
    keys(v, '<Esc>');
    expect(s.ytext.toString()).toBe('21abcde');
    keys(v, 'u');
    expect(s.ytext.toString()).toBe('21abcd');
    live.undo!();
    expect(s.ytext.toString()).toBe('1abcd');
    live.undo!();
    expect(s.ytext.toString()).toBe('abcd');
    keys(v, 'u');
    expect(s.ytext.toString()).toBe('abc');
  });
});

describe('session lifecycle', () => {
  it('a new session (note switch / offline restore) starts with an empty stack', async () => {
    fakeServer.seed(ROOM, 'abc');
    const s1 = await join();
    const v1 = mount(s1);
    keys(v1, 'x');
    v1.destroy();
    s1.destroy();
    const s2 = await join();
    const v2 = mount(s2);
    keys(v2, 'u');
    expect(text(v2)).toBe('bc');
  });

  it('untagged writes (null origin) are not undoable', async () => {
    fakeServer.seed(ROOM, 'abc');
    const s = await join();
    const v = mount(s);
    s.ydoc.transact(() => s.ytext.insert(0, '!'));
    keys(v, 'u');
    expect(text(v)).toBe('!abc');
  });

  it('the stack survives a reconnect', async () => {
    fakeServer.seed(ROOM, 'abc');
    const s = await join();
    const v = mount(s);
    keys(v, 'x');
    const p = s.provider as unknown as { disconnect(): void; reconnect(): void };
    p.disconnect();
    keys(v, 'x'); // offline edit
    p.reconnect();
    await s.whenSynced();
    await new Promise((r) => setTimeout(r, 0));
    keys(v, 'u');
    expect(text(v)).toBe('bc');
    keys(v, 'u');
    expect(text(v)).toBe('abc');
  });
});

describe('editors without a Y.UndoManager', () => {
  it('vim u still uses CodeMirror history (vimrc editor)', () => {
    installVimUndo();
    const v = new EditorView({
      state: EditorState.create({ doc: 'abc', extensions: [vim(), history(), Prec.low(keymap.of(historyKeymap))] }),
      parent: document.body,
    });
    views.push(v);
    keys(v, 'x');
    expect(text(v)).toBe('bc');
    keys(v, 'u');
    expect(text(v)).toBe('abc');
    expect(yRedo(v)).toBe(false);
  });
});

