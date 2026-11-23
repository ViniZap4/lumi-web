import { describe, it, expect } from 'vitest';
import { legendFor, describeRhs, contextForVimMode } from './legend.ts';

const keys = (items: { keys: string }[]) => items.map((i) => i.keys);

describe('legendFor', () => {
  it('explorer and reader basics', () => {
    expect(keys(legendFor('explorer'))).toEqual(expect.arrayContaining(['j k', 'a', 'r', 'd', '/', '?']));
    expect(keys(legendFor('reader'))).toEqual(expect.arrayContaining(['j k', 'e i', 'q h']));
  });
  it('pending chords and counts in the shell', () => {
    expect(keys(legendFor('explorer', 'g'))).toEqual(['gg', 'ge', 'gh', 'gb', 'g1–9']);
    expect(keys(legendFor('reader', 'z'))).toEqual(['zp', 'zh']);
    expect(keys(legendFor('explorer', '5'))).toEqual(['5j', '5k', 'Esc']);
    expect(keys(legendFor('explorer', '5g'))).toEqual(['gg', 'ge', 'gh', 'gb', 'g1–9']);
  });
  it('vim modes', () => {
    expect(keys(legendFor('normal'))).toContain(':q');
    expect(keys(legendFor('normal', null, { leader: '<Space>' }))).toContain('<Space>l');
    expect(keys(legendFor('insert', null, { escapeSequences: ['jj'] }))[0]).toBe('Esc jj');
    expect(keys(legendFor('visual'))).toContain('⌘K');
    expect(keys(legendFor('normal', 'g'))).toContain('gg');
    expect(keys(legendFor('normal', 'z'))).toEqual(['zz', 'zt', 'zb']);
    expect(keys(legendFor('normal', 'd'))).toContain('dd');
    expect(keys(legendFor('normal', '3'))).toContain('3j');
  });
  it('leader pending lists the leader maps', () => {
    const items = legendFor('normal', ',', { leader: ',', leaderMaps: [{ keys: 'w', rhs: ':w<CR>' }, { keys: 'l', rhs: ':link<CR>' }] });
    expect(items).toEqual([{ keys: ',w', label: 'save' }, { keys: ',l', label: 'insert link' }]);
  });
  it('overlays', () => {
    expect(keys(legendFor('palette'))).toContain('⏎');
    expect(keys(legendFor('confirm'))).toEqual(['y ⏎', 'n Esc']);
    expect(keys(legendFor('prompt'))).toContain('dir/');
    expect(keys(legendFor('filter'))).toContain('Esc');
    expect(keys(legendFor('books'))).toContain('g1–9');
  });
});

describe('helpers', () => {
  it('describeRhs', () => {
    expect(describeRhs(':w<CR>')).toBe('save');
    expect(describeRhs(':Foo bar<CR>')).toBe(':Foo bar');
    expect(describeRhs('ggVG')).toBe('ggVG');
  });
  it('contextForVimMode', () => {
    expect(contextForVimMode('insert')).toBe('insert');
    expect(contextForVimMode('visual', 'linewise')).toBe('visual');
    expect(contextForVimMode('normal')).toBe('normal');
    expect(contextForVimMode(undefined)).toBe('normal');
  });
});
