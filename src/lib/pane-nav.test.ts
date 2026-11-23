import { describe, it, expect } from 'vitest';
import {
  paneLayout,
  paneTarget,
  panesOf,
  PaneKeys,
  PANE_CHORD_MS,
  ctrlLetter,
  userPaneKeys,
  editorPaneRoute,
  vimMidCommand,
  fallsThroughWithoutTarget,
  type LayoutInput,
} from './pane-nav.ts';

const base: LayoutInput = { narrow: false, splitNarrow: false, pane: 'browse', editing: false, split: false, mainHasNote: false };
const ctrl = (key: string, extra: Partial<KeyboardEvent> = {}) => ({ key, ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, ...extra });
const plain = (key: string) => ({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false });

describe('paneLayout', () => {
  it('browsing a folder: the explorer alone', () => {
    expect(paneLayout(base)).toEqual({ order: ['explorer'], stack: null });
  });
  it('browsing with a note preview: explorer | main', () => {
    expect(paneLayout({ ...base, mainHasNote: true }).order).toEqual(['explorer', 'main']);
  });
  it('reading: explorer | main', () => {
    expect(paneLayout({ ...base, pane: 'note', mainHasNote: true }).order).toEqual(['explorer', 'main']);
  });
  it('editing: explorer | editor, plus the split preview', () => {
    expect(paneLayout({ ...base, pane: 'note', editing: true }).order).toEqual(['explorer', 'editor']);
    expect(paneLayout({ ...base, pane: 'note', editing: true, split: true })).toEqual({ order: ['explorer', 'editor', 'split'], stack: null });
  });
  it('narrow split: Source | Preview tabs stack vertically', () => {
    expect(paneLayout({ ...base, pane: 'note', editing: true, split: true, splitNarrow: true })).toEqual({ order: ['explorer', 'editor'], stack: ['editor', 'split'] });
  });
  it('phone width: one column at a time', () => {
    expect(paneLayout({ ...base, narrow: true, mainHasNote: true }).order).toEqual(['explorer']);
    expect(paneLayout({ ...base, narrow: true, pane: 'note', mainHasNote: true }).order).toEqual(['main']);
    expect(paneLayout({ ...base, narrow: true, splitNarrow: true, pane: 'note', editing: true, split: true })).toEqual({ order: ['editor'], stack: ['editor', 'split'] });
  });
  it('panesOf lists stacked panes after their column', () => {
    expect(panesOf({ order: ['explorer', 'editor'], stack: ['editor', 'split'] })).toEqual(['explorer', 'editor', 'split']);
  });
});

describe('paneTarget (focus graph)', () => {
  const three = paneLayout({ ...base, pane: 'note', editing: true, split: true });
  const tabs = paneLayout({ ...base, pane: 'note', editing: true, split: true, splitNarrow: true });

  it('Ctrl-h / Ctrl-l walk left/right without wrapping', () => {
    expect(paneTarget(three, 'explorer', 'l')).toBe('editor');
    expect(paneTarget(three, 'editor', 'l')).toBe('split');
    expect(paneTarget(three, 'split', 'l')).toBeNull();
    expect(paneTarget(three, 'split', 'h')).toBe('editor');
    expect(paneTarget(three, 'editor', 'h')).toBe('explorer');
    expect(paneTarget(three, 'explorer', 'h')).toBeNull();
  });
  it('Ctrl-j / Ctrl-k have no target side by side', () => {
    expect(paneTarget(three, 'editor', 'j')).toBeNull();
    expect(paneTarget(three, 'editor', 'k')).toBeNull();
  });
  it('tabs: j/k switch, h from the preview returns to the editor', () => {
    expect(paneTarget(tabs, 'editor', 'j')).toBe('split');
    expect(paneTarget(tabs, 'split', 'k')).toBe('editor');
    expect(paneTarget(tabs, 'split', 'h')).toBe('editor');
    expect(paneTarget(tabs, 'editor', 'l')).toBe('split');
    expect(paneTarget(tabs, 'editor', 'h')).toBe('explorer');
    expect(paneTarget(tabs, 'explorer', 'l')).toBe('editor');
  });
  it('Ctrl-w w cycles with wrap; Ctrl-w p returns to the previous pane', () => {
    expect(paneTarget(three, 'explorer', 'w')).toBe('editor');
    expect(paneTarget(three, 'split', 'w')).toBe('explorer');
    expect(paneTarget(tabs, 'editor', 'w')).toBe('split');
    expect(paneTarget(three, 'split', 'p', 'explorer')).toBe('explorer');
    expect(paneTarget(three, 'split', 'p', null)).toBeNull();
    expect(paneTarget(three, 'split', 'p', 'main')).toBeNull(); // not on screen
  });
  it('single pane: nothing to move to', () => {
    const one = paneLayout(base);
    expect(paneTarget(one, 'explorer', 'l')).toBeNull();
    expect(paneTarget(one, 'explorer', 'w')).toBeNull();
  });
  it('unknown / hidden origin starts at the first pane', () => {
    expect(paneTarget(three, null, 'l')).toBe('explorer');
    expect(paneTarget(three, 'main', 'h')).toBe('explorer');
  });
});

