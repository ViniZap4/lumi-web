// Big-canvas pan frame budget (300 nodes, 400 edges; mock-server "big").
//
//   npm run build
//   npm i --no-save playwright-core
//   node scripts/perf/mock-server.mjs 4777 &
//   node scripts/perf/canvas-pan-perf.mjs [http://127.0.0.1:4777] [--cpu 4] [--json out.json]
//
// Scenarios: drag pan at the opening "fit" zoom (every node on screen),
// drag pan at 100 % (new areas scroll in), and wheel pan at 100 %. For
// each: rAF frame times (p50 / p95 / max), frames over 16.7 ms, and the
// main-thread split (script / style / layout) from CDP metrics. `--cpu N`
// throttles the CPU N× (a mid-range laptop is ≈ 4× slower than the M-series
// headless shell).

import { chromium } from 'playwright-core';
import fs from 'node:fs';

const args = process.argv.slice(2);
const BASE = args.find((a) => a.startsWith('http')) ?? 'http://127.0.0.1:4777';
const cpu = args.includes('--cpu') ? Number(args[args.indexOf('--cpu') + 1]) : 1;
const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.addInitScript(() => {
  const P = (window.__pp = { frames: [], on: false });
  let last = 0;
  const tick = (t) => {
    if (P.on && last) P.frames.push(t - last);
    last = t;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
const cdp = await ctx.newCDPSession(page);
await cdp.send('Performance.enable');
const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
const wait = (ms) => page.waitForTimeout(ms);

await page.goto(BASE + '/');
await page.fill('#lumi-server-url', BASE);
await page.fill('#lumi-username', 'admin');
await page.fill('#lumi-password', 'pw');
await page.keyboard.press('Enter');
await page.waitForSelector('[data-testid=floating-explorer]', { timeout: 15000 });
await wait(600);
// Open big.canvas through the explorer filter.
await page.keyboard.press('/');
await page.keyboard.type('big');
await page.keyboard.press('Enter');
await wait(150);
await page.keyboard.press('Enter');
await page.waitForSelector('[data-testid=canvas-view] .cv-node', { timeout: 15000 });
await wait(2000);
const nodes = await page.locator('[data-testid=canvas-view] .cv-node').count();
if (cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });

const pct = (xs, p) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};
const results = { nodes, cpu };
async function measure(name, fn) {
  const m0 = await metrics();
  await page.evaluate(() => { window.__pp.frames = []; window.__pp.on = true; });
  await fn();
  const frames = await page.evaluate(() => { window.__pp.on = false; return window.__pp.frames; });
  const m1 = await metrics();
  const d = (k) => +((m1[k] - m0[k]) * 1000).toFixed(0);
  const out = {
    frames: frames.length,
    p50: +pct(frames, 0.5).toFixed(1),
    p95: +pct(frames, 0.95).toFixed(1),
    max: +Math.max(0, ...frames).toFixed(1),
    over16: frames.filter((f) => f > 16.7 * 1.05).length,
    scriptMs: d('ScriptDuration'),
    styleMs: d('RecalcStyleDuration'),
    layoutMs: d('LayoutDuration'),
    styleCount: m1.RecalcStyleCount - m0.RecalcStyleCount,
    layoutCount: m1.LayoutCount - m0.LayoutCount,
  };
  results[name] = out;
  console.log(name.padEnd(22), JSON.stringify(out));
}

const box = await page.locator('[data-testid=canvas-view]').last().boundingBox();
const cx = box.x + box.width / 2;
const cy = box.y + box.height / 2;
async function drag(n = 90, dx = 9, dy = 3) {
  // Middle-button drag pans from anywhere (over nodes too).
  const x = cx;
  const y = cy;
  await page.mouse.move(x, y);
  await page.mouse.down({ button: 'middle' });
  for (let k = 0; k < n; k++) {
    await page.mouse.move(x + ((k % 30) - 15) * dx * 2, y - ((k % 20) - 10) * dy * 2);
  }
  await page.mouse.up({ button: 'middle' });
  await wait(700);
}
async function wheelPan(n = 90) {
  await page.mouse.move(cx, cy);
  for (let k = 0; k < n; k++) {
    await page.mouse.wheel(k % 40 < 20 ? 24 : -24, k % 30 < 15 ? 14 : -14);
    await wait(8);
  }
  await wait(300);
}

await measure('drag pan @ fit', () => drag());
// 100 %: zoom to 1 around the centre (keyboard "1" = 100 % if bound; else wheel-zoom in).
const canvas = page.locator('[data-testid=canvas-view]').last();
await canvas.focus();
for (let k = 0; k < 12 && (await page.locator('.cv-zoom').last().innerText()).trim() !== '100%'; k++) {
  const z = parseInt(await page.locator('.cv-zoom').last().innerText(), 10);
  await page.mouse.move(cx, cy);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, z < 100 ? -60 : 60);
  await page.keyboard.up('Control');
  await wait(60);
}
await wait(800);
results.zoom = (await page.locator('.cv-zoom').last().innerText()).trim();
await measure('drag pan @ ' + results.zoom, () => drag());
await measure('wheel pan @ ' + results.zoom, () => wheelPan());

if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(results, null, 1));
await browser.close();
