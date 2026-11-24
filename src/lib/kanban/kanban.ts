// Obsidian Kanban board format: parser + serializer (SPEC-PARTE2 §5).
//
// The parse is lossless: every byte of the input belongs to exactly one
// segment (preamble, lane heading, card, gap, footer), so serializing
// the segments reproduces the input byte for byte. Edits are never made
// by re-serializing a model; kanban-edits.ts plans ranged text edits
// from the offsets recorded here.
//
// Format (as written by the obsidian-kanban plugin):
//
//   ---                         frontmatter, `kanban-plugin: board|basic`
//
//   kanban-plugin: board
//
//   ---
//
//   ## Todo                     a lane: `## ` heading (level 2 exactly)
//
//   - [ ] Card                  a card: top-level list item; `[ ]`/`[x]`
//   	continued line            indented lines belong to the card
//   **Complete**                lane flag line (kept as a gap)
//
//   ***                         archive divider: footer starts here
//   ## Archive
//
//   %% kanban:settings          plugin settings: footer (never touched)
//   ```
//   {"kanban-plugin":"board"}
//   ```
//   %%
//
// Anything else (paragraphs, comments) is a gap and kept verbatim.
// The text may be a full file (with frontmatter) or a note body as the
// server's CRDT holds it (frontmatter stripped); both parse the same.
// Offsets are UTF-16 code units.

export type KanbanFormat = 'board' | 'basic';

export interface KanbanCard {
  /** Index in its lane. */
  index: number;
  lane: number;
  /** [start, end) of the card's lines, trailing line break included. */
  start: number;
  end: number;
  raw: string;
  /** List marker: `-`, `*` or `+`. */
  marker: string;
  hasCheckbox: boolean;
  /** Absolute offset of the checkbox character, or -1. */
  checkOffset: number;
  checkChar: string;
  checked: boolean;
  /** [textStart, textEnd): the card content (no marker, no trailing EOL). */
  textStart: number;
  textEnd: number;
  /** Content with continuation indentation removed, lines joined by `\n`. */
  text: string;
  /** Indentation of continuation lines (common prefix), '' if single line. */
  indent: string;
}

export interface KanbanLane {
  index: number;
  title: string;
  /** [start, end): heading line through the line before the next lane/footer. */
  start: number;
  end: number;
  headingEnd: number;
  titleStart: number;
  titleEnd: number;
  /** Lane carries the plugin's `**Complete**` flag. */
  complete: boolean;
  cards: KanbanCard[];
}

export type SegmentKind = 'preamble' | 'heading' | 'card' | 'gap' | 'footer';
export interface Segment {
  kind: SegmentKind;
  start: number;
  end: number;
}

export interface KanbanBoard {
  text: string;
  /** From frontmatter in the text, when present. */
  format: KanbanFormat | null;
  eol: '\n' | '\r\n';
  frontmatter: { start: number; end: number } | null;
  /** Text before the first lane (frontmatter included). */
  preambleEnd: number;
  lanes: KanbanLane[];
  /** [footerStart, text.length): archive + settings block. */
  footerStart: number;
  settings: { start: number; end: number; json: unknown } | null;
  /** Dominant list marker (for new cards). */
  marker: string;
  /** Continuation indent used by existing multi-line cards ('\t' by default). */
  indent: string;
  segments: Segment[];
}

interface Line {
  start: number;
  /** Content end (before `\r\n` / `\n`). */
  cEnd: number;
  /** After the line break. */
  end: number;
  s: string;
}

function splitLines(text: string): Line[] {
  const out: Line[] = [];
  let i = 0;
  while (i < text.length) {
    const nl = text.indexOf('\n', i);
    const end = nl < 0 ? text.length : nl + 1;
    let cEnd = nl < 0 ? text.length : nl;
    if (cEnd > i && text.charCodeAt(cEnd - 1) === 13) cEnd--;
    out.push({ start: i, cEnd, end, s: text.slice(i, cEnd) });
    i = end;
  }
  return out;
}

const FM_OPEN = /^---[ \t]*$/;
const FM_CLOSE = /^(?:---|\.\.\.)[ \t]*$/;
const LANE = /^##(?:[ \t]+(.*?))?[ \t]*$/;
const ITEM = /^([-*+])[ \t]+(?:\[(.)\](?=[ \t]|$)[ \t]?)?/;
const SETTINGS = /^%%[ \t]*kanban:settings/;
const ARCHIVE = /^\*\*\*[ \t]*$/;
const COMPLETE = /^\*\*Complete\*\*[ \t]*$/;
const BLANK = /^[ \t]*$/;
const INDENTED = /^[ \t]+\S/;

