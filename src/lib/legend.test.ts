import { describe, it, expect } from 'vitest';
import { legendFor, describeRhs, contextForVimMode, fitLegend } from './legend.ts';

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
    expect(keys(legendFor('normal', 'z')).slice(0, 4)).toEqual(['zz', 'zt', 'zb', 'za']);
    expect(keys(legendFor('normal', 'd'))).toContain('dd');
    expect(keys(legendFor('normal', '3'))).toContain('3j');
  });
  it('leader pending lists the leader maps', () => {
    const items = legendFor('normal', ',', { leader: ',', leaderMaps: [{ keys: 'w', rhs: ':w<CR>' }, { keys: 'l', rhs: ':link<CR>' }] });
    expect(items.map((i) => [i.keys, i.label, i.do])).toEqual([[',w', 'save', 'ex:w'], [',l', 'insert link', 'ex:link']]);
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

describe('fitLegend', () => {
  it('shows everything when it fits (no overflow)', () => {
    expect(fitLegend([50, 60, 70], 200, 10)).toEqual({ shown: [0, 1, 2], overflow: false });
    expect(fitLegend([50, 60, 70], 200, 10).shown).toHaveLength(3);
  });
  it('fills in priority order and reserves room for the overflow marker', () => {
    // 100 + 16 + 100 = 216 > 200 → reserve 20: room = 200 - 20 - 16 = 164.
    expect(fitLegend([100, 100, 30], 200, 16, 20)).toEqual({ shown: [0, 30 > 0 ? 2 : 1], overflow: true });
  });
  it('skips a wide item but keeps smaller lower-priority ones', () => {
    const r = fitLegend([80, 200, 40, 40], 220, 10, 0);
    expect(r.shown).toEqual([0, 2, 3]);
    expect(r.overflow).toBe(true);
  });
  it('shows nothing when there is no room', () => {
    expect(fitLegend([80, 90], 10, 8, 10)).toEqual({ shown: [], overflow: true });
  });
  it('a wide window shows the extras (marks, registers, folds)', () => {
    const items = legendFor('normal', null, { source: true, split: true });
    // ~6.6px per mono char at 11px + the 6px key/label gap.
    const widths = items.map((i) => (i.keys.length + i.label.length) * 6.6 + 6);
    const wide = fitLegend(widths, 1880, 16);
    expect(wide.overflow).toBe(false);
    expect(items.map((i) => i.keys)).toEqual(expect.arrayContaining(['za', '"a', '\\p']));
    const narrow = fitLegend(widths, 600, 16, 24);
    expect(narrow.overflow).toBe(true);
    expect(narrow.shown[0]).toBe(0);
    expect(narrow.shown.length).toBeLessThan(items.length);
  });
  it('items with actions are clickable in every main context', () => {
    for (const ctx of ['explorer', 'reader', 'normal', 'insert', 'visual'] as const) {
      expect(legendFor(ctx).filter((i) => i.do).length).toBeGreaterThan(3);
    }
  });
});
