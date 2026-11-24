// Motion frame capture: for each moment, trigger it, then FREEZE every
// running animation (document.getAnimations() + lumi's JS spring clock,
// window.__lumiMotion) and seek through fixed times, one screenshot per
// time. Deterministic, independent of screenshot latency.
//
//   node scripts/perf/motion-frames.mjs <base> <outdir> <tag> [theme=dark|light] [only=a,b]
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const [BASE, OUT, TAG, ...rest] = process.argv.slice(2);
const opt = Object.fromEntries(rest.map((a) => a.split('=')));
const MODE = opt.theme ?? 'dark';
const ONLY = opt.only ? opt.only.split(',') : null;
const TIMES = (opt.times ?? '0,40,80,120,170,230,300,420').split(',').map(Number);
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME || undefined });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: MODE, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.addInitScript((m) => {
  localStorage.setItem('lumi.v2.theme', JSON.stringify({ mode: m, darkName: 'tokyo-night', lightName: 'catppuccin-latte' }));
  // Seekable clock for every animation on the page.
  window.__cap = {
    frozen: false,
    seek(t) {
      for (const a of document.getAnimations()) {
        try {
          if (a.__base === undefined) a.__base = a.currentTime ?? 0;
          a.pause();
          a.currentTime = a.__base + t;
        } catch {}
      }
      window.__lumiMotion?.seek?.(t);
    },
    freeze() {
      this.frozen = true;
      window.__lumiMotion?.freeze?.();
      for (const a of document.getAnimations()) {
        try { a.__base = a.currentTime ?? 0; a.pause(); } catch {}
      }
    },
    thaw() {
      this.frozen = false;
      window.__lumiMotion?.thaw?.();
      for (const a of document.getAnimations()) try { a.finish(); } catch {}
    },
  };
}, MODE);

const wait = (ms) => page.waitForTimeout(ms);
const raf = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
const press = (k) => page.keyboard.press(k);

await page.goto(BASE + '/');
await page.fill('#lumi-server-url', BASE);
await page.fill('#lumi-username', 'admin');
await page.fill('#lumi-password', 'pw');
await page.keyboard.press('Enter');
await page.waitForSelector('[data-testid=floating-explorer]', { timeout: 15000 });
await wait(900);
// The home with the explorer up: capture the home first (behind).
await press('Escape');
await wait(600);
const dismissToasts = async () => page.evaluate(() => document.querySelectorAll('[data-testid=toast] button').forEach((b) => b.click()));
await dismissToasts();
await wait(300);

async function capture(name, trigger, { clip, pre = 1, times = TIMES, waitFor = null } = {}) {
  if (ONLY && !ONLY.includes(name)) return;
  try {
    await trigger();
    if (waitFor) await page.evaluate((sel) => new Promise((res) => { const t0 = performance.now(); const f = () => (document.querySelector(sel) || performance.now() - t0 > 2000 ? res() : requestAnimationFrame(f)); f(); }), waitFor);
    for (let i = 0; i < pre; i++) await raf();
    await page.evaluate(() => window.__cap.freeze());
    const files = [];
    for (const t of times) {
      await page.evaluate((x) => window.__cap.seek(x), t);
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      // Seek again: rAF springs advanced in between are pinned back.
      await page.evaluate((x) => window.__cap.seek(x), t);
      const f = `${OUT}/${TAG}-${name}-${MODE}-${String(t).padStart(3, '0')}.png`;
      await page.screenshot({ path: f, clip });
      files.push([t, f]);
    }
    await page.evaluate(() => window.__cap.thaw());
    await wait(500);
    await sheet(name, files, clip);
    console.log('ok', name);
  } catch (e) {
    console.log('FAIL', name, e.message.split('\n')[0]);
    await page.evaluate(() => window.__cap.thaw()).catch(() => {});
  }
}

async function sheet(name, files, clip) {
  const w = clip?.width ?? 1440;
  const h = clip?.height ?? 900;
  const cell = Math.min(480, w);
  const scale = cell / w;
  const imgs = files.map(([t, f]) => `<figure><figcaption>${t} ms</figcaption><img src="data:image/png;base64,${fs.readFileSync(f).toString('base64')}" width="${cell}" height="${Math.round(h * scale)}"></figure>`).join('');
  const p2 = await ctx.newPage();
  await p2.setViewportSize({ width: 4 * (cell + 8) + 8, height: 300 });
  await p2.setContent(`<body style="margin:0;background:#0b0b10;color:#bbb;font:12px system-ui"><div style="padding:6px 8px;font-weight:600">${TAG} · ${name} · ${MODE}</div><div style="display:grid;grid-template-columns:repeat(4,${cell}px);gap:8px;padding:0 8px 8px">${imgs}</div><style>figure{margin:0}figcaption{padding:2px 0}img{display:block;border:1px solid #333}</style></body>`);
  await p2.screenshot({ path: `${OUT}/sheet-${TAG}-${name}-${MODE}.png`, fullPage: true });
  await p2.close();
  for (const [, f] of files) fs.unlinkSync(f);
}

