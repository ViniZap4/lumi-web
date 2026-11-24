// Screenshots of the floating explorer's books level (dark + light, 1440).
//   node scripts/perf/books-shots.mjs <base> <outdir> <prefix>
import { chromium } from 'playwright-core';
const [BASE = 'http://127.0.0.1:4781', OUT = '.', PREFIX = 'after'] = process.argv.slice(2);
const exe = process.env.CHROME || '/Users/vinizap/Library/Caches/ms-playwright/chromium_headless_shell-1181/chrome-mac/headless_shell';
const browser = await chromium.launch({ headless: true, executablePath: exe });
for (const [scheme, dark, light] of [['dark', 'tokyo-night', 'tokyo-day'], ['light', 'tokyo-night', 'catppuccin-latte']]) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: scheme });
  await ctx.addInitScript(([m, d, l]) => localStorage.setItem('lumi.v2.theme', JSON.stringify({ mode: m, darkName: d, lightName: l })), [scheme, dark, light]);
  const page = await ctx.newPage();
  await page.goto(BASE + '/');
  await page.fill('#lumi-server-url', BASE);
  await page.fill('#lumi-username', 'admin');
  await page.fill('#lumi-password', 'pw');
  await page.keyboard.press('Enter');
  await page.waitForSelector('[data-testid=floating-explorer]', { timeout: 15000 });
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/${PREFIX}-files-${scheme}.png` });
  await page.keyboard.press('g');
  await page.keyboard.press('b');
  await page.waitForTimeout(140);
  await page.screenshot({ path: `${OUT}/${PREFIX}-books-midtransition-${scheme}.png` });
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/${PREFIX}-books-${scheme}.png` });
  await page.keyboard.press('h');
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/${PREFIX}-books-h-${scheme}.png` });
  await ctx.close();
}
await browser.close();
