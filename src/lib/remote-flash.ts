// Remote-edit flash (SPEC-PARTE2 §1, "a gentle flash on remotely
// edited ranges"). When a Yjs transaction from another client changes
// the note, the inserted text gets a tint that fades over ~600 ms, and
// a deletion leaves a thin marker that fades the same way.
//
// Purely visual: decorations in a StateField, never a document change
// (CRDT-CLIENT-PROTOCOL: nothing here reaches the Y.Text).
//
// Feeding: `observeRemoteEdits(ytext, view)` registers a Y.Text
// observer AFTER y-codemirror's own (it is set up when the view is
// built), so by the time it runs the remote delta is already in the
// CodeMirror doc and delta offsets are doc offsets. Local transactions
// (tr.local — typing here, including y-codemirror's own origin) never
// flash.
//
// Reduced motion: ranges are still marked (state is useful to tests
// and harmless), but the CSS kill-switch removes the fade, and the
// decoration is dropped after a shorter static interval, so it shows as
// a brief faint tint with no animation.

import { StateEffect, StateField, type Extension } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';
import { motionAllowed } from './motion.ts';

export interface FlashRange {
  from: number;
  to: number;
}

/** ms the flash stays (fades in CSS) / static under reduced motion. */
export const REMOTE_FLASH_MS = 600;
export const REMOTE_FLASH_STATIC_MS = 300;
/** Inserts larger than this (bulk loads, replica merges) do not flash. */
export const REMOTE_FLASH_MAX = 4000;

type DeltaOp = { insert?: unknown; retain?: number; delete?: number };

/**
 * Map a Y.Text event delta to ranges in the post-change document:
 * inserted text → [pos, pos+len); a deletion → a zero-width marker at
 * its position. Adjacent / overlapping ranges merge (a marker touching
 * an insert is absorbed). Embeds count as one character.
 */
export function remoteRanges(delta: readonly DeltaOp[]): FlashRange[] {
  const out: FlashRange[] = [];
  let pos = 0;
  for (const op of delta) {
    if (op.retain != null) pos += op.retain;
    else if (op.insert != null) {
      const len = typeof op.insert === 'string' ? op.insert.length : 1;
      out.push({ from: pos, to: pos + len });
      pos += len;
    } else if (op.delete != null) out.push({ from: pos, to: pos });
  }
  return mergeRanges(out);
}

export function mergeRanges(ranges: readonly FlashRange[]): FlashRange[] {
  const sorted = [...ranges].sort((a, b) => a.from - b.from || a.to - b.to);
  const out: FlashRange[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.from <= last.to) last.to = Math.max(last.to, r.to);
    else out.push({ ...r });
  }
  return out;
}

export const addRemoteFlash = StateEffect.define<{ id: number; ranges: readonly FlashRange[] }>();
export const clearRemoteFlash = StateEffect.define<number>();

class DeleteMarker extends WidgetType {
  eq(): boolean {
    return true;
  }
  toDOM(): HTMLElement {
    const s = document.createElement('span');
    s.className = 'cm-remote-flash-del';
    s.setAttribute('aria-hidden', 'true');
    return s;
  }
  ignoreEvent(): boolean {
    return true;
  }
}

function decoFor(id: number, r: FlashRange, docLen: number) {
  const from = Math.max(0, Math.min(r.from, docLen));
  const to = Math.max(from, Math.min(r.to, docLen));
  if (to > from) return Decoration.mark({ class: 'cm-remote-flash', attributes: { 'data-flash': String(id) } }).range(from, to);
  return Decoration.widget({ widget: new DeleteMarker(), side: 1, flash: id }).range(from);
}

/** The flash decorations (mapped through later edits, local or not). */
export const remoteFlashField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(addRemoteFlash)) {
        const len = tr.state.doc.length;
        deco = deco.update({ add: e.value.ranges.map((r) => decoFor(e.value.id, r, len)), sort: true });
      } else if (e.is(clearRemoteFlash)) {
        const id = e.value;
        deco = deco.update({
          filter: (_f, _t, d) => {
            const spec = d.spec as { flash?: number; attributes?: Record<string, string> };
            return (spec.flash ?? Number(spec.attributes?.['data-flash'])) !== id;
          },
        });
      }
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

/** Current flash ranges (tests, debugging). Markers have from === to. */
export function flashRanges(view: EditorView): FlashRange[] {
  const out: FlashRange[] = [];
  const set = view.state.field(remoteFlashField, false);
  if (!set) return out;
  const it = set.iter();
  while (it.value) {
    out.push({ from: it.from, to: it.to });
    it.next();
  }
  return out;
}

let nextID = 1;

/** Flash `ranges` in `view`; they clear themselves after the fade. */
export function flashRemote(view: EditorView, ranges: readonly FlashRange[], reduce = !motionAllowed()): void {
  if (view.state.field(remoteFlashField, false) === undefined || ranges.length === 0) return;
  const id = nextID++;
  view.dispatch({ effects: addRemoteFlash.of({ id, ranges }) });
  setTimeout(() => {
    try {
      view.dispatch({ effects: clearRemoteFlash.of(id) });
    } catch {
      // view destroyed
    }
  }, reduce ? REMOTE_FLASH_STATIC_MS : REMOTE_FLASH_MS);
}

/** CodeMirror extension (field + styles). */
export function remoteFlash(): Extension {
  return [
    remoteFlashField,
    EditorView.baseTheme({
      '.cm-remote-flash': {
        borderRadius: '2px',
        animation: `remote-flash ${REMOTE_FLASH_MS}ms ease-out forwards`,
      },
      '.cm-remote-flash-del': {
        display: 'inline-block',
        width: '2px',
        height: '1em',
        marginRight: '-2px',
        verticalAlign: 'text-bottom',
        background: 'color-mix(in srgb, var(--color-primary) 55%, transparent)',
        animation: `remote-flash-del ${REMOTE_FLASH_MS}ms ease-out forwards`,
      },
    }),
  ];
}

/** Minimal Y.Text surface (keeps yjs out of this module's imports). */
export interface ObservableText {
  observe(f: (ev: { delta: DeltaOp[] }, tr: { local: boolean }) => void): void;
  unobserve(f: (ev: { delta: DeltaOp[] }, tr: { local: boolean }) => void): void;
}

/**
 * Flash remote changes of `ytext` in `view`; `onremote` also hears them
 * (e.g. remoteActivity.bump for the sync dot). Returns the cleanup.
 * Register after the view (and so y-codemirror's observer) exists.
 */
export function observeRemoteEdits(ytext: ObservableText, view: EditorView, onremote?: () => void): () => void {
  const f = (ev: { delta: DeltaOp[] }, tr: { local: boolean }) => {
    if (tr.local) return;
    onremote?.();
    let size = 0;
    for (const op of ev.delta) if (typeof op.insert === 'string') size += op.insert.length;
    if (size > REMOTE_FLASH_MAX) return;
    flashRemote(view, remoteRanges(ev.delta));
  };
  ytext.observe(f);
  return () => ytext.unobserve(f);
}
