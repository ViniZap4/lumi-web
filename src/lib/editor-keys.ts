// The base CodeMirror keymap for the note editor.
//
// - Undo/redo are dropped: yCollab supplies a Yjs-aware UndoManager.
// - With vim on, the macOS emacs-style Ctrl bindings (Ctrl-v page
//   down, Ctrl-a/e/b/f/n/p/d/h/k/o/t…) are dropped: CodeMirror's keymap
//   handler runs before the vim plugin, so they would shadow vim's
//   <C-v> (blockwise visual), <C-d>, <C-o>… on Macs.

import type { KeyBinding } from '@codemirror/view';

const UNDO = new Set(['Mod-z', 'Mod-y', 'Mod-Shift-z']);

export function editorKeymap(base: readonly KeyBinding[], vim: boolean): KeyBinding[] {
  return base.filter((b) => {
    if (b.key && UNDO.has(b.key)) return false;
    if (vim && !b.key && b.mac && /^Ctrl-/.test(b.mac)) return false;
    return true;
  });
}
