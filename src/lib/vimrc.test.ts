import { describe, it, expect } from 'vitest';
import {
  parseVimrc,
  normalizeKeys,
  parseLeaderValue,
  sanitizeVimrc,
  errorCount,
  displayLhs,
  MAX_VIMRC_BYTES,
  MAX_VIMRC_MAPS,
  VIMRC_EXAMPLE,
} from './vimrc.ts';
import { sanitizeSettings, defaultSettings } from './editor-settings.ts';

const sev = (src: string) => parseVimrc(src).diagnostics.map((d) => `${d.line}:${d.severity}`);

describe('normalizeKeys', () => {
  it('canonicalises key notation case', () => {
    expect(normalizeKeys('<cr>').keys).toBe('<CR>');
    expect(normalizeKeys('<ESC>').keys).toBe('<Esc>');
    expect(normalizeKeys('<c-D>').keys).toBe('<C-d>');
    expect(normalizeKeys('<S-Tab>').keys).toBe('<S-Tab>');
    expect(normalizeKeys('<space>x').keys).toBe('<Space>x');
    expect(normalizeKeys('<a-c-x>').keys).toBe('<C-A-x>');
    expect(normalizeKeys('<f5>').keys).toBe('<F5>');
    expect(normalizeKeys('a<bar>b').keys).toBe('a|b');
  });
  it('expands <leader> with the given leader', () => {
    expect(normalizeKeys('<leader>w', ',').keys).toBe(',w');
    expect(normalizeKeys('<Leader>w', '<Space>').keys).toBe('<Space>w');
  });
  it('rejects unknown names but keeps a literal <', () => {
    expect(normalizeKeys('<foo>').error).toMatch(/unknown key/);
    expect(normalizeKeys('<x>').error).toMatch(/unknown key/);
    expect(normalizeKeys('a < b').keys).toBe('a < b');
  });
});

describe('parseLeaderValue', () => {
  it('accepts quoted single keys and \\<Space>', () => {
    expect(parseLeaderValue('" "')).toBe('<Space>');
    expect(parseLeaderValue('"\\<Space>"')).toBe('<Space>');
    expect(parseLeaderValue("','")).toBe(',');
    expect(parseLeaderValue('"\\\\"')).toBe('\\');
  });
  it('rejects expressions and multi-key values', () => {
    expect(parseLeaderValue('g:foo')).toBeNull();
    expect(parseLeaderValue('"ab"')).toBeNull();
    expect(parseLeaderValue('system("x")')).toBeNull();
  });
});

