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

function splitLines(s: string): string[] {
  const out: string[] = [];
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) === 0x0a) {
      out.push(s.slice(start, i + 1));
      start = i + 1;
    }
  }
  if (start < s.length) out.push(s.slice(start));
  return out;
}

/** Line hunks [aFrom, aTo) → [bFrom, bTo) by Myers' O(ND) diff, or null
 *  when the edit distance exceeds `maxD`. */
function lineHunks(a: readonly string[], b: readonly string[], maxD: number): Array<[number, number, number, number]> | null {
  const n = a.length;
  const m = b.length;
  const max = Math.min(n + m, maxD);
  const off = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  let found = -1;
  outer: for (let d = 0; d <= max; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[off + k] = x;
      if (x >= n && y >= m) {
        found = d;
        break outer;
      }
    }
  }
  if (found < 0) return null;
  // Backtrack into equal-line runs, then emit the gaps between them.
  const keep: Array<[number, number]> = []; // matched (x, y) pairs, reversed
  let x = n;
  let y = m;
  for (let d = found; d >= 0; d--) {
    const vd = trace[d];
    const k = x - y;
    const prevK = k === -d || (k !== d && vd[off + k - 1] < vd[off + k + 1]) ? k + 1 : k - 1;
    const px = vd[off + prevK];
    const py = px - prevK;
    while (x > px && y > py && x > 0 && y > 0) {
      x--;
      y--;
      keep.push([x, y]);
    }
    x = px;
    y = py;
  }
  keep.reverse();
  const hunks: Array<[number, number, number, number]> = [];
  let ax = 0;
  let by = 0;
  for (const [kx, ky] of [...keep, [n, m] as [number, number]]) {
    if (kx > ax || ky > by) hunks.push([ax, kx, by, ky]);
    ax = kx + 1;
    by = ky + 1;
  }
  return hunks;
}

/**
 * Minimal ranged edits turning `a` into `b`: one edit per changed run of
 * lines (Myers line diff), each trimmed to its own common prefix/suffix.
 * Unchanged lines between two changes are never rewritten, so a
 * concurrent remote edit there is not displaced (protocol §3.2: the
 * single prefix/suffix hunk deletes and re-inserts everything between
 * two distant changes). Edits are disjoint, in `a` coordinates. Falls
 * back to `diffRange` when the line diff is too large to be worth it.
 */
export function diffEdits(a: string, b: string, maxD = 400): TextEdit[] {
  const whole = diffRange(a, b);
  if (!whole) return [];
  // Work on whole lines around the changed span.
  const lineStart = whole.from === 0 ? 0 : a.lastIndexOf('\n', whole.from - 1) + 1;
  const tailA = a.length - whole.to;
  const nlA = a.indexOf('\n', whole.to);
  const lineEndA = nlA < 0 ? a.length : nlA + 1;
  const suffix = a.length - lineEndA;
  if (suffix > tailA) return [whole];
  const midA = a.slice(lineStart, lineEndA);
  const midB = b.slice(lineStart, b.length - suffix);
  const la = splitLines(midA);
  const lb = splitLines(midB);
  if (la.length < 3 && lb.length < 3) return [whole];
  const hunks = lineHunks(la, lb, maxD);
  if (!hunks || hunks.length <= 1) return [whole];
  const offA: number[] = [0];
  for (const l of la) offA.push(offA[offA.length - 1] + l.length);
  const offB: number[] = [0];
  for (const l of lb) offB.push(offB[offB.length - 1] + l.length);
  const edits: TextEdit[] = [];
  for (const [a0, a1, b0, b1] of hunks) {
    const e = diffRange(midA.slice(offA[a0], offA[a1]), midB.slice(offB[b0], offB[b1]), lineStart + offA[a0]);
    if (e) edits.push(e);
  }
  return edits;
}
