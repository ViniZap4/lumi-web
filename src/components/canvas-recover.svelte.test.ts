// @vitest-environment jsdom
//
// The canvas "JSON inválido" banner: pt-BR message with the error
// position, "Abrir Source" at the error line, "Restaurar última versão
// válida" (ONE minimal ranged edit, undoable) and, for two concatenated
// documents, "Manter a versão mais recente".

import { describe, it, expect, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync, tick } from 'svelte';
import CanvasView from './canvas/CanvasView.svelte';
import { memoryLiveText, type MemoryLiveText } from '../lib/live-text.ts';
import { diffRange, type TextEdit } from '../lib/text-diff.ts';

let target: HTMLElement;
let cmp: Record<string, any> | null = null;

async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await Promise.resolve();
    await tick();
  }
  flushSync();
}

const A = '{\n\t"nodes":[\n\t\t{"id":"a","type":"text","text":"A","x":0,"y":0,"width":200,"height":60}\n\t],\n\t"edges":[]\n}\n';
const B = '{\n\t"nodes":[\n\t\t{"id":"b","type":"text","text":"B","x":0,"y":0,"width":200,"height":60}\n\t],\n\t"edges":[]\n}';

function setup(initial: string, onsource = vi.fn()): { doc: MemoryLiveText; applied: TextEdit[][]; onsource: typeof onsource } {
  target = document.createElement('div');
  document.body.appendChild(target);
  const doc = memoryLiveText(initial);
  const applied: TextEdit[][] = [];
  const apply = doc.apply.bind(doc);
  doc.apply = (edits) => {
    applied.push([...edits]);
    apply(edits);
  };
  cmp = mount(CanvasView, { target, props: { doc, onsource, memoKey: `t/${Math.random()}`, autofocus: false } });
  flushSync();
  return { doc, applied, onsource };
}
const q = (id: string) => target.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`);
/** Replace the whole text as a remote peer would (the corruption). */
function corrupt(doc: MemoryLiveText, next: string): void {
  doc.remote([diffRange(doc.read(), next)!]);
}

afterEach(() => {
  if (cmp) unmount(cmp);
  cmp = null;
  target?.remove();
});

describe('canvas invalid-JSON banner', () => {
  it('explains the error in pt-BR with its position; Abrir Source goes to the line', async () => {
    const { doc, onsource } = setup(A);
    corrupt(doc, A.replace('"text":"A"', '"text":"A" "x"'));
    await settle();
    const banner = q('canvas-invalid')!;
    expect(banner.textContent).toContain('JSON inválido');
    expect(banner.textContent).toContain('(linha 3, coluna 38)');
    expect(banner.textContent).toContain('Mostrando a última versão válida');
    q('canvas-open-source')!.click();
    expect(onsource).toHaveBeenCalledWith({ line: 3 });
    // Not two documents → no "keep the newer" choice.
    expect(q('canvas-keep-newer')).toBeNull();
  });

  it('two cards with no comma between them (concurrent first cards) show no banner', async () => {
    const { doc } = setup(A);
    corrupt(doc, A.replace('}\n\t],', '}\n\t\t{"id":"z","type":"text","text":"Z","x":0,"y":0,"width":200,"height":60}\n\t],'));
    await settle();
    expect(q('canvas-invalid')).toBeNull();
    expect(target.querySelectorAll('.cv-node').length).toBe(2);
  });

  it('Restaurar última versão válida writes ONE minimal ranged edit, and u undoes it', async () => {
    const { doc, applied } = setup(A);
    const broken = A.replace('"text":"A"', '"text":"A",,');
    corrupt(doc, broken);
    await settle();
    q('canvas-restore')!.click();
    await settle();
    expect(doc.read()).toBe(A);
    expect(applied).toHaveLength(1);
    expect(applied[0]).toEqual([diffRange(broken, A)]);
    expect(applied[0][0].to - applied[0][0].from).toBe(2); // only the ",," goes
    expect(q('canvas-invalid')).toBeNull();
    doc.undo!();
    await settle();
    expect(doc.read()).toBe(broken);
  });

  it('two concatenated documents: Manter a versão mais recente keeps the one that is not the last valid text', async () => {
    const { doc, applied } = setup(A);
    // A peer's whole document landed after ours at the same time.
    corrupt(doc, A + B);
    await settle();
    expect(q('canvas-invalid')!.textContent).toContain('dois canvases seguidos');
    q('canvas-keep-newer')!.click();
    await settle();
    expect(doc.read()).toBe(B); // the file's (lack of a) trailing newline is kept
    expect(applied).toHaveLength(1);
    expect(applied[0]).toHaveLength(1);
    expect(q('canvas-invalid')).toBeNull();
  });

  it('read-only doc: no write actions, Source still offered', async () => {
    target = document.createElement('div');
    document.body.appendChild(target);
    const doc = memoryLiveText(A + B, false);
    cmp = mount(CanvasView, { target, props: { doc, onsource: () => {}, autofocus: false } });
    await settle();
    expect(q('canvas-invalid')).not.toBeNull();
    expect(q('canvas-open-source')).not.toBeNull();
    expect(q('canvas-restore')).toBeNull();
    expect(q('canvas-keep-newer')).toBeNull();
  });
});
