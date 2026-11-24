// Space audit screenshots + measurements (headless).
//   [EDITOR_SETTINGS='{"density":"compact"}'] node scripts/perf/space-shots.mjs <base> <outdir> <prefix> [widths=1440,1920] [themes=dark,light]
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const [BASE, OUT, PREFIX, W = '1440,1920', TH = 'dark,light'] = process.argv.slice(2);
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME ?? (process.env.HOME + '/Library/Caches/ms-playwright/chromium_headless_shell-1181/chrome-mac/headless_shell') });
const report = [];
const H = { 390: 844, 1280: 800, 1440: 900, 1920: 1080, 2560: 1440 };
for (const theme of TH.split(',')) {
  for (const w of W.split(',').map(Number)) {
    const ctx = await browser.newContext({ viewport: { width: w, height: H[w] ?? 900 }, deviceScaleFactor: 1, colorScheme: theme });
    const page = await ctx.newPage();
    await page.addInitScript(([t, extraJSON]) => {
      localStorage.setItem('lumi.v2.theme', JSON.stringify({ mode: t, darkName: 'tokyo-night', lightName: 'catppuccin-latte' }));
      // Optional editor settings (EDITOR='{"density":"compact"}').
      if (extraJSON) localStorage.setItem('lumi.v2.editor', extraJSON);
    }, [theme, process.env.EDITOR_SETTINGS ?? '']);
    const wait = (ms) => page.waitForTimeout(ms);
    const shot = async (name) => page.screenshot({ path: `${OUT}/${PREFIX}-${name}-${theme}-${w}.png` });
    await page.goto(BASE + '/');
    await page.fill('#lumi-server-url', BASE);
    await page.fill('#lumi-username', 'admin');
    await page.fill('#lumi-password', 'pw');
    await page.keyboard.press('Enter');
    await page.waitForSelector('[data-testid=floating-explorer]', { timeout: 15000 });
    await wait(700);
    await shot('explorer');
    const fx = await page.evaluate(() => {
      const p = document.querySelector('[data-testid=floating-explorer] .fx-panel') ?? document.querySelector('[data-testid=floating-explorer]');
      const r = p.getBoundingClientRect();
      const row = document.querySelector('[data-testid=floating-explorer] .fx-current [role=option], [data-testid=floating-explorer] .fx-current li, [data-testid=floating-explorer] .fx-current .row');
      return { w: Math.round(r.width), h: Math.round(r.height), rowH: row ? Math.round(row.getBoundingClientRect().height) : null };
    });
    await page.keyboard.press('Escape');
    await wait(500);
    await shot('home');
    const open = async (name) => {
      if (!(await page.locator('[data-testid=floating-explorer]').isVisible().catch(() => false))) {
        await page.click('[data-testid=explorer-button]').catch(() => page.keyboard.press('-'));
        await page.waitForSelector('[data-testid=floating-explorer]', { timeout: 5000 });
        await wait(300);
      }
      const row = page.locator('[data-testid=floating-explorer] .fx-current').getByText(name, { exact: true }).first();
      await row.click();
      await page.keyboard.press('Enter');
      await wait(900);
    };
    await open('Showcase');
    await page.mouse.move(5, 5);
    await wait(500);
    await shot('reader');
    const m = await page.evaluate(() => {
      const box = (sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.x), w: Math.round(r.width), h: Math.round(r.height), y: Math.round(r.y) }; };
      const p = document.querySelector('.md-body p');
      const prose = p ? p.getBoundingClientRect() : null;
      const header = document.querySelector('header, .topbar, [data-testid=topbar]');
      return {
        textW: prose ? Math.round(prose.width) : null,
        textX: prose ? Math.round(prose.x) : null,
        header: header ? Math.round(header.getBoundingClientRect().height) : null,
        headerSel: header?.className ?? null,
        firstTextY: (() => { const h = document.querySelector('.md-body h1, .md-body p'); return h ? Math.round(h.getBoundingClientRect().y) : null; })(),
        toc: box('[data-testid=toc-rail]'),
      };
    });
    report.push({ theme, w, fx, ...m });
    await open('board');
    await wait(400);
    await shot('board');
    await open('small');
    await wait(600);
    await shot('canvas');
    await open('Showcase');
    await page.keyboard.press('Control+w');
    await page.keyboard.press('v');
    await wait(900);
    await shot('split');
    await ctx.close();
  }
}
await browser.close();
fs.writeFileSync(`${OUT}/${PREFIX}-metrics.json`, JSON.stringify(report, null, 1));
console.log(JSON.stringify(report));
