// Headless quality harness (Phase 3 WP 0.10, docs/phase3/research/09
// Q7): visual snapshots, motion and accessibility checks against the
// production build served by the mock API (scripts/perf/mock-server.mjs:
// one origin for dist/ + a minimal v2 API + a Yjs sync socket). Each
// worker starts its own mock (e2e/fixtures.ts), so specs never share
// presence or edits.
//
//   npm run build && npm run e2e            # PR smoke: 2 themes, 1440 px
//   E2E_MATRIX=full npm run e2e             # nightly: 12 themes x 3 widths x 2 schemes
//   npm run e2e:update                      # re-record this platform's baselines
//
// Baselines live per platform (e2e/__snapshots__/<platform>/…): fonts
// differ between macOS and Linux, so CI compares only against Linux
// references recorded in the CI image (mcr.microsoft.com/playwright,
// same version as @playwright/test). See `npm run e2e:linux`.
import { defineConfig, devices } from '@playwright/test';

const FULL = process.env.E2E_MATRIX === 'full';

export default defineConfig({
  testDir: 'e2e',
  outputDir: 'e2e/.results',
  snapshotPathTemplate: '{testDir}/__snapshots__/{platform}/{projectName}/{arg}{ext}',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 4,
  timeout: 60_000,
  reporter: process.env.CI ? [['list'], ['html', { outputFolder: 'e2e/.report', open: 'never' }]] : 'list',
  expect: {
    toHaveScreenshot: { maxDiffPixelRatio: 0.002, animations: 'disabled', caret: 'hide', scale: 'css' },
  },
  use: {
    ...devices['Desktop Chrome'],
    deviceScaleFactor: 1,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    trace: 'retain-on-failure',
  },
  projects: [
    // PR smoke: visual (2 themes), motion and axe. Kept under ~2 min.
    { name: 'smoke', testMatch: /(visual|motion|a11y)\.spec\.ts/, grepInvert: /@matrix/ },
    // Nightly: the full visual matrix (and axe over every theme).
    ...(FULL ? [{ name: 'matrix', testMatch: /(visual|a11y)\.spec\.ts/, grep: /@matrix/ }] : []),
  ],
});
