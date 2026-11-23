// Hint mode (Vimium-style): label every visible clickable thing with a
// short home-row code; typing the code clicks it. Pure label maths +
// a DOM collector.

const ALPHABET = 'asdfghjklqwertyuiopzxcvbnm';

/**
 * `n` prefix-free labels, shortest first: single letters while they
 * suffice, else every label has the same length (so no label is a
 * prefix of another and a full match is unambiguous).
 */
export function hintLabels(n: number, alphabet = ALPHABET): string[] {
  if (n <= 0) return [];
  const k = alphabet.length;
  let len = 1;
  while (k ** len < n) len++;
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    let s = '';
    let v = i;
    for (let j = 0; j < len; j++) {
      s = alphabet[v % k] + s;
      v = Math.floor(v / k);
    }
    out.push(s);
  }
  return out;
}

/** Labels still matching the typed prefix; `hit` when exactly one
 *  label equals it. */
export function filterHints(labels: readonly string[], typed: string): { live: number[]; hit: number | null } {
  const live: number[] = [];
  let hit: number | null = null;
  labels.forEach((l, i) => {
    if (l.startsWith(typed)) live.push(i);
    if (l === typed) hit = i;
  });
  return { live, hit };
}

export const HINT_SELECTOR =
  '[data-hint-target], a[href], button:not(:disabled), input:not(:disabled):not([type="hidden"]), [role="tab"], [role="option"], summary, [tabindex="0"]';

/** Visible, on-screen clickable elements under `root`. */
export function collectHintTargets(root: ParentNode, viewport = { w: window.innerWidth, h: window.innerHeight }): HTMLElement[] {
  const seen = new Set<HTMLElement>();
  const out: HTMLElement[] = [];
  for (const el of Array.from(root.querySelectorAll<HTMLElement>(HINT_SELECTOR))) {
    if (seen.has(el)) continue;
    // Prefer the outermost target (a row, not its inner spans).
    if (el.parentElement?.closest('[data-hint-target]')) continue;
    // Containers of targets (a focusable listbox) and opted-out chrome
    // (the legend: its keys are already on screen) get no label.
    if (el.querySelector('[data-hint-target]') || el.closest('[data-hint-skip]')) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    if (r.bottom < 0 || r.right < 0 || r.top > viewport.h || r.left > viewport.w) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    if (el.closest('[aria-hidden="true"], [inert]')) continue;
    seen.add(el);
    out.push(el);
  }
  return out;
}
