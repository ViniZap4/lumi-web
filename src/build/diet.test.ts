// Build-time bundle diets (WP0.5 / §5b): they must fail loudly when a
// dependency upgrade changes the code they rewrite.
import { describe, it, expect } from 'vitest';
import { stripHeavyLayouts, CYTOSCAPE_STUB, isInsideMermaid } from './mermaid-diet.ts';
import { rerouteMarkdownGrammar } from './lang-data-diet.ts';

const REGISTRY = `var registerDefaultLayoutLoaders = () => { registerLayoutLoaders([
  { name: "dagre", loader: async () => await import("./dagre.mjs") },
  ...true ? [ { name: "cose-bilkent", loader: async () => await import("./cose-bilkent.mjs") }, ...elkLayoutLoaders() ] : []
]); };`;

describe('mermaid diet', () => {
  it('switches the layout registry to the branch without elk and cose-bilkent', () => {
    const out = stripHeavyLayouts(REGISTRY)!;
    expect(out).toContain('...false ? [');
    expect(out).not.toContain('...true ? [');
  });
  it('leaves other modules alone and refuses a changed registry', () => {
    expect(stripHeavyLayouts('export const x = 1;')).toBeNull();
    expect(() => stripHeavyLayouts(REGISTRY.replace('...true ? [', '...flag ? ['))).toThrow(/mermaid-diet/);
  });
  it('the cytoscape stub fails with a readable pt-BR message', async () => {
    const mod = await import(/* @vite-ignore */ 'data:text/javascript,' + encodeURIComponent(CYTOSCAPE_STUB));
    expect(() => mod.default()).toThrow(/arquitetura/);
    expect(() => mod.default.use()).not.toThrow();
  });
  it('only mermaid imports get the stub', () => {
    expect(isInsideMermaid('/w/node_modules/mermaid/dist/chunks/mermaid.core/x.mjs')).toBe(true);
    expect(isInsideMermaid('/w/src/lib/x.ts')).toBe(false);
  });
});

describe('language-data diet', () => {
  const SRC = `LanguageDescription.of({ name: "Markdown", load() { return import('@codemirror/lang-markdown').then(m => m.markdown()); } })`;
  it('routes ```markdown fences to lib/markdown-lang.ts', () => {
    const out = rerouteMarkdownGrammar(SRC, '/w/src/lib/markdown-lang.ts')!;
    expect(out).toContain('import("/w/src/lib/markdown-lang.ts").then(m => m.lumiMarkdown([]))');
    expect(out).not.toContain('@codemirror/lang-markdown');
  });
  it('refuses a changed loader', () => {
    expect(rerouteMarkdownGrammar('export const x = 1', '/t')).toBeNull();
    expect(() => rerouteMarkdownGrammar(SRC.replace('m.markdown()', 'm.markdown({})'), '/t')).toThrow(/lang-data-diet/);
  });
});
