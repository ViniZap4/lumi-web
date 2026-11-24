// Kanban edit planner: board operations → minimal ranged text edits.
//
// Pure: takes a parsed board (kanban.ts) and an operation, returns
// disjoint TextEdits in the coordinates of `board.text`. The caller
// applies them right to left in ONE transaction (LiveText.apply), so a
// move is a delete plus an insert in the same Yjs transaction
// (SPEC-PARTE2 §5). Nothing outside the touched card/lane changes, so
// the settings block and unknown content survive byte for byte.

import { cardLines, type KanbanBoard, type KanbanCard, type KanbanLane } from './kanban.ts';
import { diffRange, type TextEdit } from '../text-diff.ts';

export type KanbanOp =
  | { type: 'addCard'; lane: number; index: number; text: string; checked?: boolean }
  | { type: 'editCard'; lane: number; card: number; text: string }
  | { type: 'toggleCard'; lane: number; card: number }
  | { type: 'deleteCard'; lane: number; card: number }
  /** `toIndex` counts positions in the target lane with the card removed. */
  | { type: 'moveCard'; lane: number; card: number; toLane: number; toIndex: number }
  | { type: 'addLane'; index: number; title: string }
  | { type: 'renameLane'; lane: number; title: string }
  | { type: 'deleteLane'; lane: number }
  /** `toIndex` counts positions with the lane removed. */
  | { type: 'moveLane'; lane: number; toIndex: number };

function oneLine(s: string): string {
  return s.replace(/[\r\n]+/g, ' ').trim();
}

/** Card lines without their trailing line break. */
function cardBody(board: KanbanBoard, c: KanbanCard): string {
  return board.text.slice(c.start, c.textEnd);
}

/** Range that removes a card, line break included (EOF cards eat the previous break). */
function cardDeleteRange(board: KanbanBoard, c: KanbanCard): { from: number; to: number } {
  if (c.end > c.textEnd) return { from: c.start, to: c.end };
  const t = board.text;
  let from = c.start;
  if (from > 0 && t[from - 1] === '\n') from -= from > 1 && t[from - 2] === '\r' ? 2 : 1;
  return { from, to: c.end };
}

/**
 * Where a card line goes for (lane, index). `skip` is ignored when
 * counting (the card being moved). Returns the offset and the text to
 * wrap the card body with.
 */
function cardInsertion(
  board: KanbanBoard,
  lane: KanbanLane,
  index: number,
  skip: KanbanCard | null,
): { at: number; before: string; after: string } {
  const eol = board.eol;
  const t = board.text;
  const list = lane.cards.filter((c) => c !== skip);
  const i = Math.max(0, Math.min(index, list.length));
  if (i < list.length) return { at: list[i].start, before: '', after: eol };
  if (list.length) {
    const last = list[list.length - 1];
    if (last.end > last.textEnd) return { at: last.end, before: '', after: eol };
    return { at: last.end, before: eol, after: '' };
  }
  // Empty lane: after the heading, one blank line and the **Complete** flag.
  let at = lane.headingEnd;
  if (at === lane.start || (at === t.length && !t.endsWith('\n'))) {
    // Heading is the last line, without a break.
    return { at: t.length, before: eol + eol, after: '' };
  }
  const lineAt = (p: number) => {
    const nl = t.indexOf('\n', p);
    const end = nl < 0 ? t.length : nl + 1;
    return { s: t.slice(p, nl < 0 ? t.length : nl).replace(/\r$/, ''), end };
  };
  let blank = false;
  if (at < lane.end) {
    const l = lineAt(at);
    if (/^[ \t]*$/.test(l.s)) {
      blank = true;
      at = l.end;
    }
  }
  if (at < lane.end) {
    const l = lineAt(at);
    if (/^\*\*Complete\*\*[ \t]*$/.test(l.s)) at = l.end;
  }
  const atEOFNoBreak = at === t.length && t.length > 0 && !t.endsWith('\n');
  return { at, before: (atEOFNoBreak ? eol : '') + (blank ? '' : eol), after: atEOFNoBreak ? '' : eol };
}

