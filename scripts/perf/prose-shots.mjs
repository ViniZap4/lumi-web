// Prose screenshots of the Showcase note in several themes.
//   node scripts/perf/prose-shots.mjs <base> <outdir> <tag>
import { chromium } from 'playwright-core';
const [BASE, OUT, TAG = 'shot'] = process.argv.slice(2);
const THEMES = [['tokyo-night', 'dark'], ['dracula', 'dark'], ['catppuccin-latte', 'light'], ['tokyo-day', 'light']];
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME || undefined });
for (const [name, mode] of THEMES) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 2250 }, colorScheme: mode });
  const page = await ctx.newPage();
  await page.addInitScript(([n, m]) => localStorage.setItem('lumi.v2.theme', JSON.stringify({ mode: m, darkName: m === 'dark' ? n : 'tokyo-night', lightName: m === 'light' ? n : 'tokyo-day' })), [name, mode]);
  await page.goto(BASE + '/');
  await page.fill('#lumi-server-url', BASE);
  await page.fill('#lumi-username', 'admin');
  await page.fill('#lumi-password', 'pw');
  await page.keyboard.press('Enter');
  await page.waitForSelector('[data-testid=floating-explorer]', { timeout: 15000 });
  await page.waitForTimeout(400);
  await page.locator('[data-testid=floating-explorer] .fx-current').getByText('Showcase', { exact: true }).first().click();
  await page.keyboard.press('Enter');
  await page.waitForSelector('.md-body h1', { timeout: 8000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/${TAG}-${name}.png` });
  await ctx.close();
}
await browser.close();
