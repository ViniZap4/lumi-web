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
