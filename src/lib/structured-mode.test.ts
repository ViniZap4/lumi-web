import { describe, it, expect } from 'vitest';
import { modeKey, initialStructuredMode, structuredFocus } from './structured-mode.svelte.ts';
import { legendFor, CANVAS_READ_ITEMS, CANVAS_EDIT_ITEMS, BOARD_READ_ITEMS, BOARD_EDIT_ITEMS } from './legend.ts';
import { CanvasKeys } from './canvas/canvas-keys.ts';

describe('structured note modes (SPEC-PARTE2 §5a)', () => {
  it('opens in Reading unless "open notes in" is editing', () => {
    expect(initialStructuredMode('reading')).toBe('read');
    expect(initialStructuredMode(undefined)).toBe('read');
    expect(initialStructuredMode('editing')).toBe('edit');
  });

  it('i / e enter Edit from Reading; other keys are not mode keys', () => {
    expect(modeKey({ key: 'i' }, 'read', true)).toBe('edit');
    expect(modeKey({ key: 'e' }, 'read', false)).toBe('edit');
    for (const k of ['j', 'a', 'Escape', 'q', 'E']) expect(modeKey({ key: k }, 'read', true)).toBeNull();
  });

  it('Esc / q leave Edit only when nothing is selected or pending', () => {
    expect(modeKey({ key: 'Escape' }, 'edit', true)).toBe('read');
    expect(modeKey({ key: 'q' }, 'edit', true)).toBe('read');
    expect(modeKey({ key: 'Escape' }, 'edit', false)).toBeNull();
    expect(modeKey({ key: 'i' }, 'edit', true)).toBeNull(); // board: edit card
  });

  it('⌘E / Ctrl-E toggle; other modified keys are not mode keys', () => {
    expect(modeKey({ key: 'e', metaKey: true }, 'read', false)).toBe('edit');
    expect(modeKey({ key: 'e', ctrlKey: true }, 'edit', false)).toBe('read');
    expect(modeKey({ key: 'E', metaKey: true, shiftKey: true }, 'read', true)).toBeNull();
    expect(modeKey({ key: 'e', altKey: true }, 'read', true)).toBeNull();
    expect(modeKey({ key: 'w', ctrlKey: true }, 'edit', true)).toBeNull();
  });

  it('canvas keys in Reading own navigation only', () => {
    const k = new CanvasKeys();
    const kinds = (keys: Array<[string, object?]>, sel: boolean) => keys.map(([key, o]) => k.feed({ key, ...o }, sel, true)?.kind ?? null);
    expect(kinds([['Tab'], ['h'], ['+'], ['0'], ['Enter'], ['Escape']], true)).toEqual(['cycle', 'pan', 'zoom', 'fit', 'activate', 'escape']);
    expect(kinds([['a'], ['f'], ['d'], ['x'], ['Delete'], ['H'], ['L'], ['u'], ['r', { ctrlKey: true }], ['ArrowLeft', { shiftKey: true }]], true)).toEqual(Array(10).fill(null));
    k.feed({ key: 'c' }, true, true);
    expect(k.feed({ key: '1' }, true, true)).toBeNull();
    k.feed({ key: 'g' }, true, true);
    expect(k.feed({ key: 'f' }, true, true)).toEqual({ kind: 'openFile', split: false });
  });

  it('the focused view drives the legend; the last one stays the palette target', () => {
    const a = {};
    const set = () => {};
    structuredFocus.claim(a, { kind: 'canvas', mode: 'read', set });
    expect(structuredFocus.current?.kind).toBe('canvas');
    structuredFocus.blur(a);
    expect(structuredFocus.current).toBeNull();
    expect(structuredFocus.last?.kind).toBe('canvas');
    structuredFocus.release({}); // someone else: no-op
    expect(structuredFocus.last).not.toBeNull();
    structuredFocus.release(a);
    expect(structuredFocus.last).toBeNull();
  });

  it('legend per kind and mode', () => {
    expect(legendFor('canvas', null, {})).toBe(CANVAS_READ_ITEMS);
    expect(legendFor('canvas', null, { structuredMode: 'edit' })).toBe(CANVAS_EDIT_ITEMS);
    expect(legendFor('board', null, { structuredMode: 'read' })).toBe(BOARD_READ_ITEMS);
    expect(legendFor('board', null, { structuredMode: 'edit' })).toBe(BOARD_EDIT_ITEMS);
    expect(CANVAS_READ_ITEMS.map((i) => i.label)).not.toContain('delete');
  });
});
