// Full-screen view of a mermaid diagram: zoom (wheel, + / -, buttons),
// pan (drag, arrows / hjkl), fit (0), copy SVG / source, Esc to close.
// Plain DOM so the reader, the split preview and the Live Preview
// widget share it. The SVG passed in is already sanitised.

import { motionAllowed } from './motion.ts';

export interface LightboxOptions {
  svg: string;
  label: string;
  copySvg: () => string;
  copySource: () => string;
  returnFocus?: HTMLElement | null;
}

const MIN = 0.1;
const MAX = 8;

let open: { close: () => void } | null = null;

function btn(text: string, label: string, onclick: (b: HTMLButtonElement) => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'ui-btn sm';
  b.textContent = text;
  b.setAttribute('aria-label', label);
  b.title = label;
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    onclick(b);
  });
  return b;
}

function flash(b: HTMLButtonElement, text: string): void {
  const prev = b.textContent;
  b.textContent = text;
  setTimeout(() => (b.textContent = prev), 1200);
}

function copy(text: string, b: HTMLButtonElement): void {
  void navigator.clipboard?.writeText(text).then(
    () => flash(b, 'Copied'),
    () => flash(b, 'Failed'),
  );
}

/** Natural size of a rendered diagram (viewBox, else its box). */
function naturalSize(svg: SVGSVGElement): { w: number; h: number } {
  const vb = svg.viewBox?.baseVal;
  if (vb && vb.width > 0 && vb.height > 0) return { w: vb.width, h: vb.height };
  const r = svg.getBoundingClientRect();
  return { w: r.width || 600, h: r.height || 400 };
}

export function openMermaidLightbox(o: LightboxOptions): void {
  open?.close();
  const ret = o.returnFocus ?? (document.activeElement as HTMLElement | null);

  const root = document.createElement('div');
  root.className = 'ui-scrim mmd-lightbox';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', o.label);
  root.tabIndex = -1;

  const stage = document.createElement('div');
  stage.className = 'mmd-lb-stage';
  const canvas = document.createElement('div');
  canvas.className = 'mmd-lb-canvas';
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', o.label);
  canvas.innerHTML = o.svg; // sanitised by lib/mermaid.ts
  stage.append(canvas);

  const svg = canvas.querySelector('svg') as SVGSVGElement | null;
  const size = svg ? naturalSize(svg) : { w: 600, h: 400 };
  if (svg) {
    svg.removeAttribute('style');
    svg.setAttribute('width', String(size.w));
    svg.setAttribute('height', String(size.h));
  }

  let scale = 1;
  let x = 0;
  let y = 0;
  const pct = document.createElement('span');
  pct.className = 'mmd-lb-pct';
  pct.setAttribute('aria-live', 'polite');
  const paint = () => {
    canvas.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
    pct.textContent = `${Math.round(scale * 100)}%`;
  };
  const fit = () => {
    const r = stage.getBoundingClientRect();
    const s = Math.min((r.width - 48) / size.w, (r.height - 48) / size.h, 2);
    scale = Math.max(MIN, Number.isFinite(s) && s > 0 ? s : 1);
    x = (r.width - size.w * scale) / 2;
    y = (r.height - size.h * scale) / 2;
    paint();
  };
  /** Zoom by `f` keeping the stage point (cx, cy) fixed. */
  const zoomAt = (f: number, cx?: number, cy?: number) => {
    const r = stage.getBoundingClientRect();
    const px = cx ?? r.width / 2;
    const py = cy ?? r.height / 2;
    const next = Math.min(MAX, Math.max(MIN, scale * f));
    x = px - ((px - x) * next) / scale;
    y = py - ((py - y) * next) / scale;
    scale = next;
    paint();
  };

  const bar = document.createElement('div');
  bar.className = 'mmd-lb-bar';
  const title = document.createElement('span');
  title.className = 'mmd-lb-title';
  title.textContent = o.label;
  const closeBtn = btn('Close', 'Close (Esc)', () => close());
  const kbd = document.createElement('kbd');
  kbd.textContent = 'Esc';
  closeBtn.append(' ', kbd);
  bar.append(
    title,
    btn('−', 'Zoom out (-)', () => zoomAt(1 / 1.25)),
    pct,
    btn('+', 'Zoom in (+)', () => zoomAt(1.25)),
    btn('Fit', 'Fit to screen (0)', () => fit()),
    btn('Copy SVG', 'Copy diagram as SVG', (b) => copy(o.copySvg(), b)),
    btn('Copy source', 'Copy diagram source', (b) => copy(o.copySource(), b)),
    closeBtn,
  );
  root.append(stage, bar);

  // Pan by dragging; wheel zooms around the pointer.
  let drag: { id: number; sx: number; sy: number; x: number; y: number } | null = null;
  stage.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, x, y };
    stage.setPointerCapture?.(e.pointerId);
    stage.classList.add('dragging');
  });
  stage.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    x = drag.x + e.clientX - drag.sx;
    y = drag.y + e.clientY - drag.sy;
    paint();
  });
  const endDrag = () => {
    drag = null;
    stage.classList.remove('dragging');
  };
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);
  stage.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const r = stage.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0025)), e.clientX - r.left, e.clientY - r.top);
    },
    { passive: false },
  );
  stage.addEventListener('dblclick', () => fit());

  // Modal keys: nothing reaches the app shell while open.
  root.addEventListener('keydown', (e) => {
    e.stopPropagation();
    const step = e.shiftKey ? 120 : 40;
    switch (e.key) {
      case 'Escape':
      case 'q':
        e.preventDefault();
        close();
        return;
      case '+':
      case '=':
        e.preventDefault();
        zoomAt(1.25);
        return;
      case '-':
      case '_':
        e.preventDefault();
        zoomAt(1 / 1.25);
        return;
      case '0':
        e.preventDefault();
        fit();
        return;
      case 'ArrowLeft':
      case 'h':
        x += step;
        break;
      case 'ArrowRight':
      case 'l':
        x -= step;
        break;
      case 'ArrowUp':
      case 'k':
        y += step;
        break;
      case 'ArrowDown':
      case 'j':
        y -= step;
        break;
      case 'Tab': {
        // Keep focus inside the dialog.
        const items = Array.from(bar.querySelectorAll<HTMLButtonElement>('button'));
        const i = items.indexOf(document.activeElement as HTMLButtonElement);
        e.preventDefault();
        const n = e.shiftKey ? (i <= 0 ? items.length - 1 : i - 1) : (i + 1) % items.length;
        items[n]?.focus();
        return;
      }
      default:
        return;
    }
    e.preventDefault();
    paint();
  });
  root.addEventListener('keyup', (e) => e.stopPropagation());

  function close(): void {
    if (!root.isConnected) return;
    root.remove();
    open = null;
    ret?.focus?.({ preventScroll: true });
  }

  document.body.append(root);
  if (motionAllowed()) root.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: 160, easing: 'ease-out' });
  fit();
  closeBtn.focus();
  open = { close };
}

/** Close the lightbox if one is open (tests, navigation). */
export function closeMermaidLightbox(): void {
  open?.close();
}
