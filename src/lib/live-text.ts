// LiveText: the one surface structured views (kanban, canvas) write
// through. The Yjs implementation lives in live-text-y.ts (lazy chunk);
// this file has no Yjs import so the board/canvas modules stay light.
//
// Contract:
//  - `read()` returns the CURRENT text. Callers plan edits against it
//    and call `apply()` synchronously, so no remote update can land in
//    between (CRDT protocol §3.2).
//  - `apply(edits)` takes disjoint edits in the coordinates of that read
//    and applies them right to left in ONE transaction.
//  - `subscribe(fn)` fires after every change, local or remote, with
//    `remote` telling them apart.
//  - `anchor(i)` returns a sticky position: it follows the character at
//    `i` through later edits (Y relative positions in the Yjs impl).

import { applyTextEdits, assertDisjoint, type TextEdit } from './text-diff.ts';

export interface LiveText {
  read(): string;
  apply(edits: readonly TextEdit[]): void;
  subscribe(fn: (remote: boolean) => void): () => void;
  readonly editable: boolean;
  anchor(index: number): () => number | null;
  undo?(): void;
  redo?(): void;
}

/** In-memory LiveText (tests, read-only previews, the screenshot harness). */
export interface MemoryLiveText extends LiveText {
  /** Simulate a remote replacement of the text. */
  remote(edits: readonly TextEdit[]): void;
  editable: boolean;
}

export function memoryLiveText(initial: string, editable = true): MemoryLiveText {
  let text = initial;
  const subs = new Set<(remote: boolean) => void>();
  // Sticky anchors are re-mapped through every edit.
  const anchors = new Set<{ i: number | null }>();
  const history: string[] = [];
  const future: string[] = [];

  function mapAnchors(edits: readonly TextEdit[]): void {
    for (const a of anchors) {
      if (a.i == null) continue;
      let i = a.i;
      for (const e of [...edits].sort((x, y) => y.from - x.from)) {
        if (i >= e.to) i += e.insert.length - (e.to - e.from);
        else if (i >= e.from) i = e.from; // inside a deleted span
      }
      a.i = i;
    }
  }
  function run(edits: readonly TextEdit[], remote: boolean): void {
    if (!edits.length) return;
    assertDisjoint(edits);
    if (!remote) {
      history.push(text);
      future.length = 0;
    }
    text = applyTextEdits(text, edits);
    mapAnchors(edits);
    for (const fn of subs) fn(remote);
  }
  return {
    editable,
    read: () => text,
    apply(edits) {
      if (!this.editable) return;
      run(edits, false);
    },
    remote: (edits) => run(edits, true),
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    anchor(index) {
      const a = { i: index as number | null };
      anchors.add(a);
      return () => a.i;
    },
    undo() {
      const prev = history.pop();
      if (prev === undefined) return;
      future.push(text);
      text = prev;
      for (const fn of subs) fn(false);
    },
    redo() {
      const next = future.pop();
      if (next === undefined) return;
      history.push(text);
      text = next;
      for (const fn of subs) fn(false);
    },
  };
}