describe('PaneKeys', () => {
  it('Ctrl-h/j/k/l are pane moves when enabled', () => {
    const k = new PaneKeys();
    for (const d of ['h', 'j', 'k', 'l']) expect(k.feed(ctrl(d), { ctrlHjkl: true })).toEqual({ kind: 'nav', dir: d, chord: false });
    expect(k.feed(ctrl('h'), { ctrlHjkl: false })).toBeNull();
    expect(k.feed(plain('h'), { ctrlHjkl: true })).toBeNull();
    expect(k.feed(ctrl('d'), { ctrlHjkl: true })).toBeNull();
    expect(k.feed(ctrl('H', { shiftKey: true }), { ctrlHjkl: true })).toBeNull();
    expect(k.feed({ ...ctrl('h'), metaKey: true }, { ctrlHjkl: true })).toBeNull();
  });
  it('Ctrl-w then h/j/k/l/w/p (also Ctrl-w Ctrl-x and arrows), even with Ctrl-hjkl off', () => {
    const k = new PaneKeys();
    for (const [second, dir] of [['h', 'h'], ['j', 'j'], ['w', 'w'], ['p', 'p'], ['ArrowRight', 'l']] as const) {
      expect(k.feed(ctrl('w'), { ctrlHjkl: false })).toEqual({ kind: 'pending' });
      expect(k.pending).toBe(true);
      expect(k.feed(plain(second), { ctrlHjkl: false })).toEqual({ kind: 'nav', dir, chord: true });
      expect(k.pending).toBe(false);
    }
    k.feed(ctrl('w'), { ctrlHjkl: false });
    expect(k.feed(ctrl('w'), { ctrlHjkl: false })).toEqual({ kind: 'nav', dir: 'w', chord: true });
    k.feed(ctrl('w'), { ctrlHjkl: false });
    expect(k.feed(ctrl('l'), { ctrlHjkl: false })).toEqual({ kind: 'nav', dir: 'l', chord: true });
  });
  it('Ctrl-w + unknown key or Esc cancels (consumed)', () => {
    const k = new PaneKeys();
    k.feed(ctrl('w'), { ctrlHjkl: true });
    expect(k.feed(plain('x'), { ctrlHjkl: true })).toEqual({ kind: 'cancel' });
    k.feed(ctrl('w'), { ctrlHjkl: true });
    expect(k.feed(plain('Escape'), { ctrlHjkl: true })).toEqual({ kind: 'cancel' });
    expect(k.feed(plain('x'), { ctrlHjkl: true })).toBeNull();
  });
  it('the Ctrl-w prefix expires', () => {
    let t = 0;
    const k = new PaneKeys(() => t);
    k.feed(ctrl('w'), { ctrlHjkl: true });
    t = PANE_CHORD_MS + 1;
    expect(k.pending).toBe(false);
    expect(k.feed(plain('h'), { ctrlHjkl: true })).toBeNull();
  });
  it('user maps: reserved keys are left alone, <C-w> aliases navigate', () => {
    const k = new PaneKeys();
    const o = { ctrlHjkl: true, reserved: new Set(['l']), aliases: new Map([['n', 'j' as const]]) };
    expect(k.feed(ctrl('l'), o)).toBeNull();
    expect(k.feed(ctrl('n'), o)).toEqual({ kind: 'nav', dir: 'j', chord: false });
    expect(k.feed(ctrl('w'), { ctrlHjkl: true, ctrlWReserved: true })).toBeNull();
  });
  it('ctrlLetter: Ctrl-h reported as Backspace, non-Latin layouts by position', () => {
    expect(ctrlLetter(ctrl('Backspace'))).toBe('h');
    expect(ctrlLetter({ ...ctrl('р'), code: 'KeyH' })).toBe('h');
    expect(ctrlLetter(ctrl('J'))).toBe('j');
    expect(ctrlLetter(plain('j'))).toBeNull();
  });
});

