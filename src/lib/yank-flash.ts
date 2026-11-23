// Yank highlight (Neovim's `vim.highlight.on_yank`): the yanked range
// flashes briefly in the theme's accent tint, then fades. Purely
// visual — a mark decoration in a StateField, never a document change
// (CRDT-CLIENT-PROTOCOL: nothing here reaches the Y.Text).
//
// The vim engine has no yank event, so `installYankFlash` redefines
// the `yank` operator on the Vim singleton with the engine's own
// behaviour (register push + cursor placement) plus the flash. Every
// yank goes through it: y{motion}, yy, Y, counts, "a registers and
// visual y (charwise, linewise and blockwise).

import { StateEffect, StateField, type Extension, type Text } from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';

export interface Span {
  from: number;
  to: number;
}

/** ms the flash stays up (animated fade) / with reduced motion (static). */
export const YANK_FLASH_MS = 220;
export const YANK_FLASH_STATIC_MS = 150;

const setFlash = StateEffect.define<readonly Span[]>();
const clearFlash = StateEffect.define<null>();

const flashMark = Decoration.mark({ class: 'cm-yank-flash' });

/** Normalise yanked ranges: ordered, clipped to the doc, empties dropped. */
export function yankSpans(doc: Pick<Text, 'length'>, ranges: readonly Span[]): Span[] {
  const out: Span[] = [];
  for (const r of ranges) {
    const from = Math.max(0, Math.min(r.from, r.to, doc.length));
    const to = Math.min(doc.length, Math.max(r.from, r.to));
    if (to > from) out.push({ from, to });
  }
  return out.sort((a, b) => a.from - b.from);
}

export const yankFlashField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(clearFlash)) deco = Decoration.none;
      if (e.is(setFlash)) {
        const spans = yankSpans(tr.state.doc, e.value);
        deco = Decoration.set(spans.map((s) => flashMark.range(s.from, s.to)), true);
      }
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

const timers = new WeakMap<EditorView, ReturnType<typeof setTimeout>>();

/** Flash `ranges` in `view` (no-op when the extension is not loaded). */
export function flashYank(view: EditorView, ranges: readonly Span[], reduceMotion = false): void {
  if (view.state.field(yankFlashField, false) === undefined) return;
  const spans = yankSpans(view.state.doc, ranges);
  if (!spans.length) return;
  const prev = timers.get(view);
  if (prev) clearTimeout(prev);
  view.dispatch({ effects: setFlash.of(spans) });
  timers.set(
    view,
    setTimeout(() => {
      timers.delete(view);
      try {
        view.dispatch({ effects: clearFlash.of(null) });
      } catch {
        // view destroyed
      }
    }, reduceMotion ? YANK_FLASH_STATIC_MS : YANK_FLASH_MS),
  );
}

/** The flash field (add to the editor's extensions). */
export function yankFlash(): Extension {
  return yankFlashField;
}

// ---- vim operator --------------------------------------------------------------

interface Pos { line: number; ch: number }
interface VimCM {
  state: { vim?: { visualMode?: boolean; visualBlock?: boolean; sel: { anchor: Pos; head: Pos } } };
  cm6: EditorView;
  getSelection(): string;
  indexFromPos(p: Pos): number;
}
interface VimApi {
  defineOperator(name: string, fn: (cm: VimCM, args: { registerName?: string; linewise?: boolean }, ranges: { anchor: Pos; head: Pos }[], oldAnchor: Pos) => Pos | void): void;
  getRegisterController(): { pushText(reg: string | undefined, op: string, text: string, linewise?: boolean, blockwise?: boolean): void };
}

function cursorMin(...ps: Pos[]): Pos {
  return ps.reduce((m, p) => (p.line < m.line || (p.line === m.line && p.ch < m.ch) ? p : m));
}

let installed = false;

/**
 * Replace vim's `yank` operator with one that also flashes the range.
 * Mirrors @replit/codemirror-vim's operator exactly (register push +
 * returned cursor) so yanking behaves the same.
 */
export function installYankFlash(Vim: VimApi, reduceMotion: () => boolean): void {
  if (installed) return;
  installed = true;
  Vim.defineOperator('yank', (cm, args, ranges, oldAnchor) => {
    const vim = cm.state.vim;
    const text = cm.getSelection();
    const endPos = vim?.visualMode
      ? cursorMin(vim.sel.anchor, vim.sel.head, ranges[0].head, ranges[0].anchor)
      : oldAnchor;
    Vim.getRegisterController().pushText(args.registerName, 'yank', text, args.linewise, vim?.visualBlock);
    try {
      const spans = ranges.map((r) => ({ from: cm.indexFromPos(r.anchor), to: cm.indexFromPos(r.head) }));
      flashYank(cm.cm6, spans, reduceMotion());
    } catch {
      // purely cosmetic
    }
    return endPos;
  });
}
