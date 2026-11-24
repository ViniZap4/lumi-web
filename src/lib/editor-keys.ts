// The base CodeMirror keymap for the note editor.
//
// - CM history's undo/redo are dropped: editor-undo.ts binds them to
//   the session's Y.UndoManager.
// - With vim on, the macOS emacs-style Ctrl bindings (Ctrl-v page
//   down, Ctrl-a/e/b/f/n/p/d/h/k/o/t…) are dropped: CodeMirror's keymap
//   handler runs before the vim plugin, so they would shadow vim's
//   <C-v> (blockwise visual), <C-d>, <C-o>… on Macs.

import type { KeyBinding, EditorView } from '@codemirror/view';
import { deleteCharBackward, insertNewlineAndIndent } from '@codemirror/commands';

const UNDO = new Set(['Mod-z', 'Mod-y', 'Mod-Shift-z']);

export function editorKeymap(base: readonly KeyBinding[], vim: boolean): KeyBinding[] {
  return base.filter((b) => {
    if (b.key && UNDO.has(b.key)) return false;
    if (vim && !b.key && b.mac && /^Ctrl-/.test(b.mac)) return false;
    return true;
  });
}

/**
 * Vim INSERT-mode Ctrl-h (backspace) and Ctrl-j (newline). The engine
 * leaves both unbound and the emacs bindings above are dropped, so
 * without these Ctrl-h fell through to the browser (history on
 * Windows/Linux) and Ctrl-j did nothing (downloads on Windows/Linux).
 * They sit below vim in precedence, so a user `imap <C-j>` still wins.
 */
export function vimInsertKeys(isInsert: (v: EditorView) => boolean): KeyBinding[] {
  return [
    { key: 'Ctrl-h', run: (v) => isInsert(v) && deleteCharBackward(v) },
    { key: 'Ctrl-j', run: (v) => isInsert(v) && insertNewlineAndIndent(v) },
  ];
}
