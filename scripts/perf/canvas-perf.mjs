// Headless canvas perf / freeze check against the production bundle.
//
//   npm run build
//   npm i --no-save playwright-core     # uses an installed chromium headless shell
//   node scripts/perf/mock-server.mjs 4777 &
//   node scripts/perf/canvas-perf.mjs [http://127.0.0.1:4777] [--json out.json] [--shots dir]
//
// For every scenario it reports: max long task, max frame gap (rAF),
// DOM mutation records (a proxy for component updates; a runaway effect
// loop shows up as mutations / CPU while idle), API requests (request
// storms), JS heap delta, and console errors (effect_update_depth_exceeded).
// Exit code 1 when a scenario blocks the main thread > 500 ms, an idle
// window is not idle, or Svelte reports an effect loop.

import { chromium } from 'playwright-core';
import fs from 'node:fs';

const args = process.argv.slice(2);
const BASE = args.find((a) => a.startsWith('http')) ?? 'http://127.0.0.1:4777';
const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;
const shots = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : null;

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error' || /effect_update_depth|infinite/i.test(m.text())) errors.push(m.text().slice(0, 300));
});
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message.slice(0, 300)));

await page.addInitScript(() => {
  const P = (window.__perf = { longs: [], mutations: 0, maxGap: 0, frames: 0, last: 0 });
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) P.longs.push(e.duration);
    }).observe({ type: 'longtask', buffered: true });
  } catch {}
  const tick = (t) => {
    if (P.last) P.maxGap = Math.max(P.maxGap, t - P.last);
    P.last = t;
    P.frames++;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  addEventListener('DOMContentLoaded', () => {
    new MutationObserver((rs) => (P.mutations += rs.length)).observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
  });
  P.reset = () => {
    P.longs = [];
    P.mutations = 0;
    P.maxGap = 0;
    P.frames = 0;
    P.last = 0;
  };
});

const cdp = await ctx.newCDPSession(page);
await cdp.send('Performance.enable');
const metric = async (name) => (await cdp.send('Performance.getMetrics')).metrics.find((m) => m.name === name)?.value ?? 0;
const ctl = (p) => fetch(BASE + p).then((r) => r.json());

const results = [];
async function measure(label, fn, { idle = false } = {}) {
  await ctl('/__ctl/reset');
  await page.evaluate(() => window.__perf.reset());
  const heap0 = (await cdp.send('Runtime.getHeapUsage')).usedSize;
  const script0 = await metric('ScriptDuration');
  const t0 = Date.now();
  const errs0 = errors.length;
  let failed = null;
  try {
    await Promise.race([fn(), new Promise((_, rej) => setTimeout(() => rej(new Error('scenario timeout (frozen?)')), 30000))]);
  } catch (e) {
    failed = e.message;
  }
  const wall = Date.now() - t0;
  const p = await Promise.race([
    page.evaluate(() => ({ longs: window.__perf.longs, mutations: window.__perf.mutations, maxGap: window.__perf.maxGap, frames: window.__perf.frames })),
    new Promise((r) => setTimeout(() => r(null), 10000)),
  ]);
  if (!p) failed = (failed ? failed + '; ' : '') + 'page unresponsive (evaluate > 10 s)';
  const heap1 = p ? (await cdp.send('Runtime.getHeapUsage')).usedSize : heap0;
  const script = p ? (await metric('ScriptDuration')) - script0 : NaN;
  const reqs = await ctl('/__ctl/stats');
  const r = {
    label,
    wallMs: wall,
    maxLongTaskMs: p ? Math.round(Math.max(0, ...p.longs)) : null,
    longTasks: p?.longs.length ?? null,
    maxFrameGapMs: p ? Math.round(p.maxGap) : null,
    frames: p?.frames ?? null,
    scriptMs: Math.round(script * 1000),
    mutations: p?.mutations ?? null,
    requests: Object.values(reqs).reduce((a, b) => a + b, 0),
    reqDetail: reqs,
    heapDeltaMB: +((heap1 - heap0) / 1048576).toFixed(1),
    errors: errors.slice(errs0),
    failed,
    idle,
  };
  results.push(r);
  console.log(
    `${label.padEnd(44)} long=${String(r.maxLongTaskMs).padStart(5)}ms gap=${String(r.maxFrameGapMs).padStart(5)}ms script=${String(r.scriptMs).padStart(5)}ms mut=${String(r.mutations).padStart(6)} req=${String(r.requests).padStart(4)} heap=${String(r.heapDeltaMB).padStart(6)}MB${r.errors.length ? ' ERR=' + r.errors.length : ''}${failed ? ' FAILED: ' + failed : ''}`,
  );
  if (shots) await page.screenshot({ path: `${shots}/${label.replace(/[^a-z0-9]+/gi, '_')}.png` }).catch(() => {});
  return r;
}

