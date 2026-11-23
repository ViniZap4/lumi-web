// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { planVimMappings, applyVimConfig, effectiveSettings, feedLeader, _resetVimConfigForTests, type VimApiLike } from './vim-config.ts';
import { defaultSettings } from './editor-settings.ts';

class FakeVim implements VimApiLike {
  log: string[] = [];
  options: Record<string, unknown> = {};
  throwOn = new Set<string>();
  map(lhs: string, rhs: string, ctx?: string) {
    if (this.throwOn.has(lhs)) throw new Error('bad');
    this.log.push(`map ${ctx} ${lhs} ${rhs}`);
  }
  noremap(lhs: string, rhs: string, ctx?: string) { this.log.push(`noremap ${ctx} ${lhs} ${rhs}`); }
  unmap(lhs: string, ctx?: string) { this.log.push(`unmap ${ctx} ${lhs}`); return true; }
  setOption(name: string, value: unknown) { this.options[name] = value; }
}

beforeEach(() => _resetVimConfigForTests());

describe('planVimMappings', () => {
  it('escape sequences become insert-mode maps to <Esc>', () => {
    expect(planVimMappings({ escapeSequences: ['jk', 'ff'], mappings: [] })).toEqual([
      { lhs: 'jk', rhs: '<Esc>', ctx: 'insert', noremap: false, source: 'escape' },
      { lhs: 'ff', rhs: '<Esc>', ctx: 'insert', noremap: false, source: 'escape' },
      { lhs: '<F35>l', rhs: ':link<CR>', ctx: 'normal', noremap: false, source: 'default', display: '\\l' },
    ]);
  });
  it('appends user mappings; first wins on duplicate (mode, lhs)', () => {
    const plan = planVimMappings({
      escapeSequences: ['jk'],
      mappings: [
        { mode: 'insert', lhs: 'jk', rhs: 'x', noremap: true },
        { mode: 'normal', lhs: 'H', rhs: '^', noremap: true },
      ],
    });
    expect(plan.map((p) => `${p.ctx}:${p.lhs}->${p.rhs}`)).toEqual(['insert:jk-><Esc>', 'normal:H->^', 'normal:<F35>l->:link<CR>']);
  });
});

describe('applyVimConfig', () => {
  it('maps, sets the timeout, and unmaps the previous set on re-apply', () => {
    const v = new FakeVim();
    applyVimConfig(v, { ...defaultSettings(), escapeSequences: ['jk'], escapeTimeout: 300, mappings: [{ mode: 'normal', lhs: 'H', rhs: '^', noremap: true }] });
    expect(v.log).toEqual(['map insert jk <Esc>', 'noremap normal H ^', 'map normal <F35>l :link<CR>']);
    expect(v.options.insertModeEscKeysTimeout).toBe(300);
    v.log = [];
    applyVimConfig(v, { ...defaultSettings(), escapeSequences: ['ff'] });
    expect(v.log).toEqual(['unmap insert jk', 'unmap normal H', 'unmap normal <F35>l', 'map insert ff <Esc>', 'map normal <F35>l :link<CR>']);
  });
  it('skips mappings the engine rejects', () => {
    const v = new FakeVim();
    v.throwOn.add('jk');
    const applied = applyVimConfig(v, { ...defaultSettings(), escapeSequences: ['jk', 'jj'] });
    expect(applied.map((a) => a.lhs)).toEqual(['jj', '<F35>l']);
  });

  it('applies vimrc maps (all-mode maps without a context) and the vimrc leader', () => {
    const v = new FakeVim();
    const vimrc = 'let mapleader=" "\nnnoremap <leader>w :w<CR>\nmap Y y$\ninoremap jj <Esc>';
    applyVimConfig(v, { ...defaultSettings(), vimrc });
    expect(v.log).toEqual([
      'noremap normal <F35>w :w<CR>',
      'map undefined Y y$',
      'noremap insert jj <Esc>',
      'map normal <F35>l :link<CR>',
    ]);
  });

  it('unmaps vimrc maps removed on re-apply (and ex aliases without a context)', () => {
    const v = new FakeVim();
    applyVimConfig(v, { ...defaultSettings(), vimrc: 'nnoremap H ^\nmap :W :write\ninoremap jj <Esc>' });
    v.log = [];
    applyVimConfig(v, { ...defaultSettings(), vimrc: 'inoremap jj <Esc>' });
    expect(v.log).toEqual([
      'unmap normal H',
      'unmap undefined :W',
      'unmap insert jj',
      'unmap normal <F35>l',
      'noremap insert jj <Esc>',
      'map normal <F35>l :link<CR>',
    ]);
  });

  it('a vimrc `unmap` drops the mapping it follows', () => {
    const v = new FakeVim();
    applyVimConfig(v, { ...defaultSettings(), vimrc: 'nnoremap H ^\nnunmap H' });
    expect(v.log).toEqual(['map normal <F35>l :link<CR>']);
  });

  it('vimrc can rebind the default <leader>l', () => {
    const plan = planVimMappings({ escapeSequences: [], mappings: [], vimrc: 'nnoremap <leader>l :q<CR>' });
    expect(plan.filter((p) => p.lhs === '<F35>l')).toEqual([{ lhs: '<F35>l', rhs: ':q<CR>', ctx: 'normal', noremap: true, source: 'vimrc', display: '\\l' }]);
  });

  it('ignores the vimrc while vim is off', () => {
    const v = new FakeVim();
    applyVimConfig(v, { ...defaultSettings(), vim: false, vimrc: 'nnoremap H ^' });
    expect(v.log).toEqual(['map normal <F35>l :link<CR>']);
  });
});

