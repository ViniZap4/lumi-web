// Find-in-preview highlights through the CSS Custom Highlight API
// (`::highlight(lumi-find)` / `::highlight(lumi-find-current)` in
// app.css). No DOM is touched; browsers without the API show no paint.

type HighlightGlobals = { CSS?: { highlights?: Map<string, unknown> }; Highlight?: new (...r: Range[]) => unknown };

export function clearFindHighlights(): void {
  try {
    const hl = (globalThis as HighlightGlobals).CSS?.highlights;
    hl?.delete('lumi-find');
    hl?.delete('lumi-find-current');
  } catch { /* unsupported */ }
}

/** Paint every match, and match `current` (-1 = none) as the current one. */
export function paintFindHighlights(ranges: Range[], current: number): void {
  clearFindHighlights();
  const g = globalThis as HighlightGlobals;
  try {
    if (g.CSS?.highlights && g.Highlight && ranges.length) {
      g.CSS.highlights.set('lumi-find', new g.Highlight(...ranges));
      if (current >= 0) g.CSS.highlights.set('lumi-find-current', new g.Highlight(ranges[current]));
    }
  } catch { /* unsupported */ }
}
