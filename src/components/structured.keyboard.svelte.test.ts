// @vitest-environment jsdom
//
// Board and canvas views driven by keys over an in-memory LiveText:
// every key maps to a minimal ranged edit, remote edits keep focus,
// and keys the views do not own reach the shell (not defaultPrevented).

import { describe, it, expect, afterEach } from 'vitest';
import { mount, unmount, flushSync, tick } from 'svelte';
import KanbanBoard from './kanban/KanbanBoard.svelte';
import CanvasView from './canvas/CanvasView.svelte';
import { memoryLiveText, type MemoryLiveText } from '../lib/live-text.ts';
import type { TextEdit } from '../lib/text-diff.ts';

const BOARD = '## Todo\n\n- [ ] alpha\n- [ ] beta\n\n## Done\n\n- [x] gamma\n\n%% kanban:settings\n```\n{"kanban-plugin":"board"}\n```\n%%';
const CANVAS = '{\n\t"nodes":[\n\t\t{"id":"a","type":"text","text":"A","x":0,"y":0,"width":200,"height":60},\n\t\t{"id":"b","type":"text","text":"B","x":300,"y":0,"width":200,"height":60}\n\t],\n\t"edges":[]\n}';

// jsdom has no Web Animations API (svelte's animate:flip uses it).
const EP = Element.prototype as any;
EP.getAnimations ??= () => [];
EP.animate ??= () => ({ cancel() {}, finish() {}, play() {}, finished: Promise.resolve(), onfinish: null, currentTime: 0, effect: null });

let cmp: Record<string, any> | null = null;
let target: HTMLElement;

async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await tick();
    await new Promise((r) => setTimeout(r, 0));
  }
  flushSync();
}
function key(el: Element, k: string, o: KeyboardEventInit = {}): KeyboardEvent {
  const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...o });
  el.dispatchEvent(ev);
  flushSync();
  return ev;
}
function spy(doc: MemoryLiveText): TextEdit[][] {
  const calls: TextEdit[][] = [];
  const apply = doc.apply.bind(doc);
  doc.apply = (e) => {
    calls.push([...e]);
    apply(e);
  };
  return calls;
}

afterEach(() => {
  if (cmp) unmount(cmp);
  cmp = null;
  target?.remove();
});

async function mountBoard(text = BOARD) {
  target = document.createElement('div');
  document.body.appendChild(target);
  const doc = memoryLiveText(text);
  const calls = spy(doc);
  cmp = mount(KanbanBoard, { target, props: { doc } });
  await settle();
  const root = target.querySelector('[data-testid="kanban-board"]')!;
  return { doc, calls, root };
}

