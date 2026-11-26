// Nightly end-to-end perf run (docs/PERF-BUDGETS.md, "warn" tier).
//
// Starts mock-server.mjs over a production build, runs the headless
// Playwright scripts in this folder, compares the results with the
// e2e budgets below and prints GitHub/Gitea `::warning::` lines for
// every breach. Budget breaches never fail the run (the e2e tier warns
// until two weeks of stable baselines, PERF-BUDGETS §Gates); a script
// that crashes does (exit 1), so a broken harness is visible.
//
//   npm run build
//   npm i --no-save playwright-core@1.54.2 && npx playwright-core install chromium-headless-shell
//   node scripts/perf/nightly.mjs [--out perf-nightly] [--port 4777]

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const OUT = path.resolve(opt('--out', 'perf-nightly'));
const PORT = Number(opt('--port', '4777'));
const BASE = `http://127.0.0.1:${PORT}`;

// e2e budgets (warn only). Frame budgets come from DESIGN-LANGUAGE §7.7
// and PERF-BUDGETS; typing is keydown -> next frame in insert mode.
const BUDGET = {
  frameP95Ms: 17.5, // 1× CPU, every motion moment
  frameP95Ms4x: 33.4, // 4× CPU: two 60 Hz frames
  typingP95Ms: 16.7,
  typingP95Ms4x: 33.4,
  longTaskMs: 50,
  idleMutations: 200,
};

fs.mkdirSync(OUT, { recursive: true });
const warnings = [];
const crashes = [];

const server = spawn(process.execPath, [path.join(here, 'mock-server.mjs'), String(PORT)], { stdio: ['ignore', 'pipe', 'inherit'] });
server.stdout.on('data', () => {});
async function waitUp() {
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(BASE + '/');
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('mock-server did not start');
}

function run(name, script, extra = []) {
  const json = path.join(OUT, `${name}.json`);
  console.log(`\n== ${name}`);
  const r = spawnSync(process.execPath, [path.join(here, script), BASE, '--json', json, ...extra], { stdio: 'inherit', timeout: 10 * 60_000 });
  // canvas-perf exits 1 on a freeze; that is a finding, not a crash.
  if (!fs.existsSync(json)) {
    crashes.push(`${name} produced no result (exit ${r.status})`);
    return null;
  }
  if (r.status !== 0) warnings.push(`${name} exited ${r.status} (see its log)`);
  return JSON.parse(fs.readFileSync(json, 'utf8'));
}

try {
  await waitUp();
  for (const [cpu, frameBudget, typingBudget] of [[1, BUDGET.frameP95Ms, BUDGET.typingP95Ms], [4, BUDGET.frameP95Ms4x, BUDGET.typingP95Ms4x]]) {
    const m = run(`motion-${cpu}x`, 'motion-perf.mjs', ['--cpu', String(cpu)]);
    if (!m) continue;
    for (const [moment, r] of Object.entries(m)) {
      if (moment === 'typing') {
        if (r.p95 > typingBudget) warnings.push(`typing p95 ${r.p95} ms at ${cpu}× CPU (budget ${typingBudget} ms)`);
        continue;
      }
      if (r.p95 > frameBudget) warnings.push(`${moment}: frame p95 ${r.p95} ms at ${cpu}× CPU (budget ${frameBudget} ms)`);
      if (cpu === 1 && r.maxLong > BUDGET.longTaskMs) warnings.push(`${moment}: long task ${r.maxLong} ms (budget 0 tasks > ${BUDGET.longTaskMs} ms)`);
    }
  }
  const c = run('canvas', 'canvas-perf.mjs');
  for (const r of c ?? []) {
    if ((r.maxLongTaskMs ?? 0) > BUDGET.longTaskMs) warnings.push(`canvas "${r.label}": long task ${Math.round(r.maxLongTaskMs)} ms`);
    if (r.idle && r.mutations > BUDGET.idleMutations) warnings.push(`canvas "${r.label}": ${r.mutations} DOM mutations while idle`);
  }
  const p = run('canvas-pan-4x', 'canvas-pan-perf.mjs', ['--cpu', '4']);
  for (const [k, r] of Object.entries(p ?? {})) {
    if (r && typeof r === 'object' && r.p95 > BUDGET.frameP95Ms4x) warnings.push(`canvas ${k}: frame p95 ${r.p95} ms at 4× CPU`);
  }
} catch (e) {
  crashes.push(String(e?.message ?? e));
} finally {
  server.kill();
}

const summary = { date: new Date().toISOString(), budgets: BUDGET, warnings, crashes };
fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
const md = [`## lumi web — nightly perf`, '', warnings.length ? warnings.map((w) => `- warn: ${w}`).join('\n') : '- every e2e budget met', ...crashes.map((c) => `- crash: ${c}`)].join('\n');
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n');
console.log('\n' + md);
for (const w of warnings) console.log(`::warning::perf-nightly: ${w}`);
for (const c of crashes) console.log(`::error::perf-nightly: ${c}`);
process.exit(crashes.length ? 1 : 0);
