// Collaborative undo for the note editor (CRDT protocol: undo reverts
// only this user's own edits, as ranged ops).
//
// The session owns ONE Y.UndoManager per note (shared by every pane
// on that note and by the structured board/canvas views). This module
// replaces y-codemirror.next's undo plugin, which got three things
// wrong for lumi:
//
//  1. Vim `u` / `Ctrl-r` / `:undo` / `:redo` call @codemirror/commands'
//     undo/redo, which need CodeMirror's history() — which must stay
//     off under yCollab. They were silent no-ops. `installVimUndo()`
//     routes them to the Y.UndoManager of the view they run in (and
//     falls back to CM history elsewhere, e.g. the vimrc editor).
//  2. ⌘Z / ⇧⌘Z were left to the browser's native `historyUndo`, which
//     only sees DOM-typed text (never a vim `dd`). `yUndoKeymap()`
//     binds them explicitly.
//  3. Grouping was purely time-based (500 ms): a vim insert session
//     with a pause split into several `u` steps, and two quick normal
//     commands merged into one. With vim on, a unit is now one insert
//     session (including the `c`/`o`/`s` that opened it and the
//     count/block replication on <Esc>) or one normal/ex command (one
//     vim operation, e.g. `:s/../../g` with many matches). Edits that
//     are not vim operations (Live Preview checkbox, ⌘K link, pasted
//     link) are a unit each. With vim off, typing and deleting runs
//     group as in CodeMirror (500 ms); anything else is its own unit.
//
// Cursor after undo/redo: vim puts it at the start of the changed
// text (as CodeMirror vim did with CM history); without vim, undo
// restores the selection from before the change (relative positions,
// so remote edits in between are accounted for) and redo puts the
// cursor after the change.

import type * as Y from 'yjs';
import { EditorSelection, Facet, type Extension } from '@codemirror/state';
import { EditorView, ViewPlugin, type KeyBinding, type ViewUpdate } from '@codemirror/view';
import { ySyncFacet, type YSyncConfig } from 'y-codemirror.next';
import { CodeMirror, Vim, getCM } from '@replit/codemirror-vim';

/** Vim grouping is by command/insert session, never by time. */
export const VIM_CAPTURE_TIMEOUT = 2 ** 31;
/** Without vim: CodeMirror's history newGroupDelay. */
export const PLAIN_CAPTURE_TIMEOUT = 500;

type VimCM = {
  state: { vim?: { insertMode?: boolean } | null };
  curOp?: { isVimOp?: boolean } | null;
  cm6: EditorView;
  on(ev: string, fn: (e: { mode: string }) => void): void;
  off(ev: string, fn: (e: { mode: string }) => void): void;
};

/** Grouping state shared by every view on one UndoManager (panes). */
interface Shared {
  lastKey: unknown;
}
const shared = new WeakMap<Y.UndoManager, Shared>();
function sharedOf(um: Y.UndoManager): Shared {
  let s = shared.get(um);
  if (!s) shared.set(um, (s = { lastKey: null }));
  return s;
}

/** The session UndoManager of an editor (null: not a collab editor). */
const undoFacet = Facet.define<Y.UndoManager, Y.UndoManager | null>({
  combine: (v) => v[0] ?? null,
});

class UndoPlugin {
  readonly um: Y.UndoManager;
  readonly sync: YSyncConfig;
  private cm: VimCM | null = null;
  /** Unit of the vim insert session in progress (set on entering
   *  insert/replace mode, cleared when it ends). */
  private insertKey: object | null = null;
  /** Selection before the local change being pushed to Y. */
  private before: ReturnType<YSyncConfig['toYRange']> | null = null;
  /** A Y transaction's observers are running (remote, undo, or another
   *  pane's edit): CodeMirror updates in this window are not local. */
  private yApplying = 0;
  /** Changed span of the undo/redo this view is running. */
  capture: { from: number; to: number } | null = null;

