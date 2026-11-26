// Calibration workload for the bench gate (scripts/perf/bench-gate.mjs).
//
// A fixed, dependency-free mix of string, array, Map and JSON work.
// The gate divides every benchmark by this one measured in the same
// run, so a committed baseline from one machine stays comparable on a
// slower or faster CI runner. Never change this file without
// regenerating the baseline (`npm run bench:baseline`).
import { bench, describe } from 'vitest';
import { mulberry32 } from './corpus.ts';

function workload(): number {
  const r = mulberry32(0xca1);
  const parts: string[] = [];
  for (let i = 0; i < 4000; i++) parts.push((r() * 1e9).toString(36));
  const text = parts.join(' ');
  const counts = new Map<string, number>();
  for (const w of text.split(' ')) {
    const k = w.slice(0, 2);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const json = JSON.stringify([...counts]);
  const back = JSON.parse(json) as [string, number][];
  let acc = 0;
  for (const [k, v] of back.sort((a, b) => (a[0] < b[0] ? -1 : 1))) acc = (acc * 31 + v + k.charCodeAt(0)) | 0;
  return acc;
}

describe('calibration', () => {
  bench('calibration workload', () => {
    workload();
  });
});
