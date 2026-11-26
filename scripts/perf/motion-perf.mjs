// Motion perf: frame times (p50/p95/max) while each moment animates,
// long tasks (> 50 ms) during it, and typing latency (keydown → next
// frame) in the editor's insert mode.
//
//   node scripts/perf/motion-perf.mjs <base> [--cpu 4] [--json out.json]
//
// `--cpu N` throttles the CPU N× through CDP after sign-in (the
// PERF-BUDGETS reference runs 4×).
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const args = process.argv.slice(2);
const BASE = args[0];
const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;
const cpu = args.includes('--cpu') ? Number(args[args.indexOf('--cpu') + 1]) : 1;
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME || undefined, args: process.env.GPU ? ['--use-angle=metal', '--enable-gpu-rasterization', '--ignore-gpu-blocklist'] : [] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.addInitScript(() => {
  const P = (window.__mp = { frames: [], longs: [], keys: [], on: false });
  try {
    new PerformanceObserver((l) => {
      if (P.on) for (const e of l.getEntries()) P.longs.push(e.duration);
    }).observe({ type: 'longtask', buffered: false });
  } catch {}
  let last = 0;
  const tick = (t) => {
    if (P.on && last) P.frames.push(t - last);
    last = t;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  addEventListener('keydown', (e) => {
    if (!P.typing) return;
    const t0 = e.timeStamp;
    requestAnimationFrame(() => setTimeout(() => P.keys.push(performance.now() - t0), 0));
  }, true);
});
const wait = (ms) => page.waitForTimeout(ms);
const press = (k) => page.keyboard.press(k);
await page.goto(BASE + '/');
await page.fill('#lumi-server-url', BASE);
await page.fill('#lumi-username', 'admin');
await page.fill('#lumi-password', 'pw');
await press('Enter');
await page.waitForSelector('[data-testid=floating-explorer]', { timeout: 15000 });
await wait(800);
await press('Escape');
await wait(500);
if (cpu > 1) await (await ctx.newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate: cpu });

const pct = (xs, p) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};
const results = {};
async function measure(name, fn, reps = 6) {
  await page.evaluate(() => { const P = window.__mp; P.frames = []; P.longs = []; P.on = true; });
  for (let i = 0; i < reps; i++) await fn(i);
  const r = await page.evaluate(() => { const P = window.__mp; P.on = false; return { frames: P.frames, longs: P.longs }; });
  const out = { frames: r.frames.length, p50: +pct(r.frames, 0.5).toFixed(2), p95: +pct(r.frames, 0.95).toFixed(2), max: +Math.max(0, ...r.frames).toFixed(1), longTasks: r.longs.length, maxLong: +Math.max(0, ...r.longs).toFixed(0) };
  results[name] = out;
  console.log(name.padEnd(18), JSON.stringify(out));
}
const fxOpen = async () => { await page.click('[data-testid=explorer-button]'); await wait(700); };

await measure('explorer-open', async () => { await fxOpen(); await press('Escape'); await wait(500); });
await fxOpen();
await measure('explorer-cursor', async () => { for (let k = 0; k < 6; k++) { await press('j'); await wait(60); } for (let k = 0; k < 6; k++) { await press('k'); await wait(60); } });
await measure('folder-travel', async () => {
  await press('g'); await press('g');
  await press('l'); await wait(450); await press('h'); await wait(450);
}, 4);
async function selectRow(name) {
  await press('g'); await press('g');
  for (let k = 0; k < 40; k++) {
    const t = (await page.locator('[data-testid=floating-explorer] .fx-current [role=option][aria-selected=true]').innerText().catch(() => '')).trim();
    if (t.startsWith(name)) return;
    await press('j');
  }
}
await selectRow('Showcase');
await measure('note-open', async () => { await press('Enter'); await wait(900); await fxOpen(); await selectRow('Showcase'); }, 3);
await press('Escape'); await wait(400);
await page.locator('[data-testid=md-body]').first().click({ position: { x: 5, y: 5 } }).catch(() => {});
await press('Control+w'); await press('v'); await wait(900);
await measure('pane-focus', async () => { await press('Control+w'); await press('w'); await wait(500); });
await measure('pane-zoom', async () => { await press('Control+w'); await press('z'); await wait(600); await press('Control+w'); await press('z'); await wait(600); }, 3);
await press('Control+w'); await press('o'); await wait(600);
await measure('palette', async () => { await press('Meta+k'); await wait(500); await press('ArrowDown'); await press('ArrowDown'); await wait(300); await press('Escape'); await wait(300); }, 4);
// Typing latency in the editor (insert mode).
await press('e'); await wait(1500);
await press('G'); await press('o'); await wait(200);
await page.evaluate(() => { window.__mp.keys = []; window.__mp.typing = true; window.__mp.frames = []; window.__mp.longs = []; window.__mp.on = true; });
await page.keyboard.type('the quick brown fox jumps over the lazy dog, again and again. '.repeat(3), { delay: 35 });
const typing = await page.evaluate(() => { const P = window.__mp; P.typing = false; P.on = false; return { keys: P.keys, frames: P.frames, longs: P.longs }; });
results.typing = { keys: typing.keys.length, p50: +pct(typing.keys, 0.5).toFixed(2), p95: +pct(typing.keys, 0.95).toFixed(2), max: +Math.max(...typing.keys).toFixed(1), frameP95: +pct(typing.frames, 0.95).toFixed(2), longTasks: typing.longs.length };
console.log('typing'.padEnd(18), JSON.stringify(results.typing));
await press('Escape');
await page.keyboard.press('u'); // undo is fine either way
// Kanban drag.
await page.keyboard.press('Meta+Enter').catch(() => {});
await wait(600);
await fxOpen();
await selectRow('board');
await press('Enter'); await wait(1200);
await press('e'); await wait(400);
await measure('kanban-drag', async () => {
  const card = page.locator('.kb-card').first();
  const b = await card.boundingBox();
  if (!b) return;
  await page.mouse.move(b.x + b.width / 2, b.y + 10);
  await page.mouse.down();
  for (let k = 0; k < 30; k++) await page.mouse.move(b.x + b.width / 2 + k * 9, b.y + 10 + k * 2);
  await page.mouse.up();
  await wait(700);
  await page.keyboard.press('u');
  await wait(300);
}, 3);
// Canvas pan with inertia.
await fxOpen();
await selectRow('big');
await press('Enter'); await wait(1500);
await measure('canvas-pan', async () => {
  const c = await page.locator('[data-testid=canvas-view]').last().boundingBox();
  const x = c.x + 30, y = c.y + c.height - 60;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let k = 0; k < 25; k++) await page.mouse.move(x + k * 12, y - k * 4);
  await page.mouse.up();
  await wait(900);
}, 3);
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(results, null, 1));
await browser.close();
