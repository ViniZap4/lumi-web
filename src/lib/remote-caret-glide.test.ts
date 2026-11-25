// @vitest-environment jsdom
import { describe, it, expect, afterEach, afterAll } from 'vitest';
import { EditorView, ViewPlugin, Decoration, WidgetType, type DecorationSet } from '@codemirror/view';
import { EditorState, StateEffect } from '@codemirror/state';
import { planGlides, remoteCaretGlide, type CaretPos } from './remote-caret-glide.ts';
import { engine, setMotionLevel } from './motion.ts';

const el = () => document.createElement('span');

describe('planGlides', () => {
  it('glides a known peer that moved, from its old visual position', () => {
    const a = el();
    const next: CaretPos[] = [{ key: 'ana', x: 100, y: 40, el: a }];
    expect(planGlides(new Map([['ana', { x: 20, y: 40, vx: 5, vy: 0 }]]), next)).toEqual([{ el: a, dx: -80, dy: 0, vx: 5, vy: 0 }]);
  });

  it('new peers, peers that did not move, far jumps and ambiguous keys just appear', () => {
    const prev = new Map([['ana', { x: 0, y: 0 }], ['bo', { x: 10, y: 10 }], ['cy', { x: 0, y: 0 }]]);
    const next: CaretPos[] = [
      { key: 'ana', x: 0.2, y: 0, el: el() }, // did not move
      { key: 'bo', x: 10, y: 2000, el: el() }, // another screen
      { key: 'cy', x: 50, y: 0, el: el() }, // same name+colour twice
      { key: 'cy', x: 60, y: 0, el: el() },
      { key: 'dee', x: 5, y: 5, el: el() }, // new
    ];
    expect(planGlides(prev, next)).toEqual([]);
  });
});

// ---- plugin over a real EditorView -------------------------------------------
// A stand-in for y-codemirror's remote selections: one caret widget at
// `peerPos`, redrawn on every awareness change (a fresh DOM node each
// time, like the real widget).
class Caret extends WidgetType {
  constructor(readonly pos: number) { super(); }
  eq(o: Caret) { return o.pos === this.pos; }
  toDOM() {
    const s = document.createElement('span');
    s.className = 'cm-ySelectionCaret';
    s.style.borderColor = 'rgb(255, 0, 0)';
    s.dataset.pos = String(this.pos);
    const info = document.createElement('div');
    info.className = 'cm-ySelectionInfo';
    info.textContent = 'Maya';
    s.appendChild(info);
    return s;
  }
}
const redraw = StateEffect.define<number>();

function setup() {
  let peerPos = 0;
  const listeners = new Set<(c: { added: number[]; updated: number[]; removed: number[] }) => void>();
  const awareness = {
    doc: { clientID: 1 },
    on: (_: 'change', fn: (c: { added: number[]; updated: number[]; removed: number[] }) => void) => void listeners.add(fn),
    off: (_: 'change', fn: (c: { added: number[]; updated: number[]; removed: number[] }) => void) => void listeners.delete(fn),
  };
  const carets = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor() { this.decorations = Decoration.set([Decoration.widget({ widget: new Caret(peerPos) }).range(peerPos)]); }
      update() { this.decorations = Decoration.set([Decoration.widget({ widget: new Caret(peerPos) }).range(peerPos)]); }
    },
    { decorations: (v) => v.decorations },
  );
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  const view = new EditorView({ state: EditorState.create({ doc: 'abcdefghijklmnopqrstuvwxyz', extensions: [carets, remoteCaretGlide(awareness)] }), parent });
  const caret = () => view.contentDOM.querySelector<HTMLElement>('.cm-ySelectionCaret')!;
  /** The peer moved: redraw (like y-remote-selections) then notify. */
  const move = (to: number) => {
    peerPos = to;
    view.dispatch({ effects: redraw.of(to) });
    for (const fn of listeners) fn({ added: [], updated: [2], removed: [] });
    (view as unknown as { measure(): void }).measure();
  };
  return { view, caret, move, parent };
}

const proto = HTMLElement.prototype as unknown as { getBoundingClientRect: () => DOMRect };
const realRect = proto.getBoundingClientRect;
// jsdom has no layout: CodeMirror measures text ranges.
const R = Range.prototype as unknown as Record<string, unknown>;
R.getClientRects ??= () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] });
R.getBoundingClientRect ??= () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 });
afterAll(() => {
  proto.getBoundingClientRect = realRect;
});

describe('remoteCaretGlide', () => {
  let ctx: ReturnType<typeof setup> | null = null;
  // 10 px per character, one line.
  proto.getBoundingClientRect = function (this: HTMLElement) {
    const x = this.dataset?.pos ? Number(this.dataset.pos) * 10 : 0;
    return { left: x, top: 0, right: x + 2, bottom: 20, width: 2, height: 20, x, y: 0, toJSON() {} } as DOMRect;
  };
  afterEach(() => {
    ctx?.view.destroy();
    ctx?.parent.remove();
    ctx = null;
    setMotionLevel('full', null);
    engine.tracks.clear();
  });

  it('an awareness move glides the redrawn caret from where it was (and skips the re-grow)', () => {
    ctx = setup();
    ctx.move(2); // baseline (positions start stale)
    expect(ctx.caret().style.transform).toBe('');
    ctx.move(8);
    const c = ctx.caret();
    expect(c.classList.contains('cm-ySelectionCaret-glide')).toBe(true);
    // Pushed back to x = 20 from its new x = 80, springing home.
    expect(c.style.transform).toMatch(/^translate3d\(-60(\.00)?px, 0(\.00)?px, 0\)/);
  });

  it('typing never glides (a doc change makes the positions stale)', () => {
    ctx = setup();
    ctx.move(2);
    ctx.view.dispatch({ changes: { from: 0, insert: 'x' } });
    ctx.move(8);
    expect(ctx.caret().style.transform).toBe('');
  });

  it('Reduce Motion: no glide', () => {
    ctx = setup();
    setMotionLevel('reduced', null);
    ctx.move(2);
    ctx.move(8);
    expect(ctx.caret().style.transform).toBe('');
    expect(ctx.caret().classList.contains('cm-ySelectionCaret-glide')).toBe(false);
  });
});
