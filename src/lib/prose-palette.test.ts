// @vitest-environment jsdom
// The rich prose palette must stay legible in every theme (light and
// dark): each derived colour clears its WCAG floor on the surface it
// is drawn on, and the palette stays rich (headings are not just the
// body colour).
import { describe, it, expect } from 'vitest';
import { themes, themeOrder } from './themes.ts';
import { proseVars, proseSurfaces, contrast, ensureContrast, mix, tagHue, TAG_HUES, themeGreen, calloutColours } from './prose-palette.ts';
import { renderMarkdown } from './markdown.ts';

describe('prose palette contrast (all themes)', () => {
  for (const name of themeOrder) {
    it(`${name}: every prose colour clears its floor`, () => {
      const t = themes[name];
      const v = proseVars(t);
      const s = proseSurfaces(t);
      const on = (k: string, bg: string, min: number) => expect(contrast(v[k], bg), `${name} ${k}`).toBeGreaterThanOrEqual(min - 1e-9);
      for (const k of ['--md-h1', '--md-h2', '--md-h3', '--md-h4', '--md-h5', '--md-strong', '--md-em', '--md-link']) on(k, s.bg, 4.5);
      on('--md-list-marker', s.bg, 3);
      on('--md-del', s.bg, 3);
      on('--md-code-fg', s.inlineBg, 4.5);
      on('--md-mark-fg', s.markBg, 4.5);
      on('--md-quote-fg', s.quoteBg, 4.5);
      on('--md-th-fg', s.thBg, 4.5);
      for (const k of ['--syn-keyword', '--syn-string', '--syn-number', '--syn-function', '--syn-type', '--syn-property', '--syn-tag']) on(k, s.codeBg, 4.5);
      on('--syn-comment', s.codeBg, 3);
      for (const kind of Object.keys(calloutColours(t))) on(`--md-callout-${kind}-ink`, s.calloutBg(v[`--md-callout-${kind}`]), 4.5);
      for (let i = 0; i < TAG_HUES; i++) on(`--md-tag-${i}-ink`, s.tagBg(v[`--md-tag-${i}`]), 4.5);
    });
    it(`${name}: the palette is rich, not one colour`, () => {
      const v = proseVars(themes[name]);
      const distinct = new Set([v['--md-h1'], v['--md-h2'], v['--md-h3'], v['--md-link'], v['--md-code-fg'], v['--md-strong'], themes[name].text]);
      expect(distinct.size).toBeGreaterThanOrEqual(6);
      // Callouts keep semantic colours: warning ≠ danger ≠ tip.
      expect(new Set([v['--md-callout-warning'], v['--md-callout-danger'], v['--md-callout-tip']]).size).toBe(3);
    });
  }
});

describe('prose palette helpers', () => {
  it('ensureContrast keeps a colour that already passes', () => {
    expect(ensureContrast('#ffffff', '#000000', '#cccccc', 4.5)).toBe('#ffffff');
  });
  it('ensureContrast pulls toward the text colour until it passes', () => {
    const c = ensureContrast('#f5a9b8', '#d6d6d6', '#2b2d42', 4.5);
    expect(contrast(c, '#d6d6d6')).toBeGreaterThanOrEqual(4.5);
    expect(c).not.toBe('#2b2d42');
  });
  it('mix matches color-mix(in srgb)', () => {
    expect(mix('#ff0000', '#0000ff', 0.5)).toBe('#800080');
  });
  it('themeGreen finds the theme green, else a default', () => {
    expect(themeGreen(themes['lgbt-dark'])).toBe('#6bcb77');
    expect(themeGreen(themes['tokyo-night'])).toBe('#9ece6a');
  });
  it('tagHue is stable and in range', () => {
    expect(tagHue('research')).toBe(tagHue('research'));
    for (const n of ['a', 'design/motion', 'lumi', 'x']) expect(tagHue(n)).toBeLessThan(TAG_HUES);
  });
});

describe('markdown tags', () => {
  it('renders #tags as chips, not headings, numbers or mid-word hashes', () => {
    const html = renderMarkdown('Tagged #research and #design/motion, issue #12, a#b.');
    expect(html).toContain('class="md-tag"');
    expect(html).toContain('>#research</span>');
    expect(html).toContain('>#design/motion</span>');
    expect(html).not.toContain('>#12<');
    expect(html).not.toContain('>#b<');
  });
  it('leaves headings and code alone', () => {
    const html = renderMarkdown('# Title\n\n`#notatag`');
    expect(html).not.toContain('md-tag');
  });
});