describe('editor routing (vim mode aware)', () => {
  const s = (over: Partial<Parameters<typeof editorPaneRoute>[2]> = {}) => ({ vim: true, mode: 'normal' as const, vimPending: false, ctrlHjkl: true, maps: [], ...over });

  it('NORMAL and VISUAL: Ctrl-hjkl navigate', () => {
    expect(editorPaneRoute(new PaneKeys(), ctrl('h'), s())).toMatchObject({ kind: 'nav', dir: 'h' });
    expect(editorPaneRoute(new PaneKeys(), ctrl('j'), s({ mode: 'visual' }))).toMatchObject({ kind: 'nav', dir: 'j' });
  });
  it('INSERT / REPLACE / vim off: left to the editor (Ctrl-h backspace, Ctrl-j newline)', () => {
    expect(editorPaneRoute(new PaneKeys(), ctrl('h'), s({ mode: 'insert' }))).toBeNull();
    expect(editorPaneRoute(new PaneKeys(), ctrl('j'), s({ mode: 'replace' }))).toBeNull();
    expect(editorPaneRoute(new PaneKeys(), ctrl('h'), s({ vim: false }))).toBeNull();
    expect(editorPaneRoute(new PaneKeys(), ctrl('w'), s({ mode: 'insert' }))).toBeNull(); // Ctrl-w deletes a word
  });
  it('mid-command (d, "a, a count) the key is vim\'s', () => {
    expect(editorPaneRoute(new PaneKeys(), ctrl('h'), s({ vimPending: true }))).toBeNull();
  });
  it('Ctrl-w chord survives into its second key', () => {
    const k = new PaneKeys();
    expect(editorPaneRoute(k, ctrl('w'), s())).toEqual({ kind: 'pending' });
    expect(editorPaneRoute(k, plain('l'), s({ vimPending: true }))).toMatchObject({ kind: 'nav', dir: 'l', chord: true });
  });
  it('entering INSERT drops a pending Ctrl-w', () => {
    const k = new PaneKeys();
    editorPaneRoute(k, ctrl('w'), s());
    editorPaneRoute(k, plain('i'), s({ mode: 'insert' }));
    expect(k.pending).toBe(false);
  });
  it('explicit .vimrc maps win; `<C-w>h` targets become pane moves', () => {
    const maps = [
      { lhs: '<C-l>', rhs: ':nohlsearch<CR>', ctx: 'normal' as const },
      { lhs: '<C-h>', rhs: '<C-w>h', ctx: undefined },
      { lhs: '<C-j>', rhs: 'gj', ctx: 'visual' as const },
    ];
    expect(editorPaneRoute(new PaneKeys(), ctrl('l'), s({ maps }))).toBeNull();
    expect(editorPaneRoute(new PaneKeys(), ctrl('h'), s({ maps, ctrlHjkl: false }))).toMatchObject({ kind: 'nav', dir: 'h' });
    // The visual-only map does not affect NORMAL.
    expect(editorPaneRoute(new PaneKeys(), ctrl('j'), s({ maps }))).toMatchObject({ kind: 'nav', dir: 'j' });
    expect(editorPaneRoute(new PaneKeys(), ctrl('j'), s({ maps, mode: 'visual' }))).toBeNull();
  });
  it('userPaneKeys: any <C-w>… map hands Ctrl-w to vim', () => {
    expect(userPaneKeys([{ lhs: '<C-w>v', rhs: ':vsplit<CR>', ctx: 'normal' }], 'normal').ctrlWReserved).toBe(true);
    expect(userPaneKeys([{ lhs: '<c-k>', rhs: '<c-w><c-k>', ctx: 'normal' }], 'normal').aliases?.get('k')).toBe('k');
  });
  it('vimMidCommand reads the engine input state', () => {
    expect(vimMidCommand(undefined)).toBe(false);
    expect(vimMidCommand({ operator: null, prefixRepeat: [], motionRepeat: [], keyBuffer: [], registerName: null })).toBe(false);
    expect(vimMidCommand({ operator: 'delete' })).toBe(true);
    expect(vimMidCommand({ prefixRepeat: ['3'] })).toBe(true);
    expect(vimMidCommand({ keyBuffer: ['g'] })).toBe(true);
    expect(vimMidCommand({ registerName: 'a' })).toBe(true);
  });
  it('only a plain Ctrl-k falls through when there is no pane that way', () => {
    expect(fallsThroughWithoutTarget({ dir: 'k', chord: false })).toBe(true);
    expect(fallsThroughWithoutTarget({ dir: 'k', chord: true })).toBe(false);
    expect(fallsThroughWithoutTarget({ dir: 'h', chord: false })).toBe(false);
    expect(fallsThroughWithoutTarget({ dir: 'j', chord: false })).toBe(false);
  });
});