/** `kanban-plugin: board|basic` from frontmatter text or a frontmatter object. */
export function kanbanFormatOf(fm: string | Record<string, unknown> | null | undefined): KanbanFormat | null {
  if (!fm) return null;
  if (typeof fm === 'string') {
    const m = /^kanban-plugin:[ \t]*['"]?(board|basic)['"]?[ \t]*$/m.exec(fm);
    return m ? (m[1] as KanbanFormat) : null;
  }
  const v = fm['kanban-plugin'];
  return v === 'board' || v === 'basic' ? v : null;
}

/** Whether a full markdown file is a kanban board. */
export function isKanbanText(text: string): boolean {
  const ls = splitLines(text);
  if (!ls.length || !FM_OPEN.test(ls[0].s)) return false;
  for (let i = 1; i < ls.length; i++) {
    if (FM_CLOSE.test(ls[i].s)) return kanbanFormatOf(text.slice(ls[1]?.start ?? 0, ls[i].start)) !== null;
  }
  return false;
}

function commonIndent(lines: string[]): string {
  let ind: string | null = null;
  for (const l of lines) {
    if (BLANK.test(l)) continue;
    const m = /^[ \t]*/.exec(l)![0];
    if (ind === null) ind = m;
    else {
      let k = 0;
      while (k < ind.length && k < m.length && ind[k] === m[k]) k++;
      ind = ind.slice(0, k);
    }
  }
  return ind ?? '';
}

export function parseKanban(text: string): KanbanBoard {
  const lines = splitLines(text);
  const eol: '\n' | '\r\n' = text.includes('\r\n') ? '\r\n' : '\n';
  let li = 0;
  let frontmatter: KanbanBoard['frontmatter'] = null;
  let format: KanbanFormat | null = null;

  if (lines.length && FM_OPEN.test(lines[0].s)) {
    for (let j = 1; j < lines.length; j++) {
      if (FM_CLOSE.test(lines[j].s)) {
        frontmatter = { start: 0, end: lines[j].end };
        format = kanbanFormatOf(text.slice(lines[0].end, lines[j].start));
        li = j + 1;
        break;
      }
    }
  }

  // Footer: first archive divider or settings block after the frontmatter.
  let footerLine = lines.length;
  for (let j = li; j < lines.length; j++) {
    if (SETTINGS.test(lines[j].s) || ARCHIVE.test(lines[j].s)) {
      footerLine = j;
      break;
    }
  }
  const footerStart = footerLine < lines.length ? lines[footerLine].start : text.length;

  let settings: KanbanBoard['settings'] = null;
  for (let j = footerLine; j < lines.length; j++) {
    if (!SETTINGS.test(lines[j].s)) continue;
    let k = j;
    // The block ends at the first line that is (or ends with) `%%` after the opener.
    for (let m = j + 1; m < lines.length; m++) {
      if (/%%[ \t]*$/.test(lines[m].s)) {
        k = m;
        break;
      }
      k = m;
    }
    const inner = text.slice(lines[j].end, lines[k].start);
    const jm = /\{[\s\S]*\}/.exec(inner);
    let json: unknown = null;
    if (jm) {
      try {
        json = JSON.parse(jm[0]);
      } catch {
        json = null;
      }
    }
    settings = { start: lines[j].start, end: lines[k].end, json };
    if (!format) format = kanbanFormatOf(json as Record<string, unknown> | null);
    break;
  }

  const segments: Segment[] = [];
  const lanes: KanbanLane[] = [];
  const markers = new Map<string, number>();
  let indent = '';

  // Preamble: up to the first lane heading.
  let firstLane = li;
  while (firstLane < footerLine && !LANE.test(lines[firstLane].s)) firstLane++;
  const preambleEnd = firstLane < footerLine ? lines[firstLane].start : footerStart;
  if (preambleEnd > 0) segments.push({ kind: 'preamble', start: 0, end: preambleEnd });

  let j = firstLane;
  while (j < footerLine) {
    const h = lines[j];
    const m = LANE.exec(h.s)!;
    const title = m[1] ?? '';
    const titleStart = title ? h.start + h.s.indexOf(title, 2) : h.cEnd;
    const lane: KanbanLane = {
      index: lanes.length,
      title,
      start: h.start,
      end: h.end,
      headingEnd: h.end,
      titleStart,
      titleEnd: titleStart + title.length,
      complete: false,
      cards: [],
    };
    segments.push({ kind: 'heading', start: h.start, end: h.end });
    j++;
    let gapStart = -1;
    const flushGap = (upTo: number) => {
      if (gapStart >= 0 && upTo > gapStart) segments.push({ kind: 'gap', start: gapStart, end: upTo });
      gapStart = -1;
    };
    while (j < footerLine && !LANE.test(lines[j].s)) {
      const l = lines[j];
      const im = ITEM.exec(l.s);
      if (!im) {
        if (COMPLETE.test(l.s)) lane.complete = true;
        if (gapStart < 0) gapStart = l.start;
        j++;
        continue;
      }
      flushGap(l.start);
      // Card lines: the item line + indented continuation lines (blank
      // lines only when followed by more indented lines).
      let last = j;
      let k = j + 1;
      while (k < footerLine) {
        if (INDENTED.test(lines[k].s)) {
          last = k;
          k++;
          continue;
        }
        if (BLANK.test(lines[k].s)) {
          let n = k;
          while (n < footerLine && BLANK.test(lines[n].s)) n++;
          if (n < footerLine && INDENTED.test(lines[n].s) && !LANE.test(lines[n].s)) {
            k = n;
            continue;
          }
        }
        break;
      }
      const cont = lines.slice(j + 1, last + 1).map((x) => x.s);
      const ind = commonIndent(cont);
      if (ind && !indent) indent = ind;
      const firstText = l.s.slice(im[0].length);
      const textLines = [firstText, ...cont.map((c) => (c.startsWith(ind) ? c.slice(ind.length) : c.replace(/^[ \t]+/, '')))];
      const hasCheckbox = im[2] !== undefined;
      const checkOffset = hasCheckbox ? l.start + im[0].indexOf('[') + 1 : -1;
      const card: KanbanCard = {
        index: lane.cards.length,
        lane: lane.index,
        start: l.start,
        end: lines[last].end,
        raw: text.slice(l.start, lines[last].end),
        marker: im[1],
        hasCheckbox,
        checkOffset,
        checkChar: hasCheckbox ? im[2] : ' ',
        checked: hasCheckbox && im[2] !== ' ',
        textStart: l.start + im[0].length,
        textEnd: lines[last].cEnd,
        text: textLines.join('\n'),
        indent: ind,
      };
      markers.set(card.marker, (markers.get(card.marker) ?? 0) + 1);
      lane.cards.push(card);
      segments.push({ kind: 'card', start: card.start, end: card.end });
      j = last + 1;
    }
    lane.end = j < lines.length ? lines[j].start : text.length;
    flushGap(lane.end);
    lanes.push(lane);
  }

  if (footerStart < text.length) segments.push({ kind: 'footer', start: footerStart, end: text.length });

  let marker = '-';
  let best = 0;
  for (const [mk, n] of markers) if (n > best) [marker, best] = [mk, n];

  return {
    text,
    format,
    eol,
    frontmatter,
    preambleEnd,
    lanes,
    footerStart,
    settings,
    marker,
    indent: indent || '\t',
    segments,
  };
}

/** Lossless serializer: concatenates the parsed segments. */
export function serializeKanban(board: KanbanBoard): string {
  return board.segments.map((s) => board.text.slice(s.start, s.end)).join('');
}

// ---- building fresh boards ---------------------------------------------------

export interface KanbanModelCard {
  text: string;
  checked?: boolean;
}
export interface KanbanModelLane {
  title: string;
  complete?: boolean;
  cards: KanbanModelCard[];
}
export interface KanbanModel {
  format?: KanbanFormat;
  lanes: KanbanModelLane[];
  /** Settings JSON for the `%% kanban:settings %%` block (default: {"kanban-plugin": format}). */
  settings?: Record<string, unknown> | null;
}

/** One card's lines, in plugin style (continuation lines indented). */
export function cardLines(text: string, checked = false, marker = '-', indent = '\t', eol = '\n'): string {
  const [first, ...rest] = text.replace(/\r\n?/g, '\n').split('\n');
  return [`${marker} [${checked ? 'x' : ' '}] ${first}`, ...rest.map((r) => indent + r)].join(eol);
}

/** A new board file in the layout the obsidian-kanban plugin writes. */
export function buildKanban(model: KanbanModel): string {
  const format = model.format ?? 'board';
  let out = `---\n\nkanban-plugin: ${format}\n\n---\n\n`;
  for (const lane of model.lanes) {
    out += `## ${lane.title}\n\n`;
    if (lane.complete) out += '**Complete**\n';
    for (const c of lane.cards) out += cardLines(c.text, !!c.checked) + '\n';
    out += '\n\n';
  }
  const settings = model.settings === undefined ? { 'kanban-plugin': format } : model.settings;
  if (settings) out += `\n\n%% kanban:settings\n\`\`\`\n${JSON.stringify(settings)}\n\`\`\`\n%%`;
  return out;
}
