import { describe, it, expect } from 'vitest';
import { parseKanban, serializeKanban, buildKanban, isKanbanText, kanbanFormatOf } from './kanban.ts';
import { planKanban, type KanbanOp } from './kanban-edits.ts';
import { applyTextEdits, editCost } from '../text-diff.ts';
import { KanbanKeys, clampCursor } from './kanban-keys.ts';

const raw = import.meta.glob('../../test/fixtures/kanban/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const fixtures: Record<string, string> = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k.split('/').pop()!, v]));

function run(text: string, op: KanbanOp): string {
  return applyTextEdits(text, planKanban(parseKanban(text), op));
}
function titles(text: string): string[][] {
  return parseKanban(text).lanes.map((l) => [l.title, ...l.cards.map((c) => c.text)]);
}

describe('kanban parse / serialize', () => {
  for (const [name, text] of Object.entries(fixtures)) {
    it(`round-trips ${name} byte for byte`, () => {
      const b = parseKanban(text);
      expect(serializeKanban(b)).toBe(text);
      // Segments tile the text with no gap or overlap.
      let at = 0;
      for (const s of b.segments) {
        expect(s.start).toBe(at);
        at = s.end;
      }
      expect(at).toBe(text.length);
    });
  }

  it('parses lanes, cards, flags and settings (basic.md)', () => {
    const b = parseKanban(fixtures['basic.md']);
    expect(b.format).toBe('board');
    expect(b.lanes.map((l) => l.title)).toEqual(['Backlog', 'In progress', 'Done']);
    expect(b.lanes[0].cards.map((c) => c.text)).toEqual([
      'Draft the canvas spec',
      'Review #design tokens @{2026-12-01}',
      'Multi-line card\nwith a second line\nand a [[linked note]]',
    ]);
    expect(b.lanes[0].cards[2].indent).toBe('\t');
    expect(b.lanes[2].complete).toBe(true);
    expect(b.lanes[2].cards.every((c) => c.checked)).toBe(true);
    expect(b.settings?.json).toMatchObject({ 'kanban-plugin': 'board', 'lane-width': 300 });
    expect(b.text.slice(b.footerStart)).toMatch(/^%% kanban:settings/);
  });

  it('keeps the archive and intro text out of the lanes (archive.md)', () => {
    const b = parseKanban(fixtures['archive.md']);
    expect(b.format).toBe('basic');
    expect(b.lanes.map((l) => l.title)).toEqual(['To do', 'Doing', 'Done']);
    expect(b.text.slice(0, b.preambleEnd)).toContain('Some intro text');
    expect(b.text.slice(b.footerStart)).toMatch(/^\*\*\*\n\n## Archive/);
    expect(b.lanes[1].cards).toEqual([]);
  });

  it('handles CRLF, plain items, other markers and no trailing newline', () => {
    const b = parseKanban(fixtures['crlf.md']);
    expect(b.eol).toBe('\r\n');
    expect(b.lanes[0].cards.map((c) => c.text)).toEqual(['crlf card\nnested', 'done']);
    expect(b.lanes[1].cards.map((c) => [c.marker, c.hasCheckbox, c.text])).toEqual([
      ['-', false, 'plain item'],
      ['*', true, 'star marker'],
    ]);
  });

  it('body without frontmatter: nested lists and blank-line continuations', () => {
    const b = parseKanban(fixtures['body-only.md']);
    expect(b.format).toBeNull();
    expect(b.lanes.map((l) => l.title)).toEqual(['Ideas', 'Empty']);
    const c = b.lanes[0].cards[1];
    expect(c.text).toBe('card with\n  - [ ] nested subtask\n  - [x] another\n\n> quote after blank line');
  });

  it('detects boards', () => {
    expect(isKanbanText(fixtures['basic.md'])).toBe(true);
    expect(isKanbanText('# plain\n')).toBe(false);
    expect(kanbanFormatOf({ 'kanban-plugin': 'basic' })).toBe('basic');
    expect(kanbanFormatOf({ 'kanban-plugin': 'nope' })).toBeNull();
  });

  it('buildKanban writes the plugin layout and parses back', () => {
    const text = buildKanban({ lanes: [{ title: 'A', cards: [{ text: 'x' }, { text: 'two\nlines', checked: true }] }, { title: 'B', cards: [] }] });
    expect(text).toBe(
      '---\n\nkanban-plugin: board\n\n---\n\n## A\n\n- [ ] x\n- [x] two\n\tlines\n\n\n## B\n\n\n\n\n\n%% kanban:settings\n```\n{"kanban-plugin":"board"}\n```\n%%',
    );
    expect(titles(text)).toEqual([['A', 'x', 'two\nlines'], ['B']]);
  });
});

describe('kanban edit planner', () => {
  const base = fixtures['basic.md'];
  const settings = base.slice(base.indexOf('%% kanban:settings'));

  it('adds a card at a position, end, and into an empty lane', () => {
    let t = run(base, { type: 'addCard', lane: 1, index: 0, text: 'First' });
    expect(titles(t)[1]).toEqual(['In progress', 'First', 'Kanban parser']);
    t = run(base, { type: 'addCard', lane: 0, index: 99, text: 'Last' });
    expect(titles(t)[0].at(-1)).toBe('Last');
    const a = fixtures['archive.md'];
    t = run(a, { type: 'addCard', lane: 1, index: 0, text: 'Now' });
    expect(titles(t)[1]).toEqual(['Doing', 'Now']);
    expect(t).toContain('## Doing\n\n- [ ] Now\n\n## Done');
    // Into the complete lane: after the **Complete** flag.
    t = run(base, { type: 'addCard', lane: 2, index: 0, text: 'z' });
    expect(t).toContain('**Complete**\n- [ ] z\n- [x] Ship');
  });

  it('every op keeps the settings block and other lanes untouched', () => {
    const ops: KanbanOp[] = [
      { type: 'addCard', lane: 0, index: 1, text: 'n' },
      { type: 'editCard', lane: 0, card: 0, text: 'Draft the canvas SPEC' },
      { type: 'toggleCard', lane: 0, card: 1 },
      { type: 'deleteCard', lane: 0, card: 2 },
      { type: 'moveCard', lane: 0, card: 2, toLane: 2, toIndex: 1 },
      { type: 'addLane', index: 3, title: 'Later' },
      { type: 'renameLane', lane: 1, title: 'Doing' },
      { type: 'moveLane', lane: 0, toIndex: 2 },
      { type: 'deleteLane', lane: 1 },
    ];
    for (const op of ops) {
      const t = run(base, op);
      expect(t.endsWith(settings), op.type).toBe(true);
      expect(t.startsWith('---\n\nkanban-plugin: board\n\n---\n\n'), op.type).toBe(true);
      expect(serializeKanban(parseKanban(t))).toBe(t);
    }
  });

  it('edits are minimal', () => {
    const b = parseKanban(base);
    const e = planKanban(b, { type: 'editCard', lane: 0, card: 0, text: 'Draft the canvas SPEC' });
    expect(e).toEqual([{ from: b.lanes[0].cards[0].textStart + 17, to: b.lanes[0].cards[0].textStart + 21, insert: 'SPEC' }]);
    const tg = planKanban(b, { type: 'toggleCard', lane: 0, card: 0 });
    expect(editCost(tg)).toBe(2);
    expect(applyTextEdits(base, tg)).toContain('- [x] Draft the canvas spec');
    const rn = planKanban(b, { type: 'renameLane', lane: 1, title: 'In review' });
    expect(rn).toHaveLength(1);
    expect(editCost(rn)).toBeLessThanOrEqual('progress'.length + 'review'.length);
    // A move is exactly one delete of the card lines plus one insert of them.
    const mv = planKanban(b, { type: 'moveCard', lane: 0, card: 2, toLane: 1, toIndex: 1 });
    const card = b.lanes[0].cards[2];
    expect(mv).toHaveLength(2);
    expect(editCost(mv)).toBe(2 * card.raw.length);
  });

  it('edits a multi-line card, keeping its indentation', () => {
    const t = run(base, { type: 'editCard', lane: 0, card: 2, text: 'Multi-line card\nwith a 2nd line\nand a [[linked note]]\nplus one' });
    expect(t).toContain('- [ ] Multi-line card\n\twith a 2nd line\n\tand a [[linked note]]\n\tplus one\n');
    expect(titles(t)[0][3]).toBe('Multi-line card\nwith a 2nd line\nand a [[linked note]]\nplus one');
  });

  it('moves cards within and between lanes', () => {
    let t = run(base, { type: 'moveCard', lane: 0, card: 0, toLane: 0, toIndex: 2 });
    expect(titles(t)[0].slice(1, 3)).toEqual(['Review #design tokens @{2026-12-01}', 'Multi-line card\nwith a second line\nand a [[linked note]]']);
    expect(titles(t)[0][3]).toBe('Draft the canvas spec');
    t = run(base, { type: 'moveCard', lane: 0, card: 2, toLane: 2, toIndex: 2 });
    expect(titles(t)[2]).toEqual(['Done', 'Ship v0.1.0', 'Write release notes', 'Multi-line card\nwith a second line\nand a [[linked note]]']);
    t = run(base, { type: 'moveCard', lane: 1, card: 0, toLane: 0, toIndex: 0 });
    expect(titles(t)[0][1]).toBe('Kanban parser');
    expect(titles(t)[1]).toEqual(['In progress']);
    // No-op move.
    expect(planKanban(parseKanban(base), { type: 'moveCard', lane: 0, card: 1, toLane: 0, toIndex: 1 })).toEqual([]);
  });

  it('moves the last card of a file without a trailing newline', () => {
    const t0 = fixtures['crlf.md'];
    let t = run(t0, { type: 'moveCard', lane: 1, card: 1, toLane: 0, toIndex: 0 });
    expect(titles(t)).toEqual([['A', 'star marker', 'crlf card\nnested', 'done'], ['B', 'plain item']]);
    expect(t.includes('\n') && !/[^\r]\n/.test(t)).toBe(true); // CRLF kept
    t = run(t0, { type: 'moveCard', lane: 0, card: 0, toLane: 1, toIndex: 2 });
    expect(titles(t)[1]).toEqual(['B', 'plain item', 'star marker', 'crlf card\nnested']);
    t = run(t0, { type: 'deleteCard', lane: 1, card: 1 });
    expect(t.endsWith('- plain item')).toBe(true);
  });

  it('toggles a checkbox-less item by adding one', () => {
    const t = run(fixtures['crlf.md'], { type: 'toggleCard', lane: 1, card: 0 });
    expect(t).toContain('- [x] plain item');
  });

  it('adds, renames, moves and deletes lanes', () => {
    let t = run(base, { type: 'addLane', index: 3, title: 'Later' });
    expect(titles(t).map((l) => l[0])).toEqual(['Backlog', 'In progress', 'Done', 'Later']);
    t = run(base, { type: 'addLane', index: 0, title: 'Inbox' });
    expect(titles(t).map((l) => l[0])).toEqual(['Inbox', 'Backlog', 'In progress', 'Done']);
    t = run(base, { type: 'moveLane', lane: 2, toIndex: 0 });
    expect(titles(t).map((l) => l[0])).toEqual(['Done', 'Backlog', 'In progress']);
    expect(titles(t)[0]).toEqual(['Done', 'Ship v0.1.0', 'Write release notes']);
    t = run(base, { type: 'moveLane', lane: 0, toIndex: 2 });
    expect(titles(t).map((l) => l[0])).toEqual(['In progress', 'Done', 'Backlog']);
    expect(titles(t)[2]).toHaveLength(4);
    t = run(base, { type: 'deleteLane', lane: 1 });
    expect(titles(t).map((l) => l[0])).toEqual(['Backlog', 'Done']);
    t = run(fixtures['body-only.md'], { type: 'addLane', index: 9, title: 'Z' });
    expect(titles(t).map((l) => l[0])).toEqual(['Ideas', 'Empty', 'Z']);
    t = run('', { type: 'addLane', index: 0, title: 'First' });
    expect(t).toBe('## First\n\n');
    t = run(t, { type: 'addCard', lane: 0, index: 0, text: 'c' });
    expect(titles(t)).toEqual([['First', 'c']]);
  });

  it('a long sequence of random ops always keeps the board parseable', () => {
    let t = base;
    let seed = 7;
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return n > 0 ? seed % n : 0;
    };
    for (let i = 0; i < 300; i++) {
      const b = parseKanban(t);
      const L = b.lanes.length;
      const lane = rnd(L);
      const n = L ? b.lanes[lane].cards.length : 0;
      const pick = rnd(6);
      let op: KanbanOp;
      if (!L || pick === 0) op = { type: 'addLane', index: rnd(L + 1), title: `L${i}` };
      else if (pick === 1 || !n) op = { type: 'addCard', lane, index: rnd(n + 1), text: `c${i}` };
      else if (pick === 2) op = { type: 'moveCard', lane, card: rnd(n), toLane: rnd(L), toIndex: rnd(n + 1) };
      else if (pick === 3) op = { type: 'deleteCard', lane, card: rnd(n) };
      else if (pick === 4) op = { type: 'moveLane', lane, toIndex: rnd(L) };
      else op = { type: 'toggleCard', lane, card: rnd(n) };
      const before = titles(t).flat().filter((x) => /^c\d/.test(x)).sort();
      const next = run(t, op);
      expect(serializeKanban(parseKanban(next))).toBe(next);
      expect(next.endsWith(settings)).toBe(true);
      if (op.type === 'moveCard' || op.type === 'moveLane' || op.type === 'toggleCard') {
        expect(titles(next).flat().filter((x) => /^c\d/.test(x)).sort()).toEqual(before);
      }
      t = next;
    }
  });
});

describe('kanban keys', () => {
  const shape = [3, 0, 2];
  const k = new KanbanKeys();
  const at = (lane: number, card: number) => ({ lane, card });

  it('moves the cursor and clamps', () => {
    expect(k.feed({ key: 'j' }, at(0, 0), shape)).toEqual({ kind: 'cursor', cursor: at(0, 1) });
    expect(k.feed({ key: 'k' }, at(0, 0), shape)).toEqual({ kind: 'cursor', cursor: at(0, 0) });
    expect(k.feed({ key: 'l' }, at(0, 2), shape)).toEqual({ kind: 'cursor', cursor: at(1, -1) });
    expect(k.feed({ key: 'l' }, at(1, -1), shape)).toEqual({ kind: 'cursor', cursor: at(2, 0) });
    expect(k.feed({ key: 'G' }, at(0, 0), shape)).toEqual({ kind: 'cursor', cursor: at(0, 2) });
    expect(k.feed({ key: 'g' }, at(0, 2), shape)).toBeNull();
    expect(k.feed({ key: 'g' }, at(0, 2), shape)).toEqual({ kind: 'cursor', cursor: at(0, 0) });
    expect(clampCursor(at(9, 9), shape)).toEqual(at(2, 1));
  });

  it('moves cards with H/L/J/K', () => {
    expect(k.feed({ key: 'L' }, at(0, 2), shape)).toEqual({ kind: 'moveCard', toLane: 1, toIndex: 0 });
    expect(k.feed({ key: 'H' }, at(0, 2), shape)).toBeNull();
    expect(k.feed({ key: 'J' }, at(0, 0), shape)).toEqual({ kind: 'moveCard', toLane: 0, toIndex: 1 });
    expect(k.feed({ key: 'J' }, at(0, 2), shape)).toBeNull();
    expect(k.feed({ key: 'K' }, at(2, 1), shape)).toEqual({ kind: 'moveCard', toLane: 2, toIndex: 0 });
  });

  it('creates, edits, toggles and deletes (dd)', () => {
    expect(k.feed({ key: 'a' }, at(0, 0), shape)).toEqual({ kind: 'newCard', lane: 0, index: 3 });
    expect(k.feed({ key: 'o' }, at(0, 0), shape)).toEqual({ kind: 'newCard', lane: 0, index: 1 });
    expect(k.feed({ key: 'O' }, at(0, 1), shape)).toEqual({ kind: 'newCard', lane: 0, index: 1 });
    expect(k.feed({ key: 'o' }, at(1, -1), shape)).toEqual({ kind: 'newCard', lane: 1, index: 0 });
    expect(k.feed({ key: 'A' }, at(0, 0), shape)).toEqual({ kind: 'newLane' });
    expect(k.feed({ key: 'Enter' }, at(0, 0), shape)).toEqual({ kind: 'edit' });
    expect(k.feed({ key: 'i' }, at(1, -1), shape)).toBeNull();
    expect(k.feed({ key: 'x' }, at(0, 0), shape)).toEqual({ kind: 'toggle' });
    expect(k.feed({ key: 'd' }, at(0, 0), shape)).toBeNull();
    expect(k.pending).toBe('d');
    expect(k.feed({ key: 'd' }, at(0, 0), shape)).toEqual({ kind: 'delete' });
    k.feed({ key: 'd' }, at(0, 0), shape);
    expect(k.feed({ key: 'j' }, at(0, 0), shape)).toBeNull();
    expect(k.feed({ key: '/' }, at(0, 0), shape)).toEqual({ kind: 'filter' });
    expect(k.feed({ key: '>' }, at(0, 0), shape)).toEqual({ kind: 'moveLane', toIndex: 1 });
    expect(k.feed({ key: 'r', ctrlKey: true }, at(0, 0), shape)).toEqual({ kind: 'redo' });
    expect(k.feed({ key: 'j', metaKey: true }, at(0, 0), shape)).toBeNull();
  });
});
