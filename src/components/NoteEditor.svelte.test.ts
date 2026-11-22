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
