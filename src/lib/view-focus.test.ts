// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { focusPane, paneFocusTarget } from './view-focus.ts';

// Regression: "o canvas trava ao abrir, depois de dar reload ele volta".
// Opening a canvas in-app ran the shell's post-transition
// `reader.focus()` AFTER the canvas had focused itself on mount, so the
// canvas never got hjkl / + / - / a until a click (a reload has no
// transition, so the canvas' own autofocus won there).

function stage(inner: string): HTMLElement {
  document.body.innerHTML = `<section id="stage" tabindex="-1">${inner}</section><button id="outside">x</button>`;
  return document.getElementById('stage')!;
}

describe('focusPane', () => {
  beforeEach(() => (document.body.innerHTML = ''));

  it('keeps focus on a canvas that focused itself on mount (in-app open)', () => {
    const root = stage('<div class="view-frame"><div data-testid="canvas-view" tabindex="0"></div></div>');
    const cv = root.querySelector<HTMLElement>('[data-testid=canvas-view]')!;
    cv.focus();
    focusPane(root);
    expect(document.activeElement).toBe(cv);
  });

  it('moves focus into the canvas when it is elsewhere (pane switch, explorer closed)', () => {
    const root = stage('<div data-testid="canvas-view" tabindex="0"></div>');
    document.getElementById('outside')!.focus();
    focusPane(root);
    expect(document.activeElement).toBe(root.querySelector('[data-testid=canvas-view]'));
  });

  it('targets a kanban board the same way', () => {
    const root = stage('<div data-testid="kanban-board" tabindex="0"></div>');
    focusPane(root);
    expect(document.activeElement).toBe(root.querySelector('[data-testid=kanban-board]'));
  });

  it('markdown notes still focus the reader (unchanged behaviour)', () => {
    const root = stage('<article><a href="#x" id="link">link</a></article>');
    document.getElementById('link')!.focus();
    focusPane(root);
    expect(document.activeElement).toBe(root);
    expect(paneFocusTarget(root)).toBe(root);
  });

  it('is a no-op without a root', () => {
    expect(() => focusPane(null)).not.toThrow();
    expect(paneFocusTarget(null)).toBeNull();
  });
});
