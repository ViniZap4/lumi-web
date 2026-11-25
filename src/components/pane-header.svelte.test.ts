// @vitest-environment jsdom
//
// Split panes keep ONE header row: a board / canvas renders the pane's
// controls (zoom, close, badges) at the end of its own bar instead of
// stacking under a separate pane header.

import { describe, it, expect, afterEach } from 'vitest';
import { mount, unmount, flushSync, createRawSnippet } from 'svelte';
import CanvasView from './canvas/CanvasView.svelte';
import KanbanBoard from './kanban/KanbanBoard.svelte';
import { memoryLiveText } from '../lib/live-text.ts';

let target: HTMLElement;
let cmp: Record<string, any> | null = null;
afterEach(() => {
  if (cmp) unmount(cmp);
  cmp = null;
  target?.remove();
});

const controls = createRawSnippet(() => ({ render: () => '<button data-testid="pane-close" type="button">x</button>' }));

describe('pane controls in the view bar', () => {
  it('canvas: inside .cv-bar, after the mode switch', () => {
    target = document.createElement('div');
    document.body.appendChild(target);
    cmp = mount(CanvasView, { target, props: { doc: memoryLiveText('{"nodes":[],"edges":[]}'), paneControls: controls, onmode: () => {}, onsource: () => {}, autofocus: false } });
    flushSync();
    const btn = target.querySelector('[data-testid="pane-close"]')!;
    expect(btn.closest('.cv-bar')).not.toBeNull();
    expect(btn.closest('.pane-controls')!.previousElementSibling?.getAttribute('data-testid')).toBe('canvas-mode');
  });

  it('board: inside .kb-bar', () => {
    target = document.createElement('div');
    document.body.appendChild(target);
    cmp = mount(KanbanBoard, { target, props: { doc: memoryLiveText('## Todo\n\n- [ ] a\n'), paneControls: controls, autofocus: false } });
    flushSync();
    expect(target.querySelector('[data-testid="pane-close"]')!.closest('.kb-bar')).not.toBeNull();
  });

  it('no controls → nothing extra', () => {
    target = document.createElement('div');
    document.body.appendChild(target);
    cmp = mount(CanvasView, { target, props: { doc: memoryLiveText(''), autofocus: false } });
    flushSync();
    expect(target.querySelector('.pane-controls')).toBeNull();
  });
});
