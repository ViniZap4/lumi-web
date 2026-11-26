// Build-time diet for mermaid (docs/phase3 §5b, accepted): the elk and
// cytoscape layouts are dropped from the bundle (about 2 MB of lazy
// chunks and runtime cache).
// - The layout registry is switched to mermaid's own "tiny build"
//   branch, which registers neither elk nor cose-bilkent; a diagram
//   that asks for them falls back to dagre (mermaid's
//   getRegisteredLayoutAlgorithm does that already).
// - cytoscape is only reached from there and from the architecture
//   diagram, which imports it directly; inside mermaid those imports
//   resolve to a stub that fails with a readable message, shown by
//   lumi's diagram error card.
// Pure helpers here; the Vite plugin wrapper lives in vite.config.js.

/** Marker of mermaid's layout registry chunk. */
const REGISTRY_MARK = 'registerDefaultLayoutLoaders';
/** The build-flag branch that adds cose-bilkent + elk. */
const FULL_BRANCH = /\.\.\.true \? \[/g;

/** Rewrite mermaid's layout registry so elk and cose-bilkent are never
 *  registered (their dynamic imports become dead code). Returns null
 *  when `code` is not the registry chunk; throws when it is but the
 *  branch is not found exactly once (a mermaid upgrade changed it). */
export function stripHeavyLayouts(code: string): string | null {
  if (!code.includes(REGISTRY_MARK) || !code.includes('cose-bilkent')) return null;
  const hits = code.match(FULL_BRANCH)?.length ?? 0;
  if (hits !== 1) throw new Error(`mermaid-diet: expected one layout build-flag branch, found ${hits}; update src/build/mermaid-diet.ts`);
  return code.replace(FULL_BRANCH, '...false ? [');
}

export const CYTOSCAPE_IDS = new Set(['cytoscape', 'cytoscape-fcose', 'cytoscape-cose-bilkent']);
export const CYTOSCAPE_STUB_ID = '\0lumi-cytoscape-stub';

/** Module source that stands in for cytoscape and its layouts. */
export const CYTOSCAPE_STUB = `const fail = () => { throw new Error('Diagramas de arquitetura não estão disponíveis nesta versão do lumi.'); };
fail.use = () => {};
export default fail;
`;

export function isInsideMermaid(importer: string | undefined): boolean {
  return !!importer && /[\\/]node_modules[\\/]mermaid[\\/]/.test(importer);
}