describe('KanbanBoard keys', () => {
  it('j then J moves the card down with one delete+insert apply', async () => {
    const { doc, calls, root } = await mountBoard();
    key(root, 'J');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toHaveLength(2);
    expect(doc.read()).toContain('- [ ] beta\n- [ ] alpha\n');
    expect(doc.read().endsWith('%%')).toBe(true);
  });

  it('L moves to the next column; x toggles; dd + y deletes', async () => {
    const { doc, root } = await mountBoard();
    key(root, 'L');
    await settle();
    expect(doc.read()).toMatch(/## Done\n\n- \[ \] alpha\n- \[x\] gamma/);
    key(root, 'x');
    await settle();
    expect(doc.read()).toMatch(/- \[x\] alpha/);
    key(root, 'd');
    key(root, 'd');
    await settle();
    expect(root.querySelector('.kb-confirm')).not.toBeNull();
    key(root, 'y');
    await settle();
    expect(doc.read()).not.toContain('alpha');
  });

  it('remote edits keep the focused card', async () => {
    const { doc, root } = await mountBoard();
    key(root, 'j');
    await settle();
    expect(root.querySelector('.kb-card.focused')?.textContent).toContain('beta');
    doc.remote([{ from: 0, to: 0, insert: '## New\n\n- [ ] remote\n\n' }]);
    await settle();
    expect(root.querySelector('.kb-card.focused')?.textContent).toContain('beta');
  });

  it('leaves unowned keys (Esc, Ctrl-w) to the shell', async () => {
    const { root } = await mountBoard();
    expect(key(root, 'Escape').defaultPrevented).toBe(false);
    expect(key(root, 'w', { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(key(root, 'j').defaultPrevented).toBe(true);
  });

  it('read-only docs do not write', async () => {
    target = document.createElement('div');
    document.body.appendChild(target);
    const doc = memoryLiveText(BOARD, false);
    cmp = mount(KanbanBoard, { target, props: { doc } });
    await settle();
    const root = target.querySelector('[data-testid="kanban-board"]')!;
    key(root, 'x');
    key(root, 'J');
    expect(doc.read()).toBe(BOARD);
  });
});

describe('CanvasView keys', () => {
  async function mountCanvas() {
    target = document.createElement('div');
    document.body.appendChild(target);
    const doc = memoryLiveText(CANVAS);
    const calls = spy(doc);
    const opened: string[] = [];
    cmp = mount(CanvasView, { target, props: { doc, onopenfile: (p: string) => opened.push(p) } });
    await settle();
    const root = target.querySelector('[data-testid="canvas-view"]')!;
    return { doc, calls, root, opened };
  }

  it('Tab selects, L nudges with one minimal edit, Delete removes', async () => {
    const { doc, calls, root } = await mountCanvas();
    key(root, 'Tab');
    await settle();
    expect(root.querySelector('.cv-node.sel')?.getAttribute('data-node-id')).toBe('a');
    key(root, 'L');
    expect(calls).toHaveLength(1);
    // "x":0 → "x":20 is a single inserted character.
    expect(calls[0]).toEqual([{ from: CANVAS.indexOf('"x":0') + 4, to: CANVAS.indexOf('"x":0') + 4, insert: '2' }]);
    key(root, 'Delete');
    expect(doc.read()).not.toContain('"id":"a"');
    expect(doc.read().startsWith('{\n\t"nodes":[\n\t\t{"id":"b"')).toBe(true);
  });

  it('c then digit colors the selection; Esc clears selection, then passes through', async () => {
    const { doc, root } = await mountCanvas();
    key(root, 'Tab');
    key(root, 'Tab');
    await settle();
    key(root, 'c');
    key(root, '5');
    expect(doc.read()).toContain('"id":"b","type":"text","text":"B","x":300,"y":0,"width":200,"height":60,"color":"5"');
    expect(key(root, 'Escape').defaultPrevented).toBe(true);
    await settle();
    expect(key(root, 'Escape').defaultPrevented).toBe(false);
  });

  it('a adds a text node and opens the inline editor', async () => {
    const { doc, root } = await mountCanvas();
    key(root, 'a');
    await settle();
    expect(root.querySelector('textarea.cv-text-edit')).not.toBeNull();
    expect((doc.read().match(/"type":"text"/g) ?? []).length).toBe(3);
  });
});

// SPEC-PARTE2 §5a: Reading | Edit | Source. Reading never emits edits.
describe('Reading | Edit modes', () => {
  async function mountIn(Comp: any, text: string, testid: string, extra: Record<string, unknown> = {}) {
    target = document.createElement('div');
    document.body.appendChild(target);
    const doc = memoryLiveText(text);
    const calls = spy(doc);
    let undos = 0;
    doc.undo = () => void undos++;
    doc.redo = () => void undos++;
    const modes: string[] = [];
    const props = $state({ doc, mode: 'read' as 'read' | 'edit', onmode: (m: 'read' | 'edit') => { modes.push(m); props.mode = m; }, ...extra });
    cmp = mount(Comp, { target, props });
    await settle();
    const root = target.querySelector<HTMLElement>(`[data-testid="${testid}"]`)!;
    return { doc, calls, root, modes, props, undos: () => undos };
  }
  function dbl(el: Element): void {
    el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    flushSync();
  }

  it('canvas Reading: navigation works, nothing writes', async () => {
    const { doc, calls, root, modes, undos } = await mountIn(CanvasView, CANVAS, 'canvas-view');
    const world = root.querySelector<HTMLElement>('.cv-world')!;
    const t0 = world.style.transform;
    key(root, 'l');
    expect(world.style.transform).not.toBe(t0); // pans
    key(root, 'Tab');
    await settle();
    expect(root.querySelector('.cv-node.sel')).not.toBeNull(); // selects
    for (const k of ['a', 'f', 'd', 'x', 'Backspace', 'Delete', 'H', 'J', 'K', 'L', 'c', '1', 'u', 'Enter']) key(root, k);
    key(root, 'r', { ctrlKey: true });
    key(root, 'ArrowLeft', { shiftKey: true });
    dbl(root);
    dbl(root.querySelector('[data-node-id="a"]')!);
    await settle();
    expect(calls).toHaveLength(0);
    expect(undos()).toBe(0);
    expect(doc.read()).toBe(CANVAS);
    expect(root.querySelector('textarea')).toBeNull();
    expect(root.querySelector('[data-handle]')).toBeNull(); // no connect handles
    expect(modes).toEqual([]);
    // Keys Reading does not own reach the shell.
    expect(key(root, 'K').defaultPrevented).toBe(false);
  });

  it('canvas: i/e enter Edit, Esc with a selection clears it, then returns to Reading; ⌘E toggles', async () => {
    const { calls, root, modes } = await mountIn(CanvasView, CANVAS, 'canvas-view');
    key(root, 'i');
    await settle();
    expect(modes).toEqual(['edit']);
    key(root, 'Tab');
    key(root, 'L');
    await settle();
    expect(calls).toHaveLength(1); // Edit writes
    key(root, 'Escape'); // clears the selection first
    await settle();
    expect(modes).toEqual(['edit']);
    key(root, 'Escape');
    await settle();
    expect(modes).toEqual(['edit', 'read']);
    key(root, 'e', { metaKey: true });
    key(root, 'e', { ctrlKey: true });
    expect(modes).toEqual(['edit', 'read', 'edit', 'read']);
    key(root, 'e');
    key(root, 'q');
    expect(modes.slice(-2)).toEqual(['edit', 'read']);
  });

  it('canvas: the mode control switches modes and Source', async () => {
    let source = 0;
    const { root, modes } = await mountIn(CanvasView, CANVAS, 'canvas-view', { onsource: () => source++ });
    const seg = root.querySelector('[data-testid="canvas-mode"]')!;
    const btn = (t: string) => Array.from(seg.querySelectorAll('button')).find((b) => b.textContent === t)!;
    expect(btn('Reading').getAttribute('aria-pressed')).toBe('true');
    btn('Edit').click();
    flushSync();
    expect(modes).toEqual(['edit']);
    expect(btn('Edit').getAttribute('aria-pressed')).toBe('true');
    btn('Source').click();
    expect(source).toBe(1);
  });

  it('board Reading: j/k move the cursor, nothing writes (no toggles, moves, deletes)', async () => {
    const { doc, calls, root, modes, undos } = await mountIn(KanbanBoard, BOARD, 'kanban-board');
    key(root, 'j');
    await settle();
    expect(root.querySelector('.kb-card.focused')?.textContent).toContain('beta');
    for (const k of ['J', 'K', 'H', 'L', 'x', 'a', 'o', 'O', 'A', 'd', 'd', 'y', 'r', '<', '>', 'u', 'Enter']) key(root, k);
    key(root, 'r', { ctrlKey: true });
    root.querySelector<HTMLInputElement>('.kb-check')!.click();
    dbl(root.querySelector('.kb-card')!);
    await settle();
    expect(calls).toHaveLength(0);
    expect(undos()).toBe(0);
    expect(doc.read()).toBe(BOARD);
    expect(root.querySelector('textarea')).toBeNull();
    expect(modes).toEqual([]);
  });

  it('board: e enters Edit (writes), Esc/q return to Reading', async () => {
    const { doc, root, modes } = await mountIn(KanbanBoard, BOARD, 'kanban-board');
    key(root, 'e');
    await settle();
    expect(modes).toEqual(['edit']);
    key(root, 'J');
    await settle();
    expect(doc.read()).toContain('- [ ] beta\n- [ ] alpha\n');
    key(root, 'q');
    await settle();
    expect(modes).toEqual(['edit', 'read']);
    key(root, 'J');
    await settle();
    expect(doc.read()).toContain('- [ ] beta\n- [ ] alpha\n'); // unchanged in Reading
  });
});
