// Context-menu actions for the explorer and reader. Each item mirrors
// a shell key (lib/shell-keymap.ts): the menu shows that key and runs
// the very same action, so the mouse path teaches the keyboard path.
// Pure — the view decides what each action does.

import type { Entry } from './notetree.ts';
import type { ShellAction } from './shell-keymap.ts';

export type MenuActionKind = ShellAction['kind'] | 'copyLink' | 'newFolder';

export interface MenuItem {
  id: string;
  label: string;
  /** The key that does the same thing (shown, and a menu mnemonic). */
  keys: string;
  action: MenuActionKind;
  danger?: boolean;
  disabled?: boolean;
  /** Separator above this item. */
  sep?: boolean;
}

export interface MenuContext {
  /** Structural ops (create/rename/delete) need the server. */
  offline?: boolean;
  /** Something was yanked (paste available). */
  canPaste?: boolean;
  /** The menu is for the open note (reader). */
  reader?: boolean;
}

/** Menu for a row (note/folder), the reader's note, or empty space. */
export function menuFor(entry: Entry | null, c: MenuContext = {}): MenuItem[] {
  const off = !!c.offline;
  if (!entry) {
    return [
      { id: 'new', label: 'New note…', keys: 'a', action: 'create', disabled: off },
      { id: 'new-folder', label: 'New folder…', keys: 'a dir/', action: 'newFolder', disabled: off },
      { id: 'paste', label: 'Paste copy here', keys: 'p', action: 'paste', disabled: off || !c.canPaste },
      { id: 'filter', label: 'Filter…', keys: '/', action: 'filter', sep: true },
      { id: 'hidden', label: 'Toggle hidden files', keys: '.', action: 'toggleHidden' },
      { id: 'refresh', label: 'Refresh', keys: 'R', action: 'refresh' },
    ];
  }
  if (entry.kind === 'folder') {
    return [
      { id: 'open', label: 'Open folder', keys: '⏎', action: 'open' },
      { id: 'new', label: 'New note here…', keys: 'a', action: 'create', disabled: off, sep: true },
      { id: 'rename', label: 'Rename / move…', keys: 'r', action: 'rename', disabled: off && !entry.virtual },
      { id: 'paste', label: 'Paste copy here', keys: 'p', action: 'paste', disabled: off || !c.canPaste },
      { id: 'delete', label: entry.virtual ? 'Remove empty folder' : 'Delete…', keys: 'd', action: 'delete', danger: true, sep: true, disabled: !entry.virtual },
    ];
  }
  const items: MenuItem[] = [];
  if (!c.reader) items.push({ id: 'open', label: 'Open', keys: '⏎', action: 'open' });
  items.push(
    { id: 'edit', label: 'Edit', keys: 'e', action: 'edit' },
    { id: 'rename', label: 'Rename / move…', keys: 'r', action: 'rename', disabled: off, sep: true },
    { id: 'yank', label: c.reader ? 'Copy text' : 'Yank (copy note)', keys: 'y', action: 'yank' },
  );
  if (!c.reader) items.push({ id: 'paste', label: 'Paste copy here', keys: 'p', action: 'paste', disabled: off || !c.canPaste });
  items.push(
    { id: 'link', label: 'Copy markdown link', keys: '', action: 'copyLink' },
    // In the reader `d` scrolls half a page: no direct key there.
    { id: 'delete', label: 'Delete…', keys: c.reader ? '' : 'd', action: 'delete', danger: true, disabled: off, sep: true },
  );
  return items;
}

/** Key → item for menu mnemonics (first char of `keys`; ⏎ = Enter). */
export function mnemonic(items: readonly MenuItem[], key: string): MenuItem | null {
  for (const it of items) {
    if (it.disabled || !it.keys) continue;
    const k = it.keys === '⏎' ? 'Enter' : it.keys.split(' ')[0];
    if (k === key) return it;
  }
  return null;
}
