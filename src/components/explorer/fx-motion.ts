// The floating explorer's motion (DESIGN-LANGUAGE §motion v2). Every
// function only decorates a DOM that is already final: fire-and-forget,
// keys typed mid-animation apply at once, nothing runs under Reduce
// Motion (motionAllowed / the engine).

import { motionAllowed, springIn, cascade, exitGhost } from '../../lib/motion.ts';
import { carousel, takeOrigin } from '../../lib/motion-actions.ts';

const TRIGGER = '[data-testid="explorer-button"]';

/** Rows ripple in when the overlay opens (and on a level change). */
export function entrance(host: HTMLElement | null): void {
  if (host) cascade(Array.from(host.querySelectorAll<HTMLElement>('[role="option"], .fx-acct')), { y: 14, opacity: 0 }, { step: 22, max: 220, spring: 'gentle' });
}

/** The panel GROWS from its trigger (the explorer button or whatever
 *  the pointer just used) on the bouncy spring, its columns slide in one
 *  after another like cards dealt from the left, and the scrim's depth
 *  blur eases in (CSS). A sheet rises from the bottom instead. */
export function flyIn(root: HTMLElement | null, sheet: boolean): void {
  if (!root || !motionAllowed()) return;
  const r = root.getBoundingClientRect();
  const t = takeOrigin(document.querySelector(TRIGGER));
  const ox = t ? Math.max(0, Math.min(r.width, t.left + t.width / 2 - r.left)) : r.width / 2;
  const oy = t ? Math.max(0, Math.min(r.height, t.top + t.height / 2 - r.top)) : r.height * 0.35;
  if (sheet) springIn(root, { y: r.height * 0.6 }, { spring: 'gentle' });
  else springIn(root, { scale: 0.8, opacity: 0 }, { spring: 'bouncy', origin: `${ox.toFixed(0)}px ${oy.toFixed(0)}px` });
  cascade(root.querySelectorAll<HTMLElement>('.fx-cols > .fx-col, .fx-cols > section'), { x: -26, opacity: 0 }, { step: 55, max: 165, spring: 'glide' });
}

/** Close is quick but VISIBLE: a snapshot of the panel collapses toward
 *  `to` (the opened row → its note title; else the trigger) and the
 *  scrim fades, while the real overlay is already gone. */
export function flyOut(root: HTMLElement | null, to?: Element | null): void {
  if (!root || !motionAllowed()) return;
  const scrim = root.parentElement;
  const r = root.getBoundingClientRect();
  const t = to?.getBoundingClientRect() ?? document.querySelector(TRIGGER)?.getBoundingClientRect() ?? null;
  const ox = t ? t.left + t.width / 2 - r.left : r.width / 2;
  const oy = t ? t.top + t.height / 2 - r.top : r.height / 2;
  if (scrim) exitGhost(scrim, { opacity: 0 }, { spring: 'snappy', shallow: true });
  exitGhost(root, { scale: to ? 0.5 : 0.86, opacity: 0 }, { spring: 'snappy', origin: `${ox.toFixed(0)}px ${oy.toFixed(0)}px` });
}

/** Books ⇄ files is a change of SCOPE, not a folder step: the camera
 *  pulls back to the shelf (content arrives from further away, the panel
 *  dips and settles) or dives into a book. */
export function scopeChange(root: HTMLElement | null, dir: 'out' | 'in', sheet: boolean): void {
  if (!motionAllowed() || !root) return;
  const cols = root.querySelector<HTMLElement>('.fx-cols');
  springIn(cols, { scale: dir === 'out' ? 1.1 : 0.88, opacity: 0 }, { spring: 'gentle' });
  if (!sheet) springIn(root, { scale: dir === 'out' ? 0.94 : 1.03 }, { spring: 'bouncy' });
}

/** Account level (only with many accounts) ⇄ Livros: same zoom, smaller. */
export function layerChange(list: HTMLElement | null, dir: 'out' | 'in'): void {
  if (!motionAllowed() || !list) return;
  springIn(list, { scale: dir === 'out' ? 1.06 : 0.94, opacity: 0 }, { spring: 'gentle' });
}

/** Folder travel (l / h): a carousel with momentum — the columns are
 *  pushed one column-width-ish toward where you came from and spring
 *  home (glide, 6 % overshoot); repeated l / h ADD to the motion in
 *  flight. The new current column's rows ripple in. */
export function folderTravel(root: HTMLElement | null, current: HTMLElement | null, deeper: boolean): void {
  const cols = root?.querySelectorAll<HTMLElement>('.fx-col');
  if (!cols || cols.length < 3) return;
  const dx = deeper ? 90 : -90;
  carousel(cols[0], dx * 0.7);
  carousel(cols[1], dx);
  springIn(cols[2], { x: dx * 1.3, opacity: 0 }, { spring: 'glide', delay: 45 });
  if (current) cascade(Array.from(current.querySelectorAll<HTMLElement>('[role="option"]')), { x: deeper ? 16 : -16, opacity: 0 }, { step: 16, max: 160, limit: 12, spring: 'glide' });
}
