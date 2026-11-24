// Prose colour palette (docs/DESIGN-LANGUAGE.md §2.5). Rendered
// markdown used to be one colour; this derives a rich but calm palette
// from each theme's own colours — a heading ramp, link, bold/italic,
// inline code, syntax, callouts, tags — and guarantees contrast: every
// colour is pulled toward the theme's text colour (in sRGB, in 4 %
// steps) until it clears its floor against the surface it sits on.
// applyTheme() writes the result as CSS custom properties; app.css
// falls back to plain theme tokens when they are absent.

import type { Theme } from './themes.ts';

type RGB = [number, number, number];

export function hexToRgb(hex: string): RGB {
  const h = hex.replace('#', '');
  const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6);
  return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16)) as RGB;
}

export function rgbToHex([r, g, b]: RGB): string {
  return '#' + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
}

/** `color-mix(in srgb, a p, b)` for opaque colours (p in 0..1). */
export function mix(a: string, b: string, p: number): string {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  return rgbToHex([0, 1, 2].map((i) => x[i] * p + y[i] * (1 - p)) as RGB);
}

function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((c) => c / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** `c` pulled toward `toward` until it reaches `min` contrast on `bg`
 *  (or becomes `toward`). Keeps as much of the hue as the floor allows. */
export function ensureContrast(c: string, bg: string, toward: string, min: number): string {
  for (let k = 0; k <= 25; k++) {
    const m = mix(c, toward, 1 - k * 0.04);
    if (contrast(m, bg) >= min) return m;
  }
  return toward;
}

function hsl(hex: string): { h: number; s: number; l: number } {
  const [r, g, b] = hexToRgb(hex).map((c) => c / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (!d) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return { h, s, l };
}

/** A green from the theme when it has one (lgbt-dark's accent, …),
 *  else a calm default for the theme's brightness. Used for strings,
 *  inline code and the "tip / success" callouts. */
export function themeGreen(t: Theme): string {
  const pool = [t.accent, t.info, t.secondary, t.primary, ...t.logoColors];
  const g = pool.find((c) => {
    const x = hsl(c);
    return x.h >= 80 && x.h <= 165 && x.s > 0.25;
  });
  return g ?? (t.isDark ? '#9ece6a' : '#3f7d32');
}

/** Callout kinds → their semantic base colour. */
export function calloutColours(t: Theme): Record<string, string> {
  const green = themeGreen(t);
  return {
    note: t.info,
    info: t.info,
    todo: t.primary,
    abstract: t.accent,
    tip: green,
    success: green,
    question: t.secondary,
    example: t.secondary,
    warning: t.warning,
    danger: t.error,
    quote: t.muted,
  };
}

/** Alpha of a colour composited over `bg` (for tinted backgrounds). */
export function over(c: string, bg: string, alpha: number): string {
  return mix(c, bg, alpha);
}

export const TAG_HUES = 5;

/** Stable hue slot for a tag name (0..TAG_HUES-1). */
export function tagHue(name: string): number {
  // FNV-1a (a multiplier ≡ 1 mod 5 would just sum the characters).
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 0x01000193) >>> 0;
  return h % TAG_HUES;
}

/** Contrast floors (WCAG): body-size text 4.5:1, large headings 3:1. */
export const FLOOR = { text: 4.5, large: 3, ui: 3 } as const;

/** Surfaces the colours are checked against (composited). */
/** The strongest tint (of `alphas`) that keeps body text ≥ 4.5:1. */
function tintAlpha(c: string, t: Theme, alphas: number[]): number {
  return alphas.find((a) => contrast(t.text, mix(c, t.background, a)) >= FLOOR.text) ?? 0;
}

export function proseSurfaces(t: Theme) {
  const bg = t.background;
  const green = themeGreen(t);
  const minA = (cs: string[], alphas: number[]) => Math.min(...cs.map((c) => tintAlpha(c, t, alphas)));
  const inlineA = tintAlpha(green, t, [0.12, 0.09, 0.06, 0.04]);
  const markA = tintAlpha(t.warning, t, t.isDark ? [0.3, 0.24, 0.18] : [0.38, 0.3, 0.22, 0.16, 0.1]);
  const quoteA = tintAlpha(t.secondary, t, [0.06, 0.04, 0.025, 0.015]);
  const tagA = minA([t.primary, t.secondary, t.accent, green, t.warning], [0.14, 0.1, 0.07, 0.05]);
  const calloutA = minA(Object.values(calloutColours(t)), [0.1, 0.075, 0.05, 0.035]);
  const thA = tintAlpha(t.primary, t, [0.1, 0.075, 0.05]);
  return {
    bg,
    inlineA,
    markA,
    quoteA,
    tagA,
    calloutA,
    thA,
    codeBg: mix(mix(t.primary, t.text, 0.75), bg, tintAlpha(mix(t.primary, t.text, 0.75), t, [0.05, 0.035, 0.025, 0.015, 0.008])),
    inlineBg: mix(green, bg, inlineA),
    markBg: mix(t.warning, bg, markA),
    quoteBg: mix(t.secondary, bg, quoteA),
    calloutBg: (c: string) => mix(c, bg, calloutA),
    tagBg: (c: string) => mix(c, bg, tagA),
    thBg: mix(t.primary, bg, thA),
  };
}

const pct = (a: number) => `${+(a * 100).toFixed(1)}%`;

/** Every prose colour for a theme, as CSS custom properties. */
export function proseVars(t: Theme): Record<string, string> {
  const s = proseSurfaces(t);
  const bg = s.bg;
  const text = t.text;
  // Light themes darken toward a deep ink (keeps the hue's chroma; the
  // theme text is often a grey that would wash the colour out); dark
  // themes lighten toward their own text.
  const toward = t.isDark ? text : mix(text, '#000000', 0.45);
  const e = (c: string, min: number = FLOOR.text, on = bg) => ensureContrast(c, on, toward, min);
  const green = themeGreen(t);
  const v: Record<string, string> = {
    // Headings: h1 primary, h2 secondary, h3/h4 tints of them, h5/h6
    // quiet caps. Large sizes only need 3:1 but we hold 4.5 where the
    // hue survives it (it nearly always does).
    '--md-h1': e(t.primary),
    '--md-h2': e(t.secondary),
    '--md-h3': e(mix(t.accent, text, 0.62)),
    '--md-h4': e(mix(t.primary, text, 0.42)),
    '--md-h5': e(mix(t.secondary, text, 0.4)),
    '--md-strong': e(mix(t.warning, text, 0.3)),
    '--md-em': e(mix(t.secondary, text, 0.3)),
    '--md-link': e(t.accent),
    '--md-del': e(mix(text, bg, 0.62), FLOOR.ui),
    '--md-list-marker': e(t.primary, FLOOR.ui),
    '--md-code-fg': e(green, FLOOR.text, s.inlineBg),
    '--md-code-bg-hue': green,
    '--md-mark-fg': e(text, FLOOR.text, s.markBg),
    '--md-mark-bg': s.markBg,
    '--md-code-tint': s.codeBg,
    '--md-inline-a': pct(s.inlineA),
    '--md-quote-a': pct(s.quoteA),
    '--md-tag-a': pct(s.tagA),
    '--md-callout-a': pct(s.calloutA),
    '--md-th-a': pct(s.thA),
    '--md-quote-fg': e(mix(text, bg, 0.84), FLOOR.text, s.quoteBg),
    '--md-th-fg': e(t.primary, FLOOR.text, s.thBg),
    '--md-green': green,
    // Syntax (code blocks, Live Preview fences).
    '--syn-keyword': e(t.secondary, FLOOR.text, s.codeBg),
    '--syn-string': e(green, FLOOR.text, s.codeBg),
    '--syn-number': e(t.warning, FLOOR.text, s.codeBg),
    '--syn-function': e(t.primary, FLOOR.text, s.codeBg),
    '--syn-type': e(t.accent, FLOOR.text, s.codeBg),
    '--syn-property': e(mix(t.info, text, 0.7), FLOOR.text, s.codeBg),
    '--syn-tag': e(t.error, FLOOR.text, s.codeBg),
    '--syn-comment': e(mix(text, bg, 0.55), FLOOR.ui, s.codeBg),
    '--syn-punct': e(mix(text, bg, 0.75), FLOOR.ui, s.codeBg),
  };
  for (const [kind, c] of Object.entries(calloutColours(t))) {
    v[`--md-callout-${kind}`] = c;
    v[`--md-callout-${kind}-ink`] = e(c, FLOOR.text, s.calloutBg(c));
  }
  const tagBase = [t.primary, t.secondary, t.accent, green, t.warning];
  tagBase.forEach((c, i) => {
    v[`--md-tag-${i}`] = c;
    v[`--md-tag-${i}-ink`] = e(c, FLOOR.text, s.tagBg(c));
  });
  return v;
}