/** Where a lane goes for `index` (with `skip` removed). */
function laneInsertion(board: KanbanBoard, index: number, skip: KanbanLane | null): { at: number; prefix: string } {
  const list = board.lanes.filter((l) => l !== skip);
  const i = Math.max(0, Math.min(index, list.length));
  if (i < list.length) return { at: list[i].start, prefix: '' };
  const at = list.length ? list[list.length - 1].end : board.preambleEnd;
  const before = board.text.slice(0, at);
  const eol = board.eol;
  const prefix = before === '' || before.endsWith(eol + eol) ? '' : before.endsWith('\n') ? eol : eol + eol;
  return { at, prefix };
}

/** Lane text normalized to end with a blank line (for re-insertion). */
function laneBlock(board: KanbanBoard, lane: KanbanLane): string {
  const eol = board.eol;
  let raw = board.text.slice(lane.start, lane.end);
  if (!raw.endsWith('\n')) raw += eol;
  if (!raw.endsWith(eol + eol)) raw += eol;
  return raw;
}

export function planKanban(board: KanbanBoard, op: KanbanOp): TextEdit[] {
  const lane = 'lane' in op ? board.lanes[op.lane] : undefined;
  const card = lane && 'card' in op ? lane.cards[op.card] : undefined;
  const eol = board.eol;

  switch (op.type) {
    case 'addCard': {
      if (!lane) return [];
      const ins = cardInsertion(board, lane, op.index, null);
      const body = cardLines(op.text.trimEnd(), !!op.checked, board.marker, board.indent, eol);
      return [{ from: ins.at, to: ins.at, insert: ins.before + body + ins.after }];
    }
    case 'editCard': {
      if (!card) return [];
      const [first, ...rest] = op.text.replace(/\r\n?/g, '\n').replace(/\s+$/, '').split('\n');
      const ind = card.indent || board.indent;
      const next = [first, ...rest.map((r) => (r === '' ? ind : ind + r))].join(eol);
      const e = diffRange(board.text.slice(card.textStart, card.textEnd), next, card.textStart);
      return e ? [e] : [];
    }
    case 'toggleCard': {
      if (!card) return [];
      if (card.hasCheckbox) {
        return [{ from: card.checkOffset, to: card.checkOffset + 1, insert: card.checked ? ' ' : 'x' }];
      }
      return [{ from: card.textStart, to: card.textStart, insert: '[x] ' }];
    }
    case 'deleteCard': {
      if (!card) return [];
      const r = cardDeleteRange(board, card);
      return [{ from: r.from, to: r.to, insert: '' }];
    }
    case 'moveCard': {
      const to = board.lanes[op.toLane];
      if (!card || !lane || !to) return [];
      if (op.toLane === op.lane && op.toIndex === op.card) return [];
      const ins = cardInsertion(board, to, op.toIndex, card);
      const del = cardDeleteRange(board, card);
      // Same place after all (adjacent slot in the same lane).
      if (to === lane && ins.at >= del.from && ins.at <= del.to) return [];
      return [
        { from: del.from, to: del.to, insert: '' },
        { from: ins.at, to: ins.at, insert: ins.before + cardBody(board, card) + ins.after },
      ];
    }
    case 'addLane': {
      const title = oneLine(op.title);
      const ins = laneInsertion(board, op.index, null);
      const tail = ins.at < board.text.length ? eol + eol + eol : eol + eol;
      return [{ from: ins.at, to: ins.at, insert: ins.prefix + `## ${title}` + tail }];
    }
    case 'renameLane': {
      if (!lane) return [];
      const title = oneLine(op.title);
      if (lane.title === '' && lane.titleStart === lane.titleEnd) {
        // `##` with no text: add the separating space too.
        return [{ from: lane.titleStart, to: lane.titleEnd, insert: title ? ' ' + title : '' }];
      }
      const e = diffRange(lane.title, title, lane.titleStart);
      return e ? [e] : [];
    }
    case 'deleteLane': {
      if (!lane) return [];
      return [{ from: lane.start, to: lane.end, insert: '' }];
    }
    case 'moveLane': {
      if (!lane) return [];
      if (op.toIndex === op.lane) return [];
      const ins = laneInsertion(board, op.toIndex, lane);
      if (ins.at === lane.start) return [];
      return [
        { from: lane.start, to: lane.end, insert: '' },
        { from: ins.at, to: ins.at, insert: ins.prefix + laneBlock(board, lane) },
      ];
    }
  }
}
