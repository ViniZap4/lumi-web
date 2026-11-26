// Property tests for the kanban parser and planner (Phase 3 quality
// harness, docs/phase3/research/09 Q6). fast-check generates board-shaped
// text from line fragments (plus fully random strings) and checks the
// contracts the CRDT layer relies on: a lossless parse, offsets that
// point at what they claim, and planned edits that are disjoint, in
// range and minimal for toggles and moves.
//
// FC_RUNS raises the run count (the nightly job sets it); the default
// keeps `npm test` fast.
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { parseKanban, serializeKanban, type KanbanBoard } from './kanban.ts';
import { planKanban, type KanbanOp } from './kanban-edits.ts';
import { applyTextEdits, assertDisjoint } from '../text-diff.ts';

const RUNS = Number((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.FC_RUNS || 300);
// Generous per-test timeout so long nightly runs are not cut short.
const TIMEOUT = Math.max(5_000, RUNS * 5);

const fragment = fc.constantFrom(
  '---',
  'kanban-plugin: board',
  'kanban-plugin: basic',
  '...',
  '## Todo',
  '## Feito ✅',
  '##',
  '## ',
  '- [ ] card',
  '- [x] done card',
  '* [ ] star',
  '+ plain item',
  '- [ ]',
  '- [X] upper',
  '-  [ ] two spaces',
  '\tcontinued line',
  '  indented',
  '**Complete**',
  '***',
  '## Archive',
  '%% kanban:settings',
  '```',
  '{"kanban-plugin":"board"}',
  '%%',
  '',
  ' ',
  'paragraph text',
  'emoji 😀 line',
  '- [ ] ação com acento',
);

/** Board-shaped text: fragments joined by LF or CRLF, optional final break. */
const boardText = fc
  .tuple(fc.array(fragment, { maxLength: 30 }), fc.constantFrom('\n', '\r\n'), fc.boolean(), fc.boolean())
  .map(([lines, eol, final, mixed]) => {
    let s = '';
    lines.forEach((l, i) => {
      s += l;
      if (i < lines.length - 1 || final) s += mixed && i % 3 === 1 ? '\n' : eol;
    });
    return s;
  });

const anyText = fc.oneof(boardText, fc.string({ maxLength: 200 }), fc.string({ unit: 'grapheme', maxLength: 80 }));

function checkStructure(text: string, b: KanbanBoard): void {
  // Segments partition the text exactly.
  let at = 0;
  for (const s of b.segments) {
    expect(s.start).toBe(at);
    expect(s.end).toBeGreaterThan(s.start);
    at = s.end;
  }
  expect(at).toBe(text.length);
  let prev = b.preambleEnd;
  for (const lane of b.lanes) {
    expect(lane.start).toBeGreaterThanOrEqual(prev);
    expect(lane.start).toBeLessThanOrEqual(lane.titleStart);
    expect(lane.titleStart).toBeLessThanOrEqual(lane.titleEnd);
    expect(lane.titleEnd).toBeLessThanOrEqual(lane.headingEnd);
    expect(lane.headingEnd).toBeLessThanOrEqual(lane.end);
    expect(lane.end).toBeLessThanOrEqual(b.footerStart);
    expect(text.slice(lane.titleStart, lane.titleEnd)).toBe(lane.title);
    let cprev = lane.headingEnd;
    for (const c of lane.cards) {
      expect(c.start).toBeGreaterThanOrEqual(cprev);
      expect(c.start).toBeLessThanOrEqual(c.textStart);
      expect(c.textStart).toBeLessThanOrEqual(c.textEnd);
      expect(c.textEnd).toBeLessThanOrEqual(c.end);
      expect(c.end).toBeLessThanOrEqual(lane.end);
      expect(text.slice(c.start, c.end)).toBe(c.raw);
      if (c.hasCheckbox) {
        expect(text[c.checkOffset]).toBe(c.checkChar);
        expect(c.checkOffset).toBeLessThan(c.textStart);
      }
      cprev = c.end;
    }
    prev = lane.end;
  }
  expect(b.footerStart).toBeLessThanOrEqual(text.length);
}

const cardCount = (b: KanbanBoard) => b.lanes.reduce((n, l) => n + l.cards.length, 0);
const cardTexts = (b: KanbanBoard) =>
  b.lanes
    .flatMap((l) => l.cards.map((c) => c.text))
    .sort()
    .join('\u0000');

const opArb: fc.Arbitrary<KanbanOp> = fc.oneof(
  fc.record({ type: fc.constant('toggleCard' as const), lane: fc.nat(4), card: fc.nat(4) }),
  fc.record({ type: fc.constant('moveCard' as const), lane: fc.nat(4), card: fc.nat(4), toLane: fc.nat(4), toIndex: fc.nat(5) }),
  fc.record({ type: fc.constant('addCard' as const), lane: fc.nat(4), index: fc.nat(5), text: fc.string({ maxLength: 20 }) }),
  fc.record({ type: fc.constant('editCard' as const), lane: fc.nat(4), card: fc.nat(4), text: fc.string({ maxLength: 30 }) }),
  fc.record({ type: fc.constant('deleteCard' as const), lane: fc.nat(4), card: fc.nat(4) }),
  fc.record({ type: fc.constant('addLane' as const), index: fc.nat(4), title: fc.string({ maxLength: 12 }) }),
  fc.record({ type: fc.constant('renameLane' as const), lane: fc.nat(4), title: fc.string({ maxLength: 12 }) }),
  fc.record({ type: fc.constant('deleteLane' as const), lane: fc.nat(4) }),
  fc.record({ type: fc.constant('moveLane' as const), lane: fc.nat(4), toIndex: fc.nat(4) }),
);

describe('kanban properties', () => {
  it('parse is lossless and its offsets are exact, for any text', () => {
    fc.assert(
      fc.property(anyText, (text) => {
        const b = parseKanban(text);
        expect(serializeKanban(b)).toBe(text);
        checkStructure(text, b);
      }),
      { numRuns: RUNS },
    );
  }, TIMEOUT);

  it('planned edits are disjoint and in range for every op', () => {
    fc.assert(
      fc.property(boardText, opArb, (text, op) => {
        const edits = planKanban(parseKanban(text), op);
        assertDisjoint(edits);
        for (const e of edits) {
          expect(e.from).toBeGreaterThanOrEqual(0);
          expect(e.from).toBeLessThanOrEqual(e.to);
          expect(e.to).toBeLessThanOrEqual(text.length);
        }
        // Re-parsing the result is still lossless.
        const out = applyTextEdits(text, edits);
        expect(serializeKanban(parseKanban(out))).toBe(out);
      }),
      { numRuns: RUNS },
    );
  }, TIMEOUT);

  it('toggle is a one-character edit and keeps every card', () => {
    fc.assert(
      fc.property(boardText, fc.nat(4), fc.nat(4), (text, lane, card) => {
        const b = parseKanban(text);
        const c = b.lanes[lane]?.cards[card];
        const edits = planKanban(b, { type: 'toggleCard', lane, card });
        if (!c) {
          expect(edits).toEqual([]);
          return;
        }
        if (c.hasCheckbox) {
          expect(edits).toHaveLength(1);
          expect(edits[0].to - edits[0].from).toBe(1);
          expect(edits[0].insert).toHaveLength(1);
        }
        const after = parseKanban(applyTextEdits(text, edits));
        expect(cardCount(after)).toBe(cardCount(b));
        expect(after.lanes[lane].cards[card].checked).toBe(!c.checked || !c.hasCheckbox);
      }),
      { numRuns: RUNS },
    );
  }, TIMEOUT);

  it('move is one delete plus one insert and keeps the same cards', () => {
    fc.assert(
      fc.property(boardText, fc.nat(4), fc.nat(4), fc.nat(4), fc.nat(5), (text, lane, card, toLane, toIndex) => {
        const b = parseKanban(text);
        const edits = planKanban(b, { type: 'moveCard', lane, card, toLane, toIndex });
        expect([0, 2]).toContain(edits.length);
        if (!edits.length) return;
        expect(edits[0].insert).toBe('');
        expect(edits[1].from).toBe(edits[1].to);
        const after = parseKanban(applyTextEdits(text, edits));
        expect(cardCount(after)).toBe(cardCount(b));
        expect(cardTexts(after)).toBe(cardTexts(b));
      }),
      { numRuns: RUNS },
    );
  }, TIMEOUT);
});

describe('kanban property regressions', () => {
  // Shrunk counterexamples: an empty lane whose heading is followed by
  // indented lines with no card above them. The inserted card used to
  // absorb them as its continuation lines.
  const cases: [string, KanbanOp, string][] = [
    ['## A\n+ plain item\n## B\n  indented', { type: 'moveCard', lane: 0, card: 0, toLane: 1, toIndex: 0 }, 'plain item'],
    ['## A\n\tcontinued line\n+ plain item', { type: 'moveCard', lane: 0, card: 0, toLane: 0, toIndex: 1 }, 'plain item'],
    ['## A\n\n\torphan\n\n\tmore\ntext\n', { type: 'addCard', lane: 0, index: 0, text: 'novo' }, 'novo'],
  ];
  for (const [text, op, want] of cases) {
    it(`${op.type} keeps the card text (${JSON.stringify(text)})`, () => {
      const out = applyTextEdits(text, planKanban(parseKanban(text), op));
      const after = parseKanban(out);
      expect(after.lanes.flatMap((l) => l.cards.map((c) => c.text))).toContain(want);
      expect(serializeKanban(after)).toBe(out);
    });
  }
});
