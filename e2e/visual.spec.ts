// Visual snapshots of the key screens (WP 0.10). PR smoke: 2 themes at
// 1440 px. Nightly (@matrix): 12 themes x 3 widths x 2 color schemes.
// Stills run with reduced motion so every screen is in its rest state.
import type { Page } from '@playwright/test';
import { test, expect, seed, signIn, settle, openNote, SMOKE_THEMES, ALL_THEMES, WIDTHS, HEIGHTS, SCHEMES, FIXED_NOW } from './fixtures.ts';

async function shoot(page: Page, name: string): Promise<void> {
  await settle(page);
  // The "1 livro adicionado de 127.0.0.1:<port>" banner names the
  // per-worker mock's random port: mask the text, keep the layout.
  await expect(page).toHaveScreenshot(`${name}.png`, { fullPage: false, mask: [page.locator('.banner > span')] });
}

/** Login → explorer → reader → editor → board → canvas, one still each. */
async function tour(page: Page, tag: string): Promise<void> {
  await page.clock.setFixedTime(FIXED_NOW);
  await page.goto('/');
  await page.waitForSelector('#lumi-server-url');
  await shoot(page, `${tag}-login`);

  await signIn(page);
  await page.waitForTimeout(300);
  await shoot(page, `${tag}-explorer`);

  await openNote(page, 'Showcase');
  await page.locator('[data-testid=md-body]').first().waitFor();
  await page.mouse.move(1, 1);
  await shoot(page, `${tag}-reader`);

  await page.keyboard.press('e');
  await page.locator('.cm-editor').first().waitFor();
  await page.locator('.cm-content').first().waitFor();
  await shoot(page, `${tag}-editor`);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Meta+e').catch(() => undefined);

  await openNote(page, 'board');
  await page.locator('[data-testid=kanban-board]').first().waitFor();
  await shoot(page, `${tag}-board`);

  await openNote(page, 'small');
  await page.locator('[data-testid=canvas-view]').first().waitFor();
  await page.waitForTimeout(200);
  await shoot(page, `${tag}-canvas`);
}

for (const theme of SMOKE_THEMES) {
  test.describe(`visual smoke · ${theme}`, () => {
    test.use({ viewport: { width: 1440, height: HEIGHTS[1440] }, contextOptions: { reducedMotion: 'reduce' }, colorScheme: theme === 'tokyo-night' ? 'dark' : 'light' });
    test(`key screens · ${theme}`, async ({ context, page }) => {
      await seed(context, { theme });
      await tour(page, theme);
    });
  });
}

for (const theme of ALL_THEMES) {
  for (const width of WIDTHS) {
    for (const scheme of SCHEMES) {
      test.describe(`visual matrix · ${theme} · ${width} · ${scheme}`, () => {
        test.use({ viewport: { width, height: HEIGHTS[width] }, contextOptions: { reducedMotion: 'reduce' }, colorScheme: scheme });
        test(`@matrix ${theme} · ${width} · ${scheme}`, async ({ context, page }) => {
          await seed(context, { theme });
          await tour(page, `${theme}-${width}-${scheme}`);
        });
      });
    }
  }
}
