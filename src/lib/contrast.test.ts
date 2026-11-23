// Body text must stay legible in every theme (WCAG AA ≥ 4.5:1 for
// text on the background; rendered markdown body uses --color-text).
import { describe, it, expect } from 'vitest';
import { themes, themeOrder } from './themes.ts';

function lum(hex: string): number {
  const h = hex.replace('#', '');
  const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a: string, b: string): number {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

describe('theme contrast', () => {
  it('has 12+ themes', () => expect(themeOrder.length).toBeGreaterThanOrEqual(12));
  for (const name of themeOrder) {
    it(`${name}: body text ≥ 4.5:1, links (primary) ≥ 3:1`, () => {
      const t = themes[name];
      expect(contrast(t.text, t.background)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t.primary, t.background)).toBeGreaterThanOrEqual(3);
    });
  }
});

/** CSS `color-mix(in srgb, a p%, b)` for opaque hex colours. */
function mix(a: string, b: string, p: number): string {
  const rgb = (h: string) => [0, 2, 4].map((i) => parseInt(h.replace('#', '').slice(i, i + 2), 16));
  const [x, y] = [rgb(a), rgb(b)];
  return '#' + x.map((v, i) => Math.round(v * p + y[i] * (1 - p)).toString(16).padStart(2, '0')).join('');
}

// The prose tokens in app.css (--md-dim for quotes/captions, inline
// code on --md-inline-bg, code blocks on --md-code-bg) must not cost
// much legibility. Some light themes' body text is itself close to AA
// (tokyo-day 4.74:1), so the bounds are relative to the body text,
// with an absolute floor.
describe('prose token contrast', () => {
  for (const name of themeOrder) {
    it(`${name}: quotes, inline code and code blocks stay legible`, () => {
      const t = themes[name];
      const body = contrast(t.text, t.background);
      const dim = contrast(mix(t.text, t.background, 0.82), t.background);
      expect(dim).toBeGreaterThanOrEqual(3);
      expect(dim / body).toBeGreaterThanOrEqual(0.6);
      const pill = contrast(t.text, mix(t.text, t.background, 0.07));
      // AAA (7:1) where the theme has it to spare, else ≤ 15% loss.
      expect(pill).toBeGreaterThanOrEqual(Math.min(7, body * 0.85));
      const code = contrast(t.text, mix(t.text, t.background, 0.04));
      expect(code).toBeGreaterThanOrEqual(Math.min(7, body * 0.88));
    });
  }
});
