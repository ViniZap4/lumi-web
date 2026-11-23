import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { readFileSync } from 'node:fs'
import { precacheList, swVersion, renderServiceWorker } from './src/sw/sw-build.ts'

// App-shell service worker: emits /sw.js with the precache list of
// this build (see src/sw/). Build only — never in the dev server.
function lumiServiceWorker() {
  return {
    name: 'lumi-service-worker',
    apply: 'build',
    enforce: 'post',
    generateBundle(_opts, bundle) {
      const list = precacheList(Object.keys(bundle))
      const html = bundle['index.html']
      const htmlSrc = html && html.type === 'asset' ? String(html.source) : ''
      const template = readFileSync(new URL('./src/sw/sw-template.js', import.meta.url), 'utf8')
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: renderServiceWorker(template, list, swVersion(list, htmlSrc)),
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [svelte(), lumiServiceWorker()],
})
