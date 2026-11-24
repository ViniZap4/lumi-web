// Ambient life (docs/DESIGN-LANGUAGE.md §6.4): the cheap, global
// pieces that make the app feel inhabited without costing frames.
//
// - `data-hidden` on <html> while the tab is hidden: every CSS
//   animation pauses (app.css), so the ambient light, breathing dots
//   and skeletons cost nothing in a background tab.
// - Cursor-proximity light: ONE passive pointermove listener, coalesced
//   to one write per frame, sets `--mx` / `--my` on the hovered `.glow`
//   element only (a radial gradient in app.css follows the pointer).
//   Nothing else is touched, so a move costs one style recalc of one
//   element. Off for touch input and under reduced motion.

import { motionAllowed } from './motion.ts';

export function installAmbient(doc: Document = document): () => void {
  const root = doc.documentElement;
  const vis = () => {
    if (doc.visibilityState === 'hidden') root.dataset.hidden = '';
    else delete root.dataset.hidden;
  };
  vis();
  doc.addEventListener('visibilitychange', vis);

  let pending: PointerEvent | null = null;
  let raf = 0;
  let last: HTMLElement | null = null;
  const flush = () => {
    raf = 0;
    const e = pending;
    pending = null;
    if (!e) return;
    const t = e.target instanceof Element ? e.target.closest<HTMLElement>('.glow') : null;
    if (last && last !== t) {
      last.style.removeProperty('--mx');
      last.style.removeProperty('--my');
    }
    last = t;
    if (!t) return;
    const r = t.getBoundingClientRect();
    t.style.setProperty('--mx', `${Math.round(e.clientX - r.left)}px`);
    t.style.setProperty('--my', `${Math.round(e.clientY - r.top)}px`);
  };
  const move = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse' || !motionAllowed()) return;
    pending = e;
    if (!raf) raf = requestAnimationFrame(flush);
  };
  doc.addEventListener('pointermove', move, { passive: true });
  return () => {
    doc.removeEventListener('visibilitychange', vis);
    doc.removeEventListener('pointermove', move);
    if (raf) cancelAnimationFrame(raf);
  };
}
