// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { planVimMappings, applyVimConfig, _resetVimConfigForTests, type VimApiLike } from './vim-config.ts';
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
      { lhs: 'jk', rhs: '<Esc>', ctx: 'insert', noremap: false },
      { lhs: 'ff', rhs: '<Esc>', ctx: 'insert', noremap: false },
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
    expect(plan.map((p) => `${p.ctx}:${p.lhs}->${p.rhs}`)).toEqual(['insert:jk-><Esc>', 'normal:H->^']);
  });
});

describe('applyVimConfig', () => {
  it('maps, sets the timeout, and unmaps the previous set on re-apply', () => {
    const v = new FakeVim();
    applyVimConfig(v, { ...defaultSettings(), escapeSequences: ['jk'], escapeTimeout: 300, mappings: [{ mode: 'normal', lhs: 'H', rhs: '^', noremap: true }] });
    expect(v.log).toEqual(['map insert jk <Esc>', 'noremap normal H ^']);
    expect(v.options.insertModeEscKeysTimeout).toBe(300);
    v.log = [];
    applyVimConfig(v, { ...defaultSettings(), escapeSequences: ['ff'] });
    expect(v.log).toEqual(['unmap insert jk', 'unmap normal H', 'map insert ff <Esc>']);
  });
  it('skips mappings the engine rejects', () => {
    const v = new FakeVim();
    v.throwOn.add('jk');
    const applied = applyVimConfig(v, { ...defaultSettings(), escapeSequences: ['jk', 'jj'] });
    expect(applied.map((a) => a.lhs)).toEqual(['jj']);
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
});