describe('effectiveSettings', () => {
  it('vimrc `set` options override the device settings while vim is on', () => {
    const s = { ...defaultSettings(), vimrc: 'set number norelativenumber nowrap ts=2 sw=8 noexpandtab' };
    const e = effectiveSettings(s);
    expect(e.lineNumbers).toBe(true);
    expect(e.relativeLineNumbers).toBe(false);
    expect(e.lineWrapping).toBe(false);
    expect(e.tabSize).toBe(2);
    expect(e.indentWidth).toBe(8);
    expect(e.indentWithSpaces).toBe(false);
    expect([...e.overridden].sort()).toEqual(['lineNumbers', 'lineWrapping', 'relativeLineNumbers', 'tabSize']);
    const off = effectiveSettings({ ...s, vim: false });
    expect(off.lineNumbers).toBe(false);
    expect(off.overridden).toEqual([]);
  });
  it('indent width follows tabstop when shiftwidth is unset', () => {
    const e = effectiveSettings({ ...defaultSettings(), vimrc: 'set tabstop=8' });
    expect(e.indentWidth).toBe(8);
    expect(e.indentWithSpaces).toBe(true);
  });
});

describe('real vim engine', () => {
  it('a mapped `jk` leaves insert mode and removes the typed `j`; lone `j` types', async () => {
    const { EditorView } = await import('@codemirror/view');
    const { EditorState } = await import('@codemirror/state');
    const { vim, Vim, getCM } = await import('@replit/codemirror-vim');
    applyVimConfig(Vim as unknown as VimApiLike, { ...defaultSettings(), escapeSequences: ['jk'] });
    const view = new EditorView({ state: EditorState.create({ doc: 'ab', extensions: [vim()] }), parent: document.body });
    const cm = getCM(view)!;
    view.dispatch({ selection: { anchor: 2 } });
    Vim.handleKey(cm, 'A', 'user'); // append → insert mode at end
    expect(cm.state.vim!.insertMode).toBe(true);
    // Partial match: vim lets the browser type `j` (simulated here).
    expect(Vim.handleKey(cm, 'j', 'user')).toBeFalsy();
    view.dispatch({ changes: { from: view.state.doc.length, insert: 'j' }, selection: { anchor: 3 } });
    Vim.handleKey(cm, 'k', 'user');
    expect(cm.state.vim!.insertMode).toBe(false);
    expect(view.state.doc.toString()).toBe('ab');
    applyVimConfig(Vim as unknown as VimApiLike, defaultSettings());
    view.destroy();
  });

  it('a vimrc `inoremap jj <Esc>` and leader map work in the real engine', async () => {
    const { EditorView } = await import('@codemirror/view');
    const { EditorState } = await import('@codemirror/state');
    const { vim, Vim, getCM } = await import('@replit/codemirror-vim');
    let linked = 0;
    Vim.defineEx('link', 'link', () => { linked++; });
    applyVimConfig(Vim as unknown as VimApiLike, { ...defaultSettings(), vimrc: 'let mapleader = " "\nnnoremap <leader>x dd' });
    const view = new EditorView({ state: EditorState.create({ doc: 'one\ntwo', extensions: [vim()] }), parent: document.body });
    const cm = getCM(view)!;
    const leader = (k: string) => {
      if (!feedLeader((t) => Vim.handleKey(cm, t, 'user'), cm.state.vim, k === ' ' ? '<Space>' : k, '<Space>')) Vim.handleKey(cm, k, 'user');
    };
    leader(' ');
    leader('x');
    expect(view.state.doc.toString()).toBe('two');
    leader(' ');
    leader('l');
    expect(linked).toBe(1);
    // Re-apply without the vimrc: the leader map is gone again.
    applyVimConfig(Vim as unknown as VimApiLike, defaultSettings());
    expect(feedLeader(() => {}, cm.state.vim, '<Space>', '\\')).toBe(false);
    view.destroy();
  });
});