  constructor(readonly view: EditorView) {
    this.um = view.state.facet(undoFacet)!;
    this.sync = view.state.facet(ySyncFacet);
    this.um.addTrackedOrigin(this.sync);
    this.um.on('stack-item-added', this.onAdded);
    this.um.on('stack-item-popped', this.onPopped);
    const doc = this.sync.ytext.doc!;
    doc.on('beforeObserverCalls', this.onBeforeObservers);
    doc.on('afterTransactionCleanup', this.onCleanup);
    this.attachVim();
  }

  private readonly onBeforeObservers = () => {
    this.yApplying++;
  };
  private readonly onCleanup = () => {
    if (this.yApplying) this.yApplying--;
  };
  private readonly onAdded = (ev: { stackItem: { meta: Map<unknown, unknown> }; origin: unknown }) => {
    if (ev.origin === this.sync && this.before && !ev.stackItem.meta.has(this)) ev.stackItem.meta.set(this, this.before);
  };
  private readonly onPopped = () => {
    // The next local edit starts a new unit (Y already stops
    // capturing after an undo; make the key check agree).
    sharedOf(this.um).lastKey = null;
  };
  private readonly onMode = (e: { mode: string }) => {
    if (e.mode === 'insert' || e.mode === 'replace') {
      const op = this.cm?.curOp;
      // `ciw`, `o`, `s`…: the change that opened the session and the
      // typed text are one unit (the operation object is the key).
      this.insertKey = op && op.isVimOp ? op : {};
    } else {
      this.insertKey = null;
    }
  };

  /** (Re)bind to the vim adapter: vim can be toggled live. */
  private attachVim(): void {
    const cm = (getCM(this.view) as unknown as VimCM | null) ?? null;
    if (cm === this.cm) return;
    this.cm?.off('vim-mode-change', this.onMode);
    this.cm = cm;
    this.insertKey = null;
    if (cm) {
      cm.on('vim-mode-change', this.onMode);
      if (cm.state.vim?.insertMode) this.insertKey = {};
    }
  }

  get vimOn(): boolean {
    return this.cm != null;
  }

  /** The undo unit a local change belongs to. */
  private keyOf(u: ViewUpdate): unknown {
    const cm = this.cm;
    if (cm) {
      if (this.insertKey) return this.insertKey;
      const op = cm.curOp;
      if (op && op.isVimOp) return op;
      return {};
    }
    const tr = u.transactions.find((t) => t.docChanged);
    if (tr?.isUserEvent('input.type')) return 'type';
    if (tr?.isUserEvent('delete.backward') || tr?.isUserEvent('delete.forward')) return 'delete';
    return {};
  }

  // Runs BEFORE ySync's update (registered ahead of yCollab), so the
  // capture boundary is set before the change reaches the Y.Doc.
  update(u: ViewUpdate): void {
    this.attachVim();
    if (!u.docChanged) return;
    if (this.yApplying) {
      const cap = this.capture;
      if (cap) {
        u.changes.iterChangedRanges((_fa, _ta, fromB, toB) => {
          cap.from = Math.min(cap.from, fromB);
          cap.to = Math.max(cap.to, toB);
        }, true);
      }
      return;
    }
    const s = sharedOf(this.um);
    this.um.captureTimeout = this.vimOn ? VIM_CAPTURE_TIMEOUT : PLAIN_CAPTURE_TIMEOUT;
    // A new unit starts whenever the key changes (fresh `{}` keys
    // always differ: a standalone edit is a unit of its own).
    const key = this.keyOf(u);
    if (key !== s.lastKey) this.um.stopCapturing();
    s.lastKey = key;
    this.before = this.sync.toYRange(u.startState.selection.main);
  }

