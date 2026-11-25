// Read-only live binding: Y.Text → CodeMirror, never the other way
// (viewers without note.edit, mirror books; CRDT client protocol §2 and
// the read-mode ticket). Used instead of yCollab's ySync.
//
//  - Remote deltas become ONE CodeMirror transaction each, tagged with
//    `remoteChange` (ranged changes in original coordinates, like
//    y-codemirror).
//  - Every other document change is dropped by a transaction filter, so
//    no key (vim included), paste or command can change the text. The
//    session also never sends (EditorSession.readOnly), so even a bug
//    here could not reach the server.
//  - Peers' carets are still drawn (yRemoteSelections reads the facet);
//    this client publishes no presence.

import { Annotation, EditorState, type Extension, type ChangeSpec } from '@codemirror/state';
import { EditorView, ViewPlugin } from '@codemirror/view';
import * as Y from 'yjs';
import { ySyncFacet, YSyncConfig, yRemoteSelections, yRemoteSelectionsTheme } from 'y-codemirror.next';
import type { Awareness } from 'y-protocols/awareness';

export const remoteChange = Annotation.define<boolean>();

/** CodeMirror changes for a Y.Text delta (original coordinates). */
export function deltaToChanges(delta: readonly { insert?: unknown; delete?: number; retain?: number }[]): ChangeSpec[] {
  const out: ChangeSpec[] = [];
  let pos = 0;
  for (const d of delta) {
    if (d.retain != null) pos += d.retain;
    else if (d.insert != null) out.push({ from: pos, insert: typeof d.insert === 'string' ? d.insert : '' });
    else if (d.delete != null) {
      out.push({ from: pos, to: pos + d.delete });
      pos += d.delete;
    }
  }
  return out;
}

export function readOnlyYSync(ytext: Y.Text, awareness: Awareness | null): Extension {
  const follow = ViewPlugin.define((view) => {
    const h = (ev: Y.YTextEvent) => {
      const changes = deltaToChanges(ev.delta as { insert?: unknown; delete?: number; retain?: number }[]);
      if (changes.length) view.dispatch({ changes, annotations: remoteChange.of(true) });
    };
    ytext.observe(h);
    return { destroy: () => ytext.unobserve(h) };
  });
  return [
    EditorState.readOnly.of(true),
    EditorState.transactionFilter.of((tr) => (tr.docChanged && !tr.annotation(remoteChange) ? [] : tr)),
    EditorView.contentAttributes.of({ 'aria-readonly': 'true' }),
    follow,
    ...(awareness ? [ySyncFacet.of(new YSyncConfig(ytext, awareness)), yRemoteSelectionsTheme, yRemoteSelections] : []),
  ];
}
