// Contact sheet: node scripts/perf/sheet.mjs out.png <cols> <width-per-cell> label=img.png ...
// Optional crop: label=img.png@x,y,w,h
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const [out, cols, cellW, ...items] = process.argv.slice(2);
const cells = items.map((it) => {
  const [label, rest] = it.split('=');
  const [file, crop] = rest.split('@');
  const b64 = fs.readFileSync(file).toString('base64');
  let style = `width:100%`;
  let wrap = '';
  if (crop) {
    const [x, y, w, h] = crop.split(',').map(Number);
    const k = Number(cellW) / w;
    wrap = `width:${cellW}px;height:${h * k}px;overflow:hidden;position:relative`;
    style = `position:absolute;left:${-x * k}px;top:${-y * k}px;width:auto;transform-origin:0 0;transform:scale(${k})`;
  }
  return `<figure><figcaption>${label}</figcaption><div style="${wrap}"><img style="${style}" src="data:image/png;base64,${b64}"></div></figure>`;
});
const html = `<html><body style="margin:0;background:#111;color:#ddd;font:13px system-ui"><div style="display:grid;grid-template-columns:repeat(${cols},${cellW}px);gap:10px;padding:10px">${cells.join('')}</div><style>figure{margin:0}figcaption{padding:4px 0}</style></body></html>`;
const b = await chromium.launch({ headless: true, executablePath: process.env.CHROME || undefined });
const p = await b.newPage({ viewport: { width: Number(cols) * (Number(cellW) + 10) + 10, height: 400 } });
await p.setContent(html);
await p.waitForTimeout(200);
await p.screenshot({ path: out, fullPage: true });
await b.close();
