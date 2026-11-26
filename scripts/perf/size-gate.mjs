// Bundle-size gate (docs/PERF-BUDGETS.md in the umbrella repo).
//
// Reads the Vite manifest of a production build and measures, in gzip
// bytes (zlib level 9):
//   - shell.js   JS that must load before the first book paints: the
//                entry chunk, the App chunk it imports dynamically, and
//                everything both reach through static imports;
//   - entry.css  CSS the entry chunk links (blocks first paint);
//   - shell.css  entry CSS plus the App chunk's CSS;
//   - editor.js  the increment NoteEditor adds on top of the shell;
//   - per chunk  every chunk, labelled by source path or chunk name
//                (hash-free, so labels survive rebuilds).
//
// It fails (exit 1) when
//   - a metric or chunk grew more than 10 % over the committed baseline
//     (scripts/perf/size-baseline.json) and by at least 1 KiB gz, or
//   - an absolute budget marked `enforce: true` is exceeded.
// Budgets with `enforce: false` only warn (they flip to true when the
// work package that meets them lands; the wave-0 exit needs all of
// them on).
//
//   npm run build -- --manifest && node scripts/perf/size-gate.mjs
//   node scripts/perf/size-gate.mjs --update    # rewrite the baseline
//   node scripts/perf/size-gate.mjs --json out.json
//
// Shrinking is never an error: the report suggests `--update` so the
// gain is locked in.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, dflt) => (args.includes(name) ? args[args.indexOf(name) + 1] : dflt);

const DIST = path.resolve(opt('--dist', process.env.DIST || path.resolve(here, '../../dist')));
const BASELINE = path.resolve(opt('--baseline', path.resolve(here, 'size-baseline.json')));
const BUDGETS = path.resolve(here, 'size-budgets.json');
const REGRESSION = 0.10; // > 10 % over baseline fails
const MIN_DELTA = 1024; // ... and only when it is at least 1 KiB gz (noise floor for tiny chunks)

const manifestPath = path.join(DIST, '.vite', 'manifest.json');
if (!fs.existsSync(manifestPath)) {
  console.error(`size-gate: ${path.relative(process.cwd(), manifestPath)} not found; build with \`npm run build -- --manifest\``);
  process.exit(2);
}
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

const gzCache = new Map();
function gz(file) {
  if (!gzCache.has(file)) {
    const buf = fs.readFileSync(path.join(DIST, file));
    gzCache.set(file, { raw: buf.length, gz: zlib.gzipSync(buf, { level: 9 }).length });
  }
  return gzCache.get(file);
}

/** Static-import closure of manifest keys (dynamic imports are not followed). */
function closure(keys) {
  const seen = new Set();
  const stack = [...keys];
  while (stack.length) {
    const k = stack.pop();
    if (seen.has(k) || !manifest[k]) continue;
    seen.add(k);
    for (const i of manifest[k].imports ?? []) stack.push(i);
  }
  return seen;
}
const filesOf = (keys, kind) => {
  const out = new Set();
  for (const k of keys) {
    const c = manifest[k];
    if (kind === 'js') out.add(c.file);
    else for (const f of c.css ?? []) out.add(f);
  }
  return [...out].filter((f) => (kind === 'js' ? f.endsWith('.js') : f.endsWith('.css')));
};
const sum = (files) => files.reduce((a, f) => ({ raw: a.raw + gz(f).raw, gz: a.gz + gz(f).gz }), { raw: 0, gz: 0 });

const entryKey = Object.keys(manifest).find((k) => manifest[k].isEntry);
if (!entryKey) {
  console.error('size-gate: no entry chunk in the manifest');
  process.exit(2);
}
const isApp = (k) => manifest[k]?.src === 'src/App.svelte' || manifest[k]?.name === 'App';
const appKey = (manifest[entryKey].dynamicImports ?? []).find(isApp);
if (!appKey) {
  console.error('size-gate: the entry does not import the App chunk dynamically; update the shell definition');
  process.exit(2);
}
const editorKey = Object.keys(manifest).find((k) => manifest[k].src === 'src/components/NoteEditor.svelte');

const entryClosure = closure([entryKey]);
const shellClosure = closure([entryKey, appKey]);
const shellJs = filesOf(shellClosure, 'js');
const metrics = {
  'shell.js': sum(shellJs),
  'entry.css': sum(filesOf(entryClosure, 'css')),
  'shell.css': sum(filesOf(shellClosure, 'css')),
};
if (editorKey) {
  const shellSet = new Set(shellJs);
  metrics['editor.js'] = sum(filesOf(closure([editorKey]), 'js').filter((f) => !shellSet.has(f)));
}

