import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { yLiveText, ORIGIN_STRUCTURED } from './live-text-y.ts';
import { memoryLiveText } from './live-text.ts';
import { noteViewKind } from './note-kind.ts';
import { parseKanban } from './kanban/kanban.ts';
import { planKanban } from './kanban/kanban-edits.ts';

const BOARD = '## A\n\n- [ ] one\n- [ ] two\n\n## B\n\n- [ ] three\n';

describe('noteViewKind', () => {
  it('routes by DTO kind, extension and kanban frontmatter', () => {
    expect(noteViewKind({ path: 'x.canvas' })).toBe('canvas');
    expect(noteViewKind({ path: 'x.md', kind: 'canvas' })).toBe('canvas');
    expect(noteViewKind({ path: 'x.canvas', kind: 'markdown' })).toBe('markdown');
    expect(noteViewKind({ path: 'b.md', frontmatter: { 'kanban-plugin': 'board' } })).toBe('kanban');
    expect(noteViewKind({ path: 'b.md', text: '---\nkanban-plugin: basic\n---\n## A\n' })).toBe('kanban');
    expect(noteViewKind({ path: 'n.md', frontmatter: { title: 'x' } })).toBe('markdown');
    expect(noteViewKind(null)).toBe('markdown');
  });
});

describe('yLiveText', () => {
  function setup() {
    const doc = new Y.Doc();
    const ytext = doc.getText('content');
    ytext.insert(0, BOARD);
    const um = new Y.UndoManager(ytext);
    const lt = yLiveText(ytext, { undoManager: um });
    return { doc, ytext, um, lt };
  }

  it('a card move is one transaction holding a delete and an insert', () => {
    const { doc, ytext, lt } = setup();
    const txs: Y.Transaction[] = [];
    doc.on('afterTransaction', (tr: Y.Transaction) => txs.push(tr));
    const updates: Uint8Array[] = [];
    doc.on('update', (u: Uint8Array) => updates.push(u));
    lt.apply(planKanban(parseKanban(lt.read()), { type: 'moveCard', lane: 0, card: 0, toLane: 1, toIndex: 1 }));
    expect(txs).toHaveLength(1);
    expect(txs[0].origin).toBe(ORIGIN_STRUCTURED);
    expect(updates).toHaveLength(1);
    expect(ytext.toString()).toBe('## A\n\n- [ ] two\n\n## B\n\n- [ ] three\n- [ ] one\n');
  });

  it('reports remote vs local and keeps anchors sticky; undo works', () => {
    const { doc, ytext, lt } = setup();
    const seen: boolean[] = [];
    lt.subscribe((remote) => seen.push(remote));
    const at = lt.anchor(BOARD.indexOf('two'));
    // Remote peer prepends a line.
    const peer = new Y.Doc();
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc));
    peer.getText('content').insert(0, '# Title\n\n');
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(peer, Y.encodeStateVector(doc)), 'provider');
    expect(seen).toEqual([true]);
    expect(ytext.toString().slice(at()!, at()! + 3)).toBe('two');
    lt.apply([{ from: 0, to: 1, insert: '##' }]);
    expect(seen).toEqual([true, false]);
    lt.undo!();
    expect(ytext.toString().startsWith('# Title')).toBe(true);
    expect(seen.at(-1)).toBe(false);
  });

  it('honours editable()', () => {
    const doc = new Y.Doc();
    const t = doc.getText('content');
    const lt = yLiveText(t, { editable: () => false });
    lt.apply([{ from: 0, to: 0, insert: 'x' }]);
    expect(t.toString()).toBe('');
  });
});

describe('memoryLiveText', () => {
  it('maps anchors through edits and supports undo/redo', () => {
    const lt = memoryLiveText('abcdef');
    const a = lt.anchor(3);
    lt.apply([{ from: 0, to: 0, insert: 'XX' }]);
    expect(a()).toBe(5);
    lt.remote([{ from: 1, to: 2, insert: '' }]);
    expect(lt.read()).toBe('Xabcdef');
    // Snapshot undo (test/preview helper only; the Yjs impl uses the UndoManager).
    lt.undo!();
    expect(lt.read()).toBe('abcdef');
    lt.redo!();
    expect(lt.read()).toBe('Xabcdef');
  });
});