describe('parseVimrc', () => {
  it('parses maps by mode, with noremap and flags', () => {
    const p = parseVimrc(`
" comment
nnoremap <silent> H ^
inoremap jj <Esc>
vmap < <gv
xnoremap > >gv
map Y y$
:nmap <C-j> 5j
`);
    expect(p.maps.map((m) => `${m.mode}|${m.noremap}|${m.lhs}|${m.rhs}`)).toEqual([
      'normal|true|H|^',
      'insert|true|jj|<Esc>',
      'visual|false|<|<gv',
      'visual|true|>|>gv',
      'all|false|Y|y$',
      'normal|false|<C-j>|5j',
    ]);
    expect(p.diagnostics).toEqual([]);
  });

  it('records leader maps behind the leader and expands leader in rhs', () => {
    const p = parseVimrc('let mapleader = " "\nnnoremap <leader>w :w<CR>\ninoremap <leader>x X');
    expect(p.leader).toBe('<Space>');
    expect(p.maps[0]).toMatchObject({ lhs: 'w', leader: true, rhs: ':w<CR>' });
    expect(displayLhs(p.maps[0], p.leader)).toBe('<Space>w');
    // Insert-mode leader maps stay literal (the leader is just typed).
    expect(p.maps[1]).toMatchObject({ lhs: '<Space>x', mode: 'insert' });
    expect(p.maps[1].leader).toBeUndefined();
  });

  it('leader changes apply to later lines only (vim semantics)', () => {
    const p = parseVimrc('nnoremap <leader>a A\nlet mapleader=","\nnnoremap x <leader>b');
    expect(p.maps[0]).toMatchObject({ lhs: 'a', leader: true });
    expect(p.maps[1].rhs).toBe(',b');
    expect(p.leader).toBe(',');
  });

  it('a later map of the same lhs replaces the earlier one', () => {
    const p = parseVimrc('nnoremap H ^\nnnoremap H 0');
    expect(p.maps).toHaveLength(1);
    expect(p.maps[0].rhs).toBe('0');
  });

  it('unmap removes a mapping defined above; warns otherwise', () => {
    const p = parseVimrc('nnoremap H ^\nnunmap H\nunmap Q');
    expect(p.maps).toEqual([]);
    expect(sev('nnoremap H ^\nnunmap H\nunmap Q')).toEqual(['3:warning']);
    expect(parseVimrc('let mapleader=","\nnnoremap <leader>q :q<CR>\nnunmap <leader>q').maps).toEqual([]);
  });

  it('set options: booleans, no-forms, numbers, comments', () => {
    const p = parseVimrc('set number norelativenumber nowrap " comment\nset ts=2 sw=4 et\nset expandtab');
    expect(p.options).toEqual({ number: true, relativenumber: false, wrap: false, tabstop: 2, shiftwidth: 4, expandtab: true });
    expect(p.diagnostics).toEqual([]);
  });

  it('set: always-on search options are infos; unknown options warn; bad numbers error', () => {
    expect(sev('set ignorecase smartcase hlsearch incsearch')).toEqual(['1:info', '1:info', '1:info', '1:info']);
    expect(sev('set noincsearch')).toEqual(['1:warning']);
    expect(sev('set foldmethod=marker')).toEqual(['1:warning']);
    expect(sev('set ts=99')).toEqual(['1:error']);
    expect(sev('set number!')).toEqual(['1:warning']);
    expect(sev('set tabstop')).toEqual(['1:error']);
  });

  it('never evaluates: let / call / autocmd / function are reported, not run', () => {
    const d = parseVimrc('let g:x = system("rm -rf /")\ncall Foo()\nautocmd BufRead * echo 1\nfunction! F()\nnnoremap <expr> x "y"\nPlug \'tpope/vim-surround\'').diagnostics;
    expect(d.map((x) => x.severity)).toEqual(['warning', 'warning', 'warning', 'warning', 'error', 'warning']);
    expect(parseVimrc('nnoremap <expr> x "y"').maps).toEqual([]);
  });

  it('reports malformed lines with their line number', () => {
    const d = parseVimrc('\nnnoremap\nnnoremap x\nnmap <bogus> x\nfrobnicate\n  \\ continuation').diagnostics;
    expect(d.map((x) => `${x.line}:${x.severity}`)).toEqual(['2:error', '3:error', '4:error', '5:error', '6:error']);
  });

  it('ex aliases need plain map/noremap', () => {
    expect(parseVimrc('map :W :write').maps[0]).toMatchObject({ mode: 'all', lhs: ':W', rhs: ':write' });
    expect(sev('nmap :W :write')).toEqual(['1:error']);
  });

  it('ignores syntax/filetype/colorscheme with an info', () => {
    expect(sev('syntax on\nfiletype plugin indent on\ncolorscheme gruvbox\nset nocompatible')).toEqual([
      '1:info',
      '2:info',
      '3:info',
      '4:info',
    ]);
  });

  it('caps size and mapping count', () => {
    const many = Array.from({ length: MAX_VIMRC_MAPS + 5 }, (_, i) => `nnoremap <F${(i % 12) + 1}>${i} x`).join('\n');
    const p = parseVimrc(many);
    expect(p.maps.length).toBe(MAX_VIMRC_MAPS);
    expect(errorCount(p)).toBe(5);
    const huge = parseVimrc('" x\n'.repeat(MAX_VIMRC_BYTES));
    expect(huge.diagnostics[0].severity).toBe('error');
  });

  it('the bundled example parses cleanly', () => {
    const p = parseVimrc(VIMRC_EXAMPLE);
    expect(errorCount(p)).toBe(0);
    expect(p.diagnostics).toEqual([]);
  });
});

describe('storage', () => {
  it('sanitizeVimrc strips control chars and caps size', () => {
    expect(sanitizeVimrc('a\u0000b\r\nc\td')).toBe('ab\nc\td');
    expect(sanitizeVimrc(42)).toBe('');
    expect(new TextEncoder().encode(sanitizeVimrc('x'.repeat(MAX_VIMRC_BYTES * 2))).length).toBeLessThanOrEqual(MAX_VIMRC_BYTES);
  });
  it('editor settings persist the vimrc, legend and prose font', () => {
    const s = sanitizeSettings({ vimrc: 'set nu', legend: false, proseFont: 'serif' });
    expect(s.vimrc).toBe('set nu');
    expect(s.legend).toBe(false);
    expect(s.proseFont).toBe('serif');
    expect(sanitizeSettings({ proseFont: 'comic' }).proseFont).toBe(defaultSettings().proseFont);
    expect(defaultSettings().legend).toBe(true);
  });
});