  /** Undo (redo) in this view; moves the cursor to the change. */
  run(redo: boolean): boolean {
    const cap = (this.capture = { from: Infinity, to: -1 });
    let item: { meta: Map<unknown, unknown> } | null;
    try {
      item = (redo ? this.um.redo() : this.um.undo()) as typeof item;
    } finally {
      this.capture = null;
    }
    if (!item || cap.to < 0) return true;
    const len = this.view.state.doc.length;
    let sel: EditorSelection;
    const stored = item.meta.get(this) as ReturnType<YSyncConfig['toYRange']> | undefined;
    if (this.vimOn) {
      sel = EditorSelection.single(Math.min(cap.from, len));
    } else if (!redo && stored) {
      const r = this.sync.fromYRange(stored);
      sel = EditorSelection.create([r]);
    } else {
      sel = EditorSelection.single(Math.min(redo ? cap.to : cap.from, len));
    }
    this.view.dispatch({ selection: sel, scrollIntoView: true, userEvent: redo ? 'select.redo' : 'select.undo' });
    return true;
  }

  destroy(): void {
    this.cm?.off('vim-mode-change', this.onMode);
    this.um.off('stack-item-added', this.onAdded);
    this.um.off('stack-item-popped', this.onPopped);
    const doc = this.sync.ytext.doc;
    doc?.off('beforeObserverCalls', this.onBeforeObservers);
    doc?.off('afterTransactionCleanup', this.onCleanup);
    this.um.removeTrackedOrigin(this.sync);
  }
}

const undoPlugin = ViewPlugin.fromClass(UndoPlugin, {
  eventHandlers: {
    beforeinput(e) {
      // Edit menu / touch-bar undo.
      if (e.inputType !== 'historyUndo' && e.inputType !== 'historyRedo') return false;
      e.preventDefault();
      return this.run(e.inputType === 'historyRedo');
    },
  },
});

/** Undo in a collaborative editor view. False: not one. */
export function yUndo(view: EditorView): boolean {
  return view.plugin(undoPlugin)?.run(false) ?? false;
}
/** Redo in a collaborative editor view. False: not one. */
export function yRedo(view: EditorView): boolean {
  return view.plugin(undoPlugin)?.run(true) ?? false;
}

/**
 * The editor's undo: grouping + selection + beforeinput. Must be
 * placed BEFORE yCollab(…, { undoManager: false }) in the extension
 * list so its update runs ahead of ySync's.
 */
export function yUndoExtension(um: Y.UndoManager): Extension {
  return [undoFacet.of(um), undoPlugin];
}

/** ⌘Z / ⇧⌘Z (and Ctrl-Y off vim, where vim owns <C-y>). */
export function yUndoKeymap(vim: boolean): KeyBinding[] {
  const keys: KeyBinding[] = [
    { key: 'Mod-z', run: yUndo, preventDefault: true },
    { key: 'Mod-Shift-z', run: yRedo, preventDefault: true },
  ];
  if (!vim) keys.push({ key: 'Mod-y', mac: 'Mod-y', run: yRedo, preventDefault: true });
  return keys;
}

// ---- vim u / Ctrl-r / :undo / :redo -------------------------------------------

let vimInstalled = false;

/**
 * Route vim's history commands to the view's Y.UndoManager. Global
 * (the vim engine is a singleton); views without one keep CodeMirror
 * history (vimrc editor). Idempotent.
 */
export function installVimUndo(): void {
  if (vimInstalled) return;
  vimInstalled = true;
  const cmds = (CodeMirror as unknown as { commands: Record<string, (cm: VimCM) => void> }).commands;
  const origUndo = cmds.undo;
  const origRedo = cmds.redo;
  cmds.undo = (cm) => {
    if (!yUndo(cm.cm6)) origUndo(cm);
  };
  cmds.redo = (cm) => {
    if (!yRedo(cm.cm6)) origRedo(cm);
  };
  // The ex table captured the original functions at load time.
  const V = Vim as unknown as { defineEx(name: string, prefix: string, fn: (cm: VimCM) => void): void };
  V.defineEx('undo', 'u', (cm) => cmds.undo(cm));
  V.defineEx('redo', 'red', (cm) => cmds.redo(cm));
}
