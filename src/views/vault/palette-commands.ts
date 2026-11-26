// The command palette's commands for the book shell. Called inside a
// `$derived` (CommandController.paletteCommands), so every state read
// here is tracked and the list follows the workspace.

import { notes } from '../../lib/notes.svelte.ts';
import { books } from '../../lib/books.svelte.ts';
import { uiState } from '../../lib/uistate.svelte.ts';
import { editorSettings } from '../../lib/editor-settings.svelte.ts';
import { structuredFocus } from '../../lib/structured-mode.svelte.ts';
import type { PaletteCommand } from '../../lib/palette.ts';
import type { Workspace } from './workspace.svelte.ts';

/** Palette → the focused canvas: replay a zoom key on its root (the
 *  canvas keymap is the one place that owns zoom keys). */
function canvasKey(key: string): void {
  const root = [...document.querySelectorAll<HTMLElement>('[data-testid=canvas-view]')].pop();
  if (!root) return;
  root.focus({ preventScroll: true });
  root.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}

/** Canvas / board modes (SPEC-PARTE2 §5a) for the view that had the keyboard. */
function structuredCommands(): PaletteCommand[] {
  const last = structuredFocus.last;
  if (!last) return [];
  const name = last.kind === 'canvas' ? 'Canvas' : 'Board';
  return [
    { id: 'structuredRead', title: `${name}: Reading mode`, keys: 'Esc', group: 'mode view read only canvas board kanban', run: () => structuredFocus.last?.set('read') },
    { id: 'structuredEdit', title: `${name}: Edit mode`, keys: 'e', group: 'mode edit canvas board kanban', run: () => structuredFocus.last?.set('edit') },
    ...(last.kind === 'canvas'
      ? [
          { id: 'canvasZoomIn', title: 'Canvas: Zoom in', keys: '+ zi ⌘+', group: 'canvas zoom in bigger magnify', run: () => canvasKey('+') },
          { id: 'canvasZoomOut', title: 'Canvas: Zoom out', keys: '_ zo ⌘-', group: 'canvas zoom out smaller', run: () => canvasKey('_') },
          { id: 'canvasFit', title: 'Canvas: Fit', keys: '0 zf', group: 'canvas zoom fit all overview', run: () => canvasKey('0') },
        ]
      : []),
    ...(last.source ? [{ id: 'structuredSource', title: `${name}: Source`, group: 'mode source json markdown raw canvas board kanban', run: () => structuredFocus.last?.source?.() }] : []),
  ];
}