// Per-chunk sizes, keyed by a hash-free label. Chunks that share a name
// (e.g. the many CodeMirror legacy modes called `index`) are summed.
const chunks = {};
for (const [k, c] of Object.entries(manifest)) {
  if (!c.file?.endsWith('.js')) continue;
  // node_modules sources resolve through symlinks to machine-specific
  // relative paths; keep only the package path.
  const label = (c.src ?? c.name ?? k.replace(/-[A-Za-z0-9_-]{8}\.js$/, '')).replace(/^.*node_modules\//, 'node_modules/');
  const s = gz(c.file);
  const cur = (chunks[label] ??= { raw: 0, gz: 0, files: 0 });
  cur.raw += s.raw;
  cur.gz += s.gz;
  cur.files += 1;
}
const totalJs = Object.values(chunks).reduce((a, c) => a + c.gz, 0);

const report = {
  generatedBy: 'scripts/perf/size-gate.mjs',
  gzipLevel: 9,
  metrics,
  totals: { jsGz: totalJs, jsChunks: Object.values(chunks).reduce((a, c) => a + c.files, 0) },
  shellFiles: shellJs.map((f) => f.replace(/-[A-Za-z0-9_-]{8}\.js$/, '.js')).sort(),
  chunks: Object.fromEntries(Object.entries(chunks).sort(([a], [b]) => a.localeCompare(b))),
};

const kb = (n) => (n / 1024).toFixed(1) + ' KB';
const pct = (a, b) => (b ? (((a - b) / b) * 100).toFixed(1) + ' %' : 'n/a');

if (flag('--update')) {
  fs.writeFileSync(BASELINE, JSON.stringify(report, null, 2) + '\n');
  console.log(`size-gate: baseline written to ${path.relative(process.cwd(), BASELINE)}`);
  for (const [k, v] of Object.entries(metrics)) console.log(`  ${k.padEnd(10)} ${kb(v.gz).padStart(9)} gz  (${kb(v.raw)} raw)`);
  process.exit(0);
}
if (opt('--json')) fs.writeFileSync(opt('--json'), JSON.stringify(report, null, 2) + '\n');

const baseline = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, 'utf8')) : null;
const budgets = JSON.parse(fs.readFileSync(BUDGETS, 'utf8')).budgets;
const failures = [];
const warnings = [];
const improvements = [];

console.log('Bundle size (gzip -9)\n');
console.log('metric       current      baseline     delta      budget');
for (const [k, v] of Object.entries(metrics)) {
  const b = baseline?.metrics?.[k]?.gz;
  const budget = budgets[k];
  const line = `${k.padEnd(12)} ${kb(v.gz).padStart(9)}  ${(b != null ? kb(b) : '-').padStart(10)}  ${(b != null ? pct(v.gz, b) : '-').padStart(8)}   ${budget ? '<= ' + kb(budget.maxGz) + (budget.enforce ? ' (block)' : ' (warn)') : '-'}`;
  console.log(line);
  if (b != null && v.gz > b * (1 + REGRESSION) && v.gz - b >= MIN_DELTA) failures.push(`${k} grew ${pct(v.gz, b)} (${kb(b)} -> ${kb(v.gz)} gz), over the 10 % regression gate`);
  else if (b != null && v.gz < b * (1 - 0.02) && b - v.gz >= MIN_DELTA) improvements.push(`${k} shrank ${pct(v.gz, b)}`);
  if (budget && v.gz > budget.maxGz) {
    const msg = `${k} is ${kb(v.gz)} gz, over its budget of ${kb(budget.maxGz)} (${budget.note ?? ''})`;
    (budget.enforce ? failures : warnings).push(msg);
  }
}

if (baseline?.chunks) {
  const grown = [];
  for (const [label, c] of Object.entries(chunks)) {
    const b = baseline.chunks[label]?.gz;
    if (b == null) {
      if (c.gz >= MIN_DELTA * 4) warnings.push(`new chunk ${label} (${kb(c.gz)} gz)`);
      continue;
    }
    if (c.gz > b * (1 + REGRESSION) && c.gz - b >= MIN_DELTA) grown.push(`chunk ${label} grew ${pct(c.gz, b)} (${kb(b)} -> ${kb(c.gz)} gz)`);
  }
  failures.push(...grown);
} else {
  warnings.push(`no baseline at ${path.relative(process.cwd(), BASELINE)}; run with --update`);
}

console.log(`\nall JS: ${kb(totalJs)} gz in ${report.totals.jsChunks} chunks`);
for (const w of warnings) console.log(`::warning::size-gate: ${w}`);
for (const i of improvements) console.log(`size-gate: ${i}; lock it in with \`npm run perf:size -- --update\``);
if (failures.length) {
  for (const f of failures) console.log(`::error::size-gate: ${f}`);
  console.log('\nA budget increase needs the owner\'s approval in the PR (PERF-BUDGETS.md). If it is approved, rerun with --update and commit the baseline.');
  process.exit(1);
}
console.log('\nsize-gate: ok');
