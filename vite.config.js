import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { readFileSync } from 'node:fs'
import { precacheList, swVersion, renderServiceWorker, lazyOnlyFiles, isLazyGrammarModule } from './src/sw/sw-build.ts'
import { stripHeavyLayouts, CYTOSCAPE_IDS, CYTOSCAPE_STUB_ID, CYTOSCAPE_STUB, isInsideMermaid } from './src/build/mermaid-diet.ts'
import { rerouteMarkdownGrammar } from './src/build/lang-data-diet.ts'
import { fileURLToPath } from 'node:url'

// App-shell service worker: emits /sw.js with the precache list of
// this build (see src/sw/). Build only — never in the dev server.
function lumiServiceWorker() {
  return {
    name: 'lumi-service-worker',
    apply: 'build',
    enforce: 'post',
    generateBundle(_opts, bundle) {
      // Mermaid (lib/mermaid-render.ts and everything only it reaches)
      // and the code-block grammars are cached at runtime on first use,
      // never precached.
      const chunks = Object.values(bundle)
        .filter((c) => c.type === 'chunk')
        .map((c) => {
          // facadeModuleId can be null for a merged dynamic chunk.
          const ids = c.moduleIds ?? Object.keys(c.modules)
          return {
            fileName: c.fileName,
            isEntry: c.isEntry,
            imports: c.imports,
            dynamicImports: c.dynamicImports,
            css: [...(c.viteMetadata?.importedCss ?? [])],
            root: !c.isEntry && (ids.some((id) => id.endsWith('/src/lib/mermaid-render.ts'))
              || (ids.length > 0 && ids.every(isLazyGrammarModule))),
          }
        })
      const lazy = lazyOnlyFiles(chunks, (c) => c.root)
      // A lazy chunk that precached code imports statically would break
      // offline; refuse to build instead.
      for (const c of chunks) {
        if (lazy.has(c.fileName)) continue
        const bad = c.imports.find((i) => lazy.has(i))
        if (bad) this.error(`lazy chunk ${bad} is statically imported by precached ${c.fileName}`)
      }
      const list = precacheList(Object.keys(bundle), lazy)
      const runtime = [...lazy].map((f) => '/' + f).sort()
      const html = bundle['index.html']
      const htmlSrc = html && html.type === 'asset' ? String(html.source) : ''
      const template = readFileSync(new URL('./src/sw/sw-template.js', import.meta.url), 'utf8')
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: renderServiceWorker(template, list, swVersion([...list, ...runtime], htmlSrc), runtime),
      })
    },
  }
}

// Mermaid without the elk and cytoscape layouts (src/build/mermaid-diet.ts).
function lumiMermaidDiet() {
  return {
    name: 'lumi-mermaid-diet',
    apply: 'build',
    enforce: 'pre',
    resolveId(id, importer) {
      if (CYTOSCAPE_IDS.has(id) && isInsideMermaid(importer)) return CYTOSCAPE_STUB_ID
      return null
    },
    load(id) {
      return id === CYTOSCAPE_STUB_ID ? CYTOSCAPE_STUB : null
    },
    transform(code, id) {
      if (!/[\\/]node_modules[\\/]mermaid[\\/]dist[\\/]/.test(id)) return null
      const out = stripHeavyLayouts(code)
      return out === null ? null : { code: out, map: null }
    },
  }
}

// ```markdown fences load lib/markdown-lang.ts, not lang-markdown's
// markdown() (src/build/lang-data-diet.ts): keeps lang-html lazy.
function lumiLangDataDiet() {
  const target = fileURLToPath(new URL('./src/lib/markdown-lang.ts', import.meta.url))
  return {
    name: 'lumi-lang-data-diet',
    enforce: 'pre',
    transform(code, id) {
      if (!/[\\/]node_modules[\\/]@codemirror[\\/]language-data[\\/]dist[\\/]/.test(id)) return null
      const out = rerouteMarkdownGrammar(code, target)
      return out === null ? null : { code: out, map: null }
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [lumiMermaidDiet(), lumiLangDataDiet(), svelte(), lumiServiceWorker()],
})
