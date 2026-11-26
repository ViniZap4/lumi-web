// @codemirror/language-data loads ```markdown fences through
// lang-markdown's `markdown()` helper. Keeping that helper reachable
// keeps its static import of @codemirror/lang-html (with lang-css and
// lang-javascript) in the editor chunk, because the editor itself
// imports lang-markdown. This build step points that one description
// at lib/markdown-lang.ts instead, so `markdown()` is tree-shaken and
// HTML support stays a lazy chunk (WP0.5).

const MARKDOWN_LOAD = "import('@codemirror/lang-markdown').then(m => m.markdown())";

/** Rewrite language-data's Markdown loader to `target` (an absolute
 *  module path). Returns null when `code` is not language-data; throws
 *  when it is but the loader changed (a dependency upgrade). */
export function rerouteMarkdownGrammar(code: string, target: string): string | null {
  if (!code.includes('LanguageDescription.of(') || !code.includes('@codemirror/lang-markdown')) return null;
  const n = code.split(MARKDOWN_LOAD).length - 1;
  if (n !== 1) throw new Error(`lang-data-diet: expected one markdown loader in @codemirror/language-data, found ${n}; update src/build/lang-data-diet.ts`);
  return code.replace(MARKDOWN_LOAD, `import(${JSON.stringify(target)}).then(m => m.lumiMarkdown([]))`);
}