const wait = (ms) => page.waitForTimeout(ms);
const canvas = () => page.locator('[data-testid=canvas-view]').last();

async function explorer() {
  if (!(await page.locator('[data-testid=floating-explorer]').isVisible().catch(() => false))) {
    await page.click('[data-testid=explorer-button]');
    await page.waitForSelector('[data-testid=floating-explorer]', { timeout: 5000 });
  }
}
async function openFromExplorer(name, how = 'Enter') {
  await explorer();
  const row = page.locator('[data-testid=floating-explorer] .fx-current').getByText(name, { exact: true }).first();
  await row.click();
  if (how === 'Enter') await page.keyboard.press('Enter');
  else await page.keyboard.press(how);
  await wait(300);
}
async function waitCanvas() {
  await page.waitForSelector('[data-testid=canvas-view]', { timeout: 10000 });
  await wait(800);
}
async function centre() {
  const b = await canvas().boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, b };
}
async function wheelPan(n = 60) {
  const c = await centre();
  await page.mouse.move(c.x, c.y);
  for (let i = 0; i < n; i++) {
    await page.mouse.wheel(i % 2 ? 7 : -5, 12);
    await wait(8);
  }
}
async function wheelZoom(n = 30) {
  const c = await centre();
  await page.mouse.move(c.x, c.y);
  await page.keyboard.down('Control');
  for (let i = 0; i < n; i++) {
    await page.mouse.wheel(0, i < n / 2 ? -40 : 40);
    await wait(8);
  }
  await page.keyboard.up('Control');
}
async function dragPan(n = 60) {
  const c = await centre();
  // Empty spot: the top-left corner under the toolbar.
  const x = c.b.x + 20;
  const y = c.b.y + c.b.height - 80;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 0; i < n; i++) await page.mouse.move(x + i * 4, y - i * 2);
  await page.mouse.up();
}
async function keyPan() {
  await canvas().focus();
  for (const k of ['l', 'l', 'j', 'j', 'h', 'k', '+', '-', '0']) {
    await page.keyboard.press(k);
    await wait(40);
  }
}
async function dragNode(n = 60) {
  const node = canvas().locator('.cv-node.cv-text, .cv-node.cv-link').first();
  const b = await node.boundingBox();
  if (!b) throw new Error('no node visible');
  const x = b.x + b.width / 2;
  const y = b.y + 8;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 0; i < n; i++) await page.mouse.move(x + i * 3, y + i * 2);
  await page.mouse.up();
}
async function connectEdge() {
  const nodes = canvas().locator('.cv-node.cv-text, .cv-node.cv-link, .cv-node.cv-file');
  const a = await nodes.nth(0).boundingBox();
  await page.mouse.click(a.x + a.width / 2, a.y + 6);
  const h = canvas().locator('[data-handle=right]').first();
  const hb = await h.boundingBox();
  if (!hb) throw new Error('no handle');
  const t = await nodes.nth(1).boundingBox();
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 30; i++) await page.mouse.move(hb.x + ((t.x + t.width / 2 - hb.x) * i) / 30, hb.y + ((t.y + t.height / 2 - hb.y) * i) / 30);
  await page.mouse.up();
}
async function typeText() {
  const c = await centre();
  await canvas().focus();
  await page.keyboard.press('Escape');
  await page.keyboard.press('a');
  await wait(200);
  await page.keyboard.type('typing into a fresh card, quickly, many chars '.repeat(2), { delay: 5 });
  await wait(600);
  await page.keyboard.press('Escape');
  void c;
}

// ---- run ------------------------------------------------------------------------------------
await page.goto(BASE + '/');
await page.fill('#lumi-server-url', BASE);
await page.fill('#lumi-username', 'admin');
await page.fill('#lumi-password', 'pw');
await page.keyboard.press('Enter');
await page.waitForSelector('[data-testid=floating-explorer]', { timeout: 15000 });
await wait(500);

