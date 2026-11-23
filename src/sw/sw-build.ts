// Pure helpers for the build-time service-worker generator (the Vite
// plugin itself lives in vite.config.js, which has Node at hand).
// At `generateBundle` every emitted file is known with its
// content-hashed name; the template src/sw/sw-template.js receives the
// precache list and a version derived from it, and is emitted as
// /sw.js. No runtime dependency, no CDN: the worker is served from
// 'self', which the CSP `worker-src 'self'` already allows.

/** Files never precached (source maps, the worker itself). */
const SKIP = [/\.map$/, /^sw\.js$/];

/** Public-dir files that belong to the shell. */
const PUBLIC_SHELL = ['/vite.svg'];

export function precacheList(fileNames: string[]): string[] {
  const out = new Set<string>(['/index.html']);
  for (const f of fileNames) {
    if (SKIP.some((r) => r.test(f))) continue;
    out.add('/' + f.replace(/^\/+/, ''));
  }
  for (const p of PUBLIC_SHELL) out.add(p);
  return [...out].sort();
}

/** Build version: FNV-1a over the precache list and index.html (hashed
 *  file names already change with their content). */
export function swVersion(list: string[], indexHtml: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  const s = list.join('\n') + '\0' + indexHtml;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x811c9dc5) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

export function renderServiceWorker(template: string, list: string[], version: string): string {
  return template
    .replace('// @ts-nocheck — service-worker global scope; not part of the app bundle.\n', '')
    .replace('__LUMI_SW_VERSION__', JSON.stringify(version))
    .replace('__LUMI_SW_PRECACHE__', JSON.stringify(list));
}
