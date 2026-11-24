import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { readFileSync } from 'node:fs'
import { precacheList, swVersion, renderServiceWorker, lazyOnlyFiles } from './src/sw/sw-build.ts'

// App-shell service worker: emits /sw.js with the precache list of
// this build (see src/sw/). Build only — never in the dev server.
function lumiServiceWorker() {
  return {
    name: 'lumi-service-worker',
    apply: 'build',
    enforce: 'post',
    generateBundle(_opts, bundle) {
      // Mermaid (lib/mermaid-render.ts and everything only it reaches)
      // is cached at runtime on first use, never precached.
      const chunks = Object.values(bundle)
        .filter((c) => c.type === 'chunk')
        .map((c) => ({
          fileName: c.fileName,
          isEntry: c.isEntry,
          imports: c.imports,
          dynamicImports: c.dynamicImports,
          css: [...(c.viteMetadata?.importedCss ?? [])],
          // facadeModuleId can be null for a merged dynamic chunk.
          root: (c.moduleIds ?? Object.keys(c.modules)).some((id) => id.endsWith('/src/lib/mermaid-render.ts')),
        }))
      const lazy = lazyOnlyFiles(chunks, (c) => c.root)
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

// https://vite.dev/config/
export default defineConfig({
  plugins: [svelte(), lumiServiceWorker()],
})
