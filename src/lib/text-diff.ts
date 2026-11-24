// Minimal ranged text edits (CRDT client protocol §3.2).
//
// Structured note views (kanban board, canvas) never write a whole
// text: they compute the smallest differing range against the CURRENT
// replica text and apply it as delete+insert in one transaction.
// Offsets are UTF-16 code units (JS string semantics), which is what
// Y.Text indexes. Pure and DOM-free so native clients can port it.

/** Replace `[from, to)` of the current text with `insert`. */
export interface TextEdit {
  from: number;
  to: number;
  insert: string;
}

function isHigh(c: number): boolean {
  return c >= 0xd800 && c <= 0xdbff;
}
function isLow(c: number): boolean {
  return c >= 0xdc00 && c <= 0xdfff;
}

/**
 * The single smallest edit turning `a` into `b` (common prefix/suffix),
 * or null when they are equal. Never splits a surrogate pair. `offset`
 * shifts the result, for diffing a slice of a larger text.
 */
export function diffRange(a: string, b: string, offset = 0): TextEdit | null {
  if (a === b) return null;
  const max = Math.min(a.length, b.length);
  let p = 0;
  while (p < max && a.charCodeAt(p) === b.charCodeAt(p)) p++;
  let s = 0;
  const maxS = max - p;
  while (s < maxS && a.charCodeAt(a.length - 1 - s) === b.charCodeAt(b.length - 1 - s)) s++;
  if (p > 0 && isHigh(a.charCodeAt(p - 1))) p--;
  if (s > 0 && isLow(a.charCodeAt(a.length - s))) s--;
  return { from: offset + p, to: offset + a.length - s, insert: b.slice(p, b.length - s) };
}

/** Sort edits right-to-left so earlier offsets stay valid while applying. */
export function sortEditsDesc(edits: readonly TextEdit[]): TextEdit[] {
  return [...edits].sort((x, y) => y.from - x.from || y.to - x.to);
}

/** Throws when edits overlap (planner bug guard). */
export function assertDisjoint(edits: readonly TextEdit[]): void {
  const asc = [...edits].sort((x, y) => x.from - y.from || x.to - y.to);
  for (let i = 1; i < asc.length; i++) {
    if (asc[i].from < asc[i - 1].to) throw new Error('overlapping text edits');
  }
}

/** Apply disjoint edits (all in original coordinates) to a string. */
export function applyTextEdits(text: string, edits: readonly TextEdit[]): string {
  let out = text;
  for (const e of sortEditsDesc(edits)) out = out.slice(0, e.from) + e.insert + out.slice(e.to);
  return out;
}

/** Total characters touched (deleted + inserted): a minimality metric. */
export function editCost(edits: readonly TextEdit[]): number {
  return edits.reduce((n, e) => n + (e.to - e.from) + e.insert.length, 0);
}
