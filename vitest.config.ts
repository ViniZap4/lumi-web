/// <reference types="vitest" />
import { defineConfig } from 'vitest/config'
import { svelte } from '@sveltejs/vite-plugin-svelte'

// Vitest needs its own config (not vite.config.js): when both share
// a config, @sveltejs/vite-plugin-svelte's HMR hook tries to set
// itself up against vitest's pseudo-dev-server and crashes
// (`Object.values(...)` on undefined inside configureServer in
// hot-update.js). Disabling HMR via `hot: false` keeps the transform
// pipeline — which we DO need so .svelte.ts files compile their
// $state runes — without the doomed server hook.
//
// Per-file `// @vitest-environment jsdom` overrides switch suites that
// need a DOM (markdown.test.ts, theme.test.ts) without paying the
// jsdom setup cost for pure-Node suites (crypto.test.ts).
//
// https://vitest.dev/config/
export default defineConfig({
  plugins: [svelte({ hot: false })],
  // Resolve Svelte's client runtime (not the SSR build) so component
  // tests can mount() into jsdom.
  resolve: { conditions: ['browser'] },
  test: {
    environment: 'node',
    globals: false,
    include: ['src/**/*.{test,spec}.ts'],
    css: false,
    clearMocks: true,
    setupFiles: ['src/test/setup.ts'],
    // Microbenchmarks (docs/PERF-BUDGETS.md): `npm run bench`, gated by
    // scripts/perf/bench-gate.mjs against src/bench/baseline.json. Any
    // WP may add `src/**/*.bench.ts`; the gate picks new ones up.
    benchmark: {
      include: ['src/**/*.bench.ts'],
    },
  },
})
