import { describe, it, expect } from 'vitest';
import { menuFor, mnemonic } from './context-actions.ts';
import { ShellKeymap } from './shell-keymap.ts';
import type { Entry } from './notetree.ts';

const note = { kind: 'note', key: 'n:a', name: 'a.md', path: 'a.md', note: { id: 'a', title: 'A', path: 'a.md' } } as unknown as Entry;
const folder = { kind: 'folder', key: 'd:work', name: 'work', path: 'work', virtual: false } as unknown as Entry;

function keyName(k: string): string {
  return k === '⏎' ? 'Enter' : k.split(' ')[0];
}

describe('context menu mirrors the keymap', () => {
  for (const [what, entry, reader] of [['note row', note, false], ['folder row', folder, false], ['empty space', null, false], ['reader', note, true]] as const) {
    it(`${what}: every item's key triggers the same shell action`, () => {
      const items = menuFor(entry, { canPaste: true, reader });
      expect(items.length).toBeGreaterThan(2);
      for (const it of items) {
        if (!it.keys || it.action === 'newFolder' || it.action === 'copyLink' || it.action === 'openRight' || it.action === 'openBelow') continue;
        const km = new ShellKeymap();
        const a = km.feed({ key: keyName(it.keys), ctrlKey: false, metaKey: false, altKey: false }, reader ? 'reader' : 'explorer', false);
        expect(a?.kind, `${it.label} (${it.keys})`).toBe(it.action);
      }
    });
  }
  it('offline disables structural actions', () => {
    const items = menuFor(note, { offline: true });
    expect(items.find((i) => i.id === 'rename')?.disabled).toBe(true);
    expect(items.find((i) => i.id === 'delete')?.disabled).toBe(true);
    expect(items.find((i) => i.id === 'edit')?.disabled).toBeFalsy();
  });
  it('mnemonics pick the item by its key, skipping disabled ones', () => {
    const items = menuFor(note, { canPaste: false });
    expect(mnemonic(items, 'r')?.id).toBe('rename');
    expect(mnemonic(items, 'Enter')?.id).toBe('open');
    expect(mnemonic(items, 'p')).toBeNull();
    expect(mnemonic(items, 'z')).toBeNull();
  });
  it('the keymap has the menu and hint keys', () => {
    expect(new ShellKeymap().feed({ key: 'ContextMenu', ctrlKey: false, metaKey: false, altKey: false }, 'explorer', false)?.kind).toBe('menu');
    expect(new ShellKeymap().feed({ key: 'F10', shiftKey: true, ctrlKey: false, metaKey: false, altKey: false }, 'reader', false)?.kind).toBe('menu');
    expect(new ShellKeymap().feed({ key: 'f', ctrlKey: false, metaKey: false, altKey: false }, 'explorer', false)?.kind).toBe('hints');
    expect(new ShellKeymap().feed({ key: 'F', ctrlKey: false, metaKey: false, altKey: false }, 'reader', false)?.kind).toBe('hints');
    // The reader keeps f = page down.
    expect(new ShellKeymap().feed({ key: 'f', ctrlKey: false, metaKey: false, altKey: false }, 'reader', false)?.kind).toBe('page');
  });
});
