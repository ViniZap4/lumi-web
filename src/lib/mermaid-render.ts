// The only module that imports mermaid. Loaded on demand by
// lib/mermaid.ts the first time a note actually contains a ```mermaid
// block, so mermaid (and its per-diagram chunks) never ship in the
// main bundle.
//
// Security posture (see lib/mermaid.ts for the SVG sanitiser that runs
// on every result):
//   - securityLevel 'strict': labels are HTML-encoded, `click` / `call`
//     callbacks and links are disabled;
//   - htmlLabels off: labels are SVG <text>, never <foreignObject> HTML;
//   - every theming / security key is `secure`, so a diagram's own
//     `%%{init}%%` directive or front-matter `config:` cannot turn
//     these back on, swap the theme, or inject `themeCSS`;
//   - size caps (maxTextSize / maxEdges) bound the layout work;
//   - suppressErrorRendering: errors come back as exceptions and are
//     shown by lumi's own error card, never as mermaid's error SVG.

import mermaid, { type MermaidConfig } from 'mermaid';

export interface MermaidThemeVars {
  /** Identity of the palette (cache key part). */
  key: string;
  dark: boolean;
  fontFamily: string;
  vars: Record<string, string>;
}

export const MAX_TEXT = 50_000;

const SECURE_KEYS = [
  'secure',
  'securityLevel',
  'startOnLoad',
  'maxTextSize',
  'maxEdges',
  'suppressErrorRendering',
  'htmlLabels',
  'theme',
  'themeVariables',
  'themeCSS',
  'darkMode',
  'fontFamily',
  'altFontFamily',
  'dompurifyConfig',
  'deterministicIds',
  'deterministicIDSeed',
  'arrowMarkerAbsolute',
  'legacyMathML',
  'forceLegacyMathML',
];

export function mermaidConfig(theme: MermaidThemeVars): MermaidConfig {
  return {
    startOnLoad: false,
    securityLevel: 'strict',
    htmlLabels: false,
    suppressErrorRendering: true,
    maxTextSize: MAX_TEXT,
    maxEdges: 800,
    logLevel: 'fatal',
    theme: 'base',
    darkMode: theme.dark,
    fontFamily: theme.fontFamily,
    themeVariables: { ...theme.vars, darkMode: theme.dark, fontFamily: theme.fontFamily },
    // The gantt renderer sizes itself from the (off-screen) measuring
    // element; give it a reading-column width instead (scales down).
    gantt: { useWidth: 900 },
    secure: SECURE_KEYS,
  } as MermaidConfig;
}

let configured = '';
let seq = 0;
let chain: Promise<unknown> = Promise.resolve();

export interface RenderedSvg {
  svg: string;
  /** The id mermaid was given; every internal reference starts with it. */
  id: string;
}

/**
 * Render one diagram. Calls are serialised: mermaid keeps global
 * config + a temporary element per render, so two renders must never
 * interleave (and a theme switch must apply between them).
 */
export function renderMermaid(source: string, theme: MermaidThemeVars): Promise<RenderedSvg> {
  const run = async (): Promise<RenderedSvg> => {
    if (configured !== theme.key) {
      mermaid.initialize(mermaidConfig(theme));
      configured = theme.key;
    }
    const id = `lumimmd${++seq}q`;
    try {
      const { svg } = await mermaid.render(id, source);
      return { svg, id };
    } finally {
      // Mermaid measures in a temporary element under <body>; on a
      // parse error it can be left behind.
      document.getElementById(`d${id}`)?.remove();
      document.getElementById(`i${id}`)?.remove();
    }
  };
  const p = chain.then(run, run);
  chain = p.catch(() => undefined);
  return p;
}
