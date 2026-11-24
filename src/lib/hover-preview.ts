// Hover link preview (SPEC-PARTE2 §4).
//
// `HoverIntent` is the timing: a link must be hovered for
// HOVER_DELAY_MS before the card shows; moving onto the card keeps it;
// leaving both hides it after a short grace (so the pointer can travel
// from the link to the card). Timers are injectable for tests.
//
// `previewExcerpt` cuts the note to its first ~40 lines without
// leaving a code fence open; the card renders the excerpt through the
// shared renderer (lib/markdown.ts: marked + DOMPurify), never raw.

import type { NoteSummary } from './types.ts';

export type HoverTarget =
  | { kind: 'note'; note: NoteSummary }
  | { kind: 'missing'; path: string }
  | { kind: 'external'; url: string };

export const HOVER_DELAY_MS = 350;
export const HOVER_HIDE_MS = 220;
export const EXCERPT_LINES = 40;

export interface Timers {
  set(fn: () => void, ms: number): unknown;
  clear(h: unknown): void;
}

const realTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export class HoverIntent<T> {
  private showTimer: unknown = null;
  private hideTimer: unknown = null;
  private pendingKey: string | null = null;
  /** Key of the target whose card is showing. */
  shownKey: string | null = null;

  constructor(
    private onShow: (target: T) => void,
    private onHide: () => void,
    private timers: Timers = realTimers,
    private delay = HOVER_DELAY_MS,
    private grace = HOVER_HIDE_MS,
  ) {}

  /** Pointer entered a link. */
  enter(target: T, key: string): void {
    this.clearHide();
    if (key === this.shownKey || key === this.pendingKey) return;
    this.clearShow();
    this.pendingKey = key;
    this.showTimer = this.timers.set(() => {
      this.showTimer = null;
      this.pendingKey = null;
      this.shownKey = key;
      this.onShow(target);
    }, this.delay);
  }

  /** Pointer left the link (or the card). */
  leave(): void {
    this.clearShow();
    this.pendingKey = null;
    if (this.shownKey == null || this.hideTimer) return;
    this.hideTimer = this.timers.set(() => {
      this.hideTimer = null;
      this.hide();
    }, this.grace);
  }

  /** Pointer is over the card: keep it. */
  hold(): void {
    this.clearHide();
  }

  /** Shown without hovering (`K`): no delay. */
  showNow(target: T, key: string): void {
    this.cancel();
    this.shownKey = key;
    this.onShow(target);
  }

  hide(): void {
    this.cancel();
    if (this.shownKey != null) {
      this.shownKey = null;
      this.onHide();
    }
  }

  /** Drop pending timers (unmount); the card state is unchanged. */
  cancel(): void {
    this.clearShow();
    this.clearHide();
    this.pendingKey = null;
  }

  private clearShow(): void {
    if (this.showTimer != null) this.timers.clear(this.showTimer);
    this.showTimer = null;
  }

  private clearHide(): void {
    if (this.hideTimer != null) this.timers.clear(this.hideTimer);
    this.hideTimer = null;
  }
}

/** Strip a leading YAML frontmatter block. */
export function stripFrontmatter(src: string): string {
  const m = /^---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)\s*(?:\r?\n|$)/.exec(src);
  return m ? src.slice(m[0].length) : src;
}

/**
 * The first `lines` lines of a note body (frontmatter dropped, leading
 * blank lines skipped). A fence left open at the cut is closed so the
 * rest of the card does not turn into code.
 */
export function previewExcerpt(body: string, lines = EXCERPT_LINES): { text: string; truncated: boolean } {
  const all = stripFrontmatter(body ?? '').replace(/^\s*\n/, '').split('\n');
  const truncated = all.length > lines;
  const cut = all.slice(0, lines);
  let fence: string | null = null;
  for (const l of cut) {
    const m = /^\s{0,3}(`{3,}|~{3,})/.exec(l);
    if (!m) continue;
    if (fence == null) fence = m[1];
    else if (m[1][0] === fence[0] && m[1].length >= fence.length) fence = null;
  }
  if (fence) cut.push(fence);
  return { text: cut.join('\n').trimEnd(), truncated };
}

/** Relative "updated" label (`just now`, `5 min ago`, `3 days ago`, date). */
export function updatedLabel(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 14) return `${d} ${d === 1 ? 'day' : 'days'} ago`;
  return new Date(t).toISOString().slice(0, 10);
}
