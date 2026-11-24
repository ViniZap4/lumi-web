// Space settings (owner: "não está tendo um bom aproveitamento de
// espaço"): reading width + density.
import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS, sanitizeSettings, READING_WIDTHS, READING_MEASURE, DENSITIES } from './editor-settings.ts';

describe('reading width + density settings', () => {
  it('defaults: média (84ch) and confortável', () => {
    expect(DEFAULT_SETTINGS.readingWidth).toBe('medium');
    expect(DEFAULT_SETTINGS.density).toBe('comfortable');
    expect(READING_MEASURE.medium).toBe('84ch');
  });
  it('keeps valid values', () => {
    for (const w of READING_WIDTHS) expect(sanitizeSettings({ readingWidth: w }).readingWidth).toBe(w);
    for (const d of DENSITIES) expect(sanitizeSettings({ density: d }).density).toBe(d);
  });
  it('falls back on junk', () => {
    for (const bad of ['huge', 3, null, undefined, {}, 'MEDIUM']) {
      expect(sanitizeSettings({ readingWidth: bad }).readingWidth).toBe('medium');
      expect(sanitizeSettings({ density: bad }).density).toBe('comfortable');
    }
  });
  it('app.css maps every reading width to the same --md-measure value', async () => {
    const fs = (await import(/* @vite-ignore */ 'node:' + 'fs')) as { readFileSync(p: string, enc: string): string };
    const proc = (globalThis as unknown as { process: { cwd(): string } }).process;
    const css = fs.readFileSync(`${proc.cwd()}/src/app.css`, 'utf8');
    expect(css).toContain(`--md-measure: ${READING_MEASURE.medium};`);
    for (const w of ['narrow', 'wide', 'full'] as const) {
      expect(css).toContain(`:root[data-measure='${w}'] { --md-measure: ${READING_MEASURE[w]}; }`);
    }
    expect(css).toContain(":root[data-density='compact']");
  });
});
