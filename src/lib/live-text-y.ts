// LiveText over a session's Y.Text (lazy chunk: imports yjs).
//
// Every apply() is ONE `doc.transact(fn, origin)` holding ranged
// delete/insert calls, right to left, against the current text
// (CRDT protocol §3.2). Remote transactions (any other origin) are
// reported as `remote` to subscribers. The origin is added to the
// session's UndoManager so `u` / Ctrl-r work on board/canvas edits.

import * as Y from 'yjs';
import type { LiveText } from './live-text.ts';
import { assertDisjoint, sortEditsDesc, type TextEdit } from './text-diff.ts';

export const ORIGIN_STRUCTURED = 'lumi:structured';

export function yLiveText(
  ytext: Y.Text,
  opts: { origin?: unknown; undoManager?: Y.UndoManager | null; editable?: () => boolean } = {},
): LiveText {
  const origin = opts.origin ?? ORIGIN_STRUCTURED;
  const um = opts.undoManager ?? null;
  um?.addTrackedOrigin(origin);
  const doc = ytext.doc!;
  return {
    get editable() {
      return opts.editable ? opts.editable() : true;
    },
    read: () => ytext.toString(),
    apply(edits: readonly TextEdit[]) {
      if (!edits.length || (opts.editable && !opts.editable())) return;
      assertDisjoint(edits);
      // One board/canvas action = one undo step, however fast the
      // next one follows (and never merged with editor typing).
      um?.stopCapturing();
      doc.transact(() => {
        for (const e of sortEditsDesc(edits)) {
          if (e.to > e.from) ytext.delete(e.from, e.to - e.from);
          if (e.insert) ytext.insert(e.from, e.insert);
        }
      }, origin);
      um?.stopCapturing();
    },
    subscribe(fn) {
      const h = (_ev: Y.YTextEvent, tr: Y.Transaction) => fn(tr.origin !== origin && tr.origin !== um);
      ytext.observe(h);
      return () => ytext.unobserve(h);
    },
    anchor(index: number) {
      const rel = Y.createRelativePositionFromTypeIndex(ytext, index);
      return () => Y.createAbsolutePositionFromRelativePosition(rel, doc)?.index ?? null;
    },
    undo: um ? () => void um.undo() : undefined,
    redo: um ? () => void um.redo() : undefined,
  };
}