// Owner report: "trava ao abrir, depois de dar reload ele volta" —
// freezes when opened in-app, fine after reload. In-app sequences first.
async function canvasReady(label) {
  // The canvas must become live (editable) — not stay on a read-only preview.
  await page.waitForFunction(() => {
    const v = [...document.querySelectorAll('[data-testid=canvas-view]')].pop();
    return v && !/loading|connecting/.test(v.querySelector('[data-testid=canvas-status]')?.textContent ?? '') && !v.querySelector('.cv-tools button[disabled]');
  }, null, { timeout: 8000 }).catch(() => { throw new Error(label + ': canvas never became live/editable'); });
}
// The canvas must own the keyboard right after an in-app open (the
// owner's freeze: focus went to the reader wrapper, keys did nothing).
async function keysWork(label) {
  await wait(700); // past the view transition + post-transition focus
  const t = () => page.evaluate(() => [...document.querySelectorAll('[data-testid=canvas-view] .cv-world')].pop()?.style.transform);
  const before = await t();
  await page.keyboard.press('l');
  await wait(250);
  if ((await t()) === before) throw new Error(label + ': canvas ignores the keyboard after opening (focus: ' + (await page.evaluate(() => document.activeElement?.className)) + ')');
}
await measure('seq: markdown → canvas', async () => {
  await openFromExplorer('README');
  await wait(600);
  await openFromExplorer('small');
  await waitCanvas();
  await canvasReady('md→canvas');
  await keysWork('md→canvas');
});
await measure('seq: canvas → markdown → canvas', async () => {
  await openFromExplorer('README');
  await wait(600);
  await openFromExplorer('small');
  await waitCanvas();
  await canvasReady('canvas→md→canvas');
  await keysWork('canvas→md→canvas');
});
await measure('seq: canvas → canvas (big)', async () => {
  await openFromExplorer('big');
  await waitCanvas();
  await canvasReady('canvas→big');
  await keysWork('canvas→big');
});
await measure('seq: idle after in-app opens', () => wait(2000), { idle: true });
await measure('seq: create fresh.canvas and open', async () => {
  await explorer();
  await page.keyboard.press('Escape');
  await explorer();
  await page.keyboard.press('a');
  await page.waitForSelector('[data-testid=prompt] input');
  await page.fill('[data-testid=prompt] input', 'fresh.canvas');
  await page.keyboard.press('Enter');
  await waitCanvas();
  await canvasReady('create canvas');
  await keysWork('create canvas');
  await canvas().focus();
  await page.keyboard.press('a');
  await page.keyboard.type('first card', { delay: 5 });
  await page.keyboard.press('Escape');
  await wait(300);
});

const noteId = { small: 'small', big: 'big', empty: 'empty', obsidian: 'obsidian', invalid: 'invalid' };
for (const name of ['small', 'empty', 'obsidian', 'invalid', 'big']) {
  await measure(`${name}: open from explorer`, async () => {
    await openFromExplorer(name);
    await waitCanvas();
  });
  await measure(`${name}: idle 2s`, () => wait(2000), { idle: true });
  if (name === 'invalid' || name === 'empty') continue;
  await measure(`${name}: wheel pan`, () => wheelPan());
  await measure(`${name}: ctrl+wheel zoom`, () => wheelZoom());
  await measure(`${name}: drag pan`, () => dragPan());
  await measure(`${name}: keyboard pan/zoom/fit`, () => keyPan());
  await measure(`${name}: drag node`, () => dragNode());
  await measure(`${name}: connect edge`, () => connectEdge());
  await measure(`${name}: type in text node`, () => typeText());
  await measure(`${name}: remote edits while panning`, async () => {
    await ctl(`/__ctl/remote?note=${noteId[name]}&n=60&ms=30`);
    await wheelPan(80);
    await wait(500);
  });
  await measure(`${name}: idle after`, () => wait(2000), { idle: true });
}

// Split beside a markdown note, and beside the canvas Source view.
await measure('split: README | big', async () => {
  await openFromExplorer('README');
  await page.waitForTimeout(500);
  await openFromExplorer('big', 'Control+v');
  await waitCanvas();
});
await measure('split: idle 2s', () => wait(2000), { idle: true });
await measure('split: wheel pan', () => wheelPan());
await measure('split: switch panes x6', async () => {
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Control+w');
    await page.keyboard.press(i % 2 ? 'l' : 'h');
    await wait(150);
  }
});
await measure('split: big | big Source (same Y.Doc)', async () => {
  await canvas().click({ position: { x: 30, y: 300 } });
  await page.keyboard.press('Escape');
  await canvas().focus();
  await page.keyboard.press('e');
  await wait(1200);
});
await measure('source split: idle 2s', () => wait(2000), { idle: true });
await measure('source split: remote edits', async () => {
  await ctl('/__ctl/remote?note=big&n=40&ms=30');
  await wait(1800);
});
await measure('close/reopen x3', async () => {
  for (let i = 0; i < 3; i++) {
    await openFromExplorer('small');
    await waitCanvas();
    await openFromExplorer('big');
    await waitCanvas();
  }
});
await measure('final idle 3s', () => wait(3000), { idle: true });

await browser.close();
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(results, null, 2));

const bad = results.filter(
  (r) =>
    r.failed ||
    (r.maxLongTaskMs ?? 0) > 500 ||
    r.errors.some((e) => /effect_update_depth|infinite loop/i.test(e)) ||
    (r.idle && (r.mutations > 200 || r.requests > 10)),
);
console.log(bad.length ? `\nFAIL: ${bad.map((r) => r.label).join(', ')}` : '\nOK: no freeze detected');
process.exit(bad.length ? 1 : 0);
