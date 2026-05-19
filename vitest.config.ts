/// <reference types="vitest" />
import { defineConfig } from 'vitest/config'

// Vitest runs in its own config file (not via vite.config.js) because
// @sveltejs/vite-plugin-svelte's configureServer hook crashes when
// vitest spins up its dev server. Pure-TS test files don't need the
// svelte transform; component tests will get their own config layer
// when we add testing-library/svelte.
//
// Per-file `// @vitest-environment jsdom` overrides switch suites that
// need a DOM (e.g. markdown sanitisation) without paying the jsdom
// setup cost for pure-Node suites like crypto.
//
// https://vitest.dev/config/
export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['src/**/*.{test,spec}.ts'],
    css: false,
    clearMocks: true,
  },
})