const fx = () => page.locator('[data-testid=floating-explorer]');
const fxVisible = () => fx().isVisible().catch(() => false);
async function closeAll() {
  for (let i = 0; i < 3; i++) {
    if (await page.locator('[data-testid=palette]').isVisible().catch(() => false)) await press('Escape');
    if (await fxVisible()) await press('Escape');
    await wait(150);
  }
  await wait(350);
}
async function explorerOpen() {
  if (!(await fxVisible())) {
    await page.click('[data-testid=explorer-button]');
    await page.waitForSelector('[data-testid=floating-explorer]', { timeout: 5000 });
  }
  await wait(700);
}
async function selectRow(name) {
  await explorerOpen();
  const rows = page.locator('[data-testid=floating-explorer] .fx-current [role=option]');
  const n = await rows.count();
  // Walk with keys (clicks on folders would enter them).
  await press('g'); await press('g');
  for (let k = 0; k < n; k++) {
    const t = (await page.locator('[data-testid=floating-explorer] .fx-current [role=option][aria-selected=true]').innerText().catch(() => '')).trim();
    if (t.split('\n')[0].trim() === name || t.startsWith(name)) return true;
    await press('j');
    await wait(40);
  }
  throw new Error('row not found: ' + name);
}
async function toNote(name) {
  await closeAll();
  await selectRow(name);
  await press('Enter');
  await wait(1100);
  await closeAll();
}

// 0. Home (empty state).
await capture('home', async () => {
  for (let i = 0; i < 8; i++) await page.mouse.move(300 + i * 90, 300 + i * 30);
}, { times: [0, 300, 600, 1200] });

// 1. Explorer open (keyboard `-` from the home).
await closeAll();
await capture('explorer-open', async () => press('-'), { pre: 2 });
await wait(500);
// 2. Cursor travel (3 × j).
await press('g'); await press('g');
await capture('explorer-cursor', async () => { await press('j'); await press('j'); await press('j'); });
// 3. Folder travel: into journal/.
await press('g'); await press('g');
await capture('folder-travel', async () => press('l'), { pre: 2 });
await wait(500);
await press('h');
await wait(600);
// 4. Close via Esc.
await capture('explorer-close', async () => press('Escape'));
await wait(500);
// 5. Note open from the explorer.
await selectRow('Showcase');
await capture('note-open', async () => press('Enter'), { pre: 2 });
await wait(900);
await closeAll();
// 6. Split.
await page.locator('[data-testid=md-body]').first().click({ position: { x: 5, y: 5 } }).catch(() => {});
await capture('pane-split', async () => { await press('Control+w'); await press('v'); }, { pre: 2 });
await wait(900);
// 7. Pane focus.
await capture('pane-focus', async () => { await press('Control+w'); await press('w'); });
await wait(600);
// 8. Zoom + unzoom.
await capture('pane-zoom', async () => { await press('Control+w'); await press('z'); }, { pre: 2 });
await wait(700);
await capture('pane-unzoom', async () => { await press('Control+w'); await press('z'); }, { pre: 2 });
await wait(700);
await press('Control+w'); await press('o');
await wait(700);
// 9. Palette.
await capture('palette', async () => press('Meta+k'));
await wait(400);
await capture('palette-select', async () => { await press('ArrowDown'); await press('ArrowDown'); await press('ArrowDown'); });
await closeAll();
// 10. Toast (copy → toast).
await page.locator('[data-testid=md-body]').first().click({ position: { x: 5, y: 5 } }).catch(() => {});
await capture('toast', async () => press('y'), { pre: 0, waitFor: '[data-testid=toast]' });
await wait(2800);
// 11. Hover card on the external link.
await capture('hover-card', async () => {
  const a = page.locator('[data-testid=md-body] a[href^="http"]').first();
  await a.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
  await a.hover({ force: true, timeout: 5000 });
}, { pre: 0, waitFor: '[data-testid=hover-card]' });
await page.mouse.move(5, 400);
await wait(500);
// 12. Edit, then vim mode change.
await press('e');
await wait(1500);
await capture('mode-change', async () => press('i'));
await press('Escape');
await wait(300);
await page.keyboard.press('Meta+Enter').catch(() => {});
await wait(700);
// 13. Kanban.
await toNote('board');
await page.locator('[data-testid=kanban-board]').focus().catch(() => {});
await press('e');
await wait(400);
await capture('kanban-move', async () => press('L'), { pre: 1 });
await wait(500);
await press('u');
await wait(300);
// 14. Canvas open + zoom.
await closeAll();
await selectRow('small');
await capture('canvas-open', async () => press('Enter'), { pre: 2, times: [0, 60, 120, 200, 300, 420, 600, 900] });
await wait(900);
await capture('canvas-zoom', async () => { await page.locator('[data-testid=canvas-view]').last().focus(); await press('+'); });
await wait(500);
// 15. `-` from the canvas opens the explorer (SPEC-PARTE2 §5b).
await capture('canvas-dash', async () => { await page.locator('[data-testid=canvas-view]').last().focus(); await press('-'); }, { times: [0, 120, 300, 600] });

fs.writeFileSync(`${OUT}/${TAG}-errors-${MODE}.json`, JSON.stringify(errors, null, 1));
await browser.close();