export function paletteCommands(ws: Workspace): PaletteCommand[] {
  const ex = ws.explorer;
  const pn = ws.panes;
  const ed = ws.edit;
  const s = editorSettings.value;
  return [
    ...structuredCommands(),
    { id: 'explorer', title: 'Open explorer', keys: '-', group: 'files browse yazi floating overlay open navigate', run: () => ex.open() },
    { id: 'books', title: 'Switch book…', keys: 'gb', group: 'navigate books vault accounts floating', run: ex.openBooks },
    { id: 'root', title: 'Explorer at book root', keys: 'gh', group: 'navigate home files', run: () => ex.open({ root: true }) },
    { id: 'filter', title: 'Filter a folder…', keys: '- /', group: 'search files explorer', run: () => ex.open({ initial: 'filter' }) },
    { id: 'new', title: 'New note…', keys: 'a', group: 'create file', run: ex.beginCreate },
    { id: 'new-canvas', title: 'New canvas…', keys: 'a name.canvas', group: 'create canvas json', run: ex.beginCreateCanvas },
    { id: 'new-folder', title: 'New folder…', keys: 'a dir/', group: 'create directory', run: ex.beginNewFolder },
    ...(ws.pane === 'note'
      ? [
          { id: 'rename', title: 'Rename / move note…', keys: 'r', group: 'file', run: ex.beginRename },
          { id: 'delete', title: 'Delete note…', keys: '- d', group: 'file remove', run: ex.beginDelete },
          { id: 'close-note', title: 'Close note', keys: 'q', group: 'home book', run: () => ws.closeNote() },
        ]
      : []),
    { id: 'edit', title: ed.mode ? 'Reading view' : 'Edit note', keys: '⌘E', group: 'editor', run: () => { if (ed.mode) ed.exit(); else { const t = ws.noteUnderFocus(); if (t) void ed.editNote(t); } } },
    { id: 'live', title: s.editMode === 'live' ? 'Switch to Source mode' : 'Switch to Live Preview', keys: '⌘⇧E', group: 'editor', run: () => editorSettings.toggleEditMode() },
    { id: 'split', title: ed.splitOn ? 'Hide preview beside source' : 'Show preview beside source', keys: '\\p ⌘⌥P', group: 'editor split side by side render', run: ed.toggleSplit },
    { id: 'vsplit', title: 'Split vertically (:vsplit)', keys: '⌃w v', group: 'pane window side by side', run: () => pn.runWin('vsplit') },
    { id: 'hsplit', title: 'Split horizontally (:split)', keys: '⌃w s', group: 'pane window stacked below', run: () => pn.runWin('split') },
    ...(pn.multi
      ? [
          { id: 'close-pane', title: 'Close pane', keys: '⌃w q', group: 'pane window', run: () => pn.runWin('close') },
          { id: 'only-pane', title: 'Keep only this pane', keys: '⌃w o', group: 'pane window only', run: () => pn.runWin('only') },
          { id: 'zoom-pane', title: pn.zoomed ? 'Unzoom pane (:zoom)' : 'Zoom pane (:zoom)', keys: '⌃w z', group: 'pane window zoom maximize focus tmux', run: () => pn.runWin('zoom') },
          { id: 'equal-panes', title: 'Equalize panes', keys: '⌃w =', group: 'pane window resize', run: () => pn.runWin('equal') },
        ]
      : []),
    { id: 'back', title: 'Previous note', keys: 'H', group: 'history back navigate', run: () => ws.cmd.runAction({ kind: 'historyBack' }) },
    { id: 'forward', title: 'Next note', keys: 'L', group: 'history forward navigate', run: () => ws.cmd.runAction({ kind: 'historyForward' }) },
    { id: 'hover', title: s.hoverPreview ? 'Turn off hover link previews' : 'Turn on hover link previews', keys: 'K', group: 'preview link card', run: () => editorSettings.update({ hoverPreview: !editorSettings.value.hoverPreview }) },
    { id: 'deeplink', title: 'Copy link to this note', group: 'share url deep link lumi open', run: () => ws.copyDeepLink() },
    { id: 'hints', title: 'Hint mode (click by keyboard)', keys: 'F', group: 'navigate vimium labels', run: () => (ws.cmd.hintsOpen = true) },
    { id: 'motion-full', title: 'Movimento: completo', group: 'motion animation full alive', run: () => editorSettings.update({ motion: 'full' }) },
    { id: 'motion-soft', title: 'Movimento: suave', group: 'motion animation soft calm', run: () => editorSettings.update({ motion: 'soft' }) },
    { id: 'motion', title: 'Movimento: reduzido', group: 'motion reduce animation accessibility vestibular', run: () => editorSettings.update({ motion: 'reduced' }) },
    { id: 'refresh', title: 'Refresh notes', keys: 'R', group: 'sync reload', run: () => void notes.refresh() },
    { id: 'next-book', title: 'Next book', keys: ']', group: 'navigate switch', run: () => ws.cycleBook(1) },
    { id: 'prev-book', title: 'Previous book', keys: '[', group: 'navigate switch', run: () => ws.cycleBook(-1) },
    { id: 'manage-books', title: 'Manage books…', group: 'books vault list rename remove', run: () => books.openPicker() },
    { id: 'settings', title: 'Settings', keys: ',', group: 'preferences', run: () => uiState.openSettings('editor') },
    { id: 'vim', title: 'Vim settings & .vimrc', group: 'preferences vimrc keys', run: () => uiState.openSettings('vim') },
    { id: 'appearance', title: 'Theme & appearance', group: 'preferences colour color dark light', run: () => uiState.openSettings('appearance') },
    { id: 'legend', title: s.legend ? 'Hide command legend' : 'Show command legend', group: 'view keys hints', run: () => editorSettings.update({ legend: !editorSettings.value.legend }) },
    { id: 'keys', title: 'Keyboard shortcuts', keys: '?', group: 'help', run: () => (uiState.helpOpen = true) },
    { id: 'book-settings', title: 'Book settings (members, roles)', group: 'vault admin', run: () => (ws.showSettings = true) },
    { id: 'new-book', title: 'New book…', group: 'create vault', run: () => (uiState.createBookOpen = true) },
  ];
}
