// Outline ("Contents") for the reader's TOC rail. Cheap by design: it
// reads the headings the renderer already produced (`.md-h[id]`, see
// lib/markdown.ts), never re-parses the note.

export interface TocItem {
  id: string;
  text: string;
  /** 1–6, from the heading tag. */
  level: number;
}

/** Headings under `root` (h1…h`maxLevel`) in document order. The
 *  anchor glyph (`#`) the renderer appends is not part of the text. */
export function buildToc(root: ParentNode | null | undefined, maxLevel = 4): TocItem[] {
  if (!root) return [];
  const out: TocItem[] = [];
  root.querySelectorAll<HTMLElement>('.md-h[id]').forEach((h) => {
    const level = Number(h.tagName.slice(1));
    if (!(level >= 1 && level <= maxLevel)) return;
    let text = '';
    h.childNodes.forEach((c) => {
      if (!(c instanceof Element && c.classList.contains('md-anchor'))) text += c.textContent ?? '';
    });
    text = text.replace(/\s+/g, ' ').trim();
    if (text) out.push({ id: h.id, text, level });
  });
  return out;
}

/** Index of the section being read: the last heading whose top (px,
 *  relative to the scroll viewport) is at or above `offset`. -1 before
 *  the first heading. */
export function activeTocIndex(tops: readonly number[], offset = 96): number {
  let at = -1;
  for (let i = 0; i < tops.length; i++) {
    if (tops[i] <= offset) at = i;
    else break;
  }
  return at;
}

/** Indent levels relative to the shallowest heading present (a note
 *  that starts at h2 is not indented by one step everywhere). */
export function tocDepths(items: readonly TocItem[]): number[] {
  if (items.length === 0) return [];
  const min = Math.min(...items.map((i) => i.level));
  return items.map((i) => Math.min(3, i.level - min));
}

/** The rail shows only when the gutter beside the text column can hold
 *  it without crowding the text. */
export const TOC_RAIL_W = 220;
export function tocFits(paneWidth: number, columnWidth: number, rail = TOC_RAIL_W, gap = 32): boolean {
  return (paneWidth - columnWidth) / 2 >= rail + gap;
}
