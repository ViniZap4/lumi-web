// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import * as Y from 'yjs';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { yCollab } from 'y-codemirror.next';
import {
  remoteRanges,
  mergeRanges,
  remoteFlash,
  flashRemote,
  flashRanges,
  observeRemoteEdits,
  REMOTE_FLASH_MS,
  REMOTE_FLASH_STATIC_MS,
  REMOTE_FLASH_MAX,
} from './remote-flash.ts';

afterEach(() => vi.useRealTimers());

describe('remoteRanges (Y.Text delta → doc ranges)', () => {
  it('insert at the start, middle and end', () => {
    expect(remoteRanges([{ insert: 'ab' }])).toEqual([{ from: 0, to: 2 }]);
    expect(remoteRanges([{ retain: 5 }, { insert: 'xyz' }])).toEqual([{ from: 5, to: 8 }]);
    expect(remoteRanges([{ retain: 10 }, { insert: '!' }])).toEqual([{ from: 10, to: 11 }]);
  });
  it('deletes leave a zero-width marker at their position', () => {
    expect(remoteRanges([{ retain: 3 }, { delete: 4 }])).toEqual([{ from: 3, to: 3 }]);
  });
  it('retains offset later ops; inserted text advances the position', () => {
    expect(remoteRanges([{ retain: 2 }, { insert: 'ab' }, { retain: 3 }, { insert: 'c' }])).toEqual([
      { from: 2, to: 4 },
      { from: 7, to: 8 },
    ]);
  });
  it('a replace (delete + insert) merges into one range; embeds count as 1', () => {
    expect(remoteRanges([{ retain: 1 }, { delete: 2 }, { insert: 'xy' }])).toEqual([{ from: 1, to: 3 }]);
    expect(remoteRanges([{ insert: { image: 'x' } }])).toEqual([{ from: 0, to: 1 }]);
  });
  it('mergeRanges sorts and joins touching ranges', () => {
    expect(mergeRanges([{ from: 5, to: 6 }, { from: 0, to: 2 }, { from: 2, to: 3 }, { from: 6, to: 6 }])).toEqual([
      { from: 0, to: 3 },
      { from: 5, to: 6 },
    ]);
  });
});

function plainView(doc: string): EditorView {
  return new EditorView({ state: EditorState.create({ doc, extensions: [remoteFlash()] }), parent: document.body });
}

describe('remoteFlash field', () => {
  it('maps ranges through later local edits, then clears after the fade', () => {
    vi.useFakeTimers();
    const v = plainView('hello world');
    flashRemote(v, [{ from: 6, to: 11 }, { from: 2, to: 2 }], false);
    expect(flashRanges(v)).toEqual([{ from: 2, to: 2 }, { from: 6, to: 11 }]);
    expect(v.dom.querySelector('.cm-remote-flash')?.textContent).toBe('world');
    expect(v.dom.querySelector('.cm-remote-flash-del')).not.toBeNull();
    // Typing before the range shifts it.
    v.dispatch({ changes: { from: 0, insert: '>> ' } });
    expect(flashRanges(v)).toEqual([{ from: 5, to: 5 }, { from: 9, to: 14 }]);
    vi.advanceTimersByTime(REMOTE_FLASH_MS - 1);
    expect(flashRanges(v)).toHaveLength(2);
    vi.advanceTimersByTime(2);
    expect(flashRanges(v)).toEqual([]);
    v.destroy();
  });
  it('overlapping flashes clear independently; reduced motion is shorter', () => {
    vi.useFakeTimers();
    const v = plainView('abcdefghij');
    flashRemote(v, [{ from: 0, to: 2 }], true);
    vi.advanceTimersByTime(100);
    flashRemote(v, [{ from: 5, to: 7 }], false);
    vi.advanceTimersByTime(REMOTE_FLASH_STATIC_MS - 100);
    expect(flashRanges(v)).toEqual([{ from: 5, to: 7 }]);
    vi.advanceTimersByTime(REMOTE_FLASH_MS);
    expect(flashRanges(v)).toEqual([]);
    v.destroy();
  });
  it('ranges past the end are clipped', () => {
    const v = plainView('abc');
    flashRemote(v, [{ from: 1, to: 99 }], false);
    expect(flashRanges(v)).toEqual([{ from: 1, to: 3 }]);
    v.destroy();
  });
});

describe('remote-only flashing with a real Y.Doc pair', () => {
  function pair() {
    const a = new Y.Doc();
    const b = new Y.Doc();
    a.getText('t').insert(0, 'hello world');
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    // Relay b → a as a remote peer would (applyUpdate = tr.local false).
    b.on('update', (u: Uint8Array, origin: unknown) => { if (origin !== 'relay') Y.applyUpdate(a, u, 'relay'); });
    const ytext = a.getText('t');
    const view = new EditorView({
      state: EditorState.create({ doc: ytext.toString(), extensions: [yCollab(ytext, null), remoteFlash()] }),
      parent: document.body,
    });
    const onremote = vi.fn();
    const stop = observeRemoteEdits(ytext, view, onremote);
    return { a, b, ytext, view, onremote, stop };
  }

  it('a remote insert flashes exactly the inserted text in the CodeMirror doc', () => {
    const { b, view, onremote, stop } = pair();
    b.getText('t').insert(6, 'big ');
    expect(view.state.doc.toString()).toBe('hello big world');
    expect(flashRanges(view)).toEqual([{ from: 6, to: 10 }]);
    expect(onremote).toHaveBeenCalledTimes(1);
    stop();
    view.destroy();
  });

  it('a remote delete leaves a marker; local typing never flashes', () => {
    const { b, ytext, view, onremote, stop } = pair();
    b.getText('t').delete(0, 6);
    expect(view.state.doc.toString()).toBe('world');
    expect(flashRanges(view)).toEqual([{ from: 0, to: 0 }]);
    // Local: through CodeMirror (y-codemirror's origin) and directly.
    view.dispatch({ changes: { from: 5, insert: '!' } });
    ytext.insert(0, '>');
    expect(flashRanges(view).filter((r) => r.to > r.from)).toEqual([]);
    expect(onremote).toHaveBeenCalledTimes(1);
    stop();
    b.getText('t').insert(0, 'x');
    expect(onremote).toHaveBeenCalledTimes(1); // unobserved
    view.destroy();
  });

  it('bulk remote loads do not flash (but still count as activity)', () => {
    const { b, view, onremote, stop } = pair();
    b.getText('t').insert(0, 'x'.repeat(REMOTE_FLASH_MAX + 1));
    expect(flashRanges(view)).toEqual([]);
    expect(onremote).toHaveBeenCalledTimes(1);
    stop();
    view.destroy();
  });
});
