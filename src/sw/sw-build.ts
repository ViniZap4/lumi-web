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

export function precacheList(fileNames: string[], exclude: ReadonlySet<string> = new Set()): string[] {
  const out = new Set<string>(['/index.html']);
  for (const f of fileNames) {
    if (SKIP.some((r) => r.test(f)) || exclude.has(f)) continue;
    out.add('/' + f.replace(/^\/+/, ''));
  }
  for (const p of PUBLIC_SHELL) out.add(p);
  return [...out].sort();
}

/** What the worker needs to know about one emitted JS chunk. */
export interface ChunkInfo {
  fileName: string;
  isEntry: boolean;
  imports: readonly string[];
  dynamicImports: readonly string[];
  /** CSS files Vite emitted for this chunk. */
  css?: readonly string[];
}

/**
 * Files reachable only through a lazy root (today: the mermaid
 * renderer and its per-diagram chunks). They are not precached, which
 * keeps installs and deploys light; the worker caches them at runtime
 * instead (see the template). A chunk an entry reaches without going
 * through a root (shared code) stays in the precache.
 */
export function lazyOnlyFiles(chunks: readonly ChunkInfo[], isRoot: (c: ChunkInfo) => boolean): Set<string> {
  const byName = new Map(chunks.map((c) => [c.fileName, c]));
  const walk = (starts: ChunkInfo[], stopAtRoots: boolean): Set<string> => {
    const seen = new Set<string>();
    const stack = [...starts];
    while (stack.length) {
      const c = stack.pop()!;
      if (seen.has(c.fileName)) continue;
      seen.add(c.fileName);
      for (const f of c.css ?? []) seen.add(f);
      for (const n of [...c.imports, ...c.dynamicImports]) {
        const next = byName.get(n);
        if (next && !(stopAtRoots && isRoot(next))) stack.push(next);
      }
    }
    return seen;
  };
  const roots = chunks.filter(isRoot);
  if (!roots.length) return new Set();
  const eager = walk(chunks.filter((c) => c.isEntry && !isRoot(c)), true);
  return new Set([...walk(roots, false)].filter((f) => !eager.has(f)));
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

export function renderServiceWorker(template: string, list: string[], version: string, runtime: string[] = []): string {
  return template
    .replace('__LUMI_SW_RUNTIME__', JSON.stringify(runtime))
    .replace('// @ts-nocheck — service-worker global scope; not part of the app bundle.\n', '')
    .replace('__LUMI_SW_VERSION__', JSON.stringify(version))
    .replace('__LUMI_SW_PRECACHE__', JSON.stringify(list));
}
