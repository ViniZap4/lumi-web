// App-shell service worker: build-time generation + registration.
import { describe, it, expect, vi } from 'vitest';
import template from './sw-template.js?raw';
import { precacheList, swVersion, renderServiceWorker, lazyOnlyFiles, type ChunkInfo } from './sw-build.ts';
import { registerServiceWorker } from '../lib/sw-register.ts';

describe('precache list', () => {
  it('holds the shell and every built asset, never maps or the worker itself', () => {
    const list = precacheList(['index.html', 'assets/index-abc.js', 'assets/index-abc.js.map', 'assets/NoteEditor-x.js', 'assets/a.css', 'sw.js']);
    expect(list).toEqual(['/assets/NoteEditor-x.js', '/assets/a.css', '/assets/index-abc.js', '/index.html', '/vite.svg']);
  });

  it('the version follows the build content', () => {
    const a = swVersion(['/a.js'], '<html>1');
    expect(swVersion(['/a.js'], '<html>1')).toBe(a);
    expect(swVersion(['/b.js'], '<html>1')).not.toBe(a);
    expect(swVersion(['/a.js'], '<html>2')).not.toBe(a);
  });

  it('renders a parseable worker with the list injected and no placeholders left', () => {
    const out = renderServiceWorker(template, ['/index.html', '/assets/x.js'], 'v123', ['/assets/m.js']);
    expect(out).not.toContain('__LUMI_SW_');
    expect(out).not.toContain('@ts-nocheck');
    expect(out).toContain('const PRECACHE = ["/index.html","/assets/x.js"]');
    expect(out).toContain('const RUNTIME = new Set(["/assets/m.js"])');
    expect(() => new Function(out)).not.toThrow(); // syntax check only
  });

  it('never intercepts API, cross-origin, non-GET or authenticated requests', () => {
    expect(template).toMatch(/req\.method !== 'GET'\) return/);
    expect(template).toMatch(/url\.origin !== self\.location\.origin\) return/);
    expect(template).toMatch(/startsWith\('\/api\/'\)\) return/);
    expect(template).toMatch(/x-lumi-token/);
    expect(template).not.toMatch(/https?:\/\//); // no CDN / external URL
  });
});

describe('lazy diagram chunks (mermaid)', () => {
  const chunk = (fileName: string, o: Partial<ChunkInfo> = {}): ChunkInfo => ({ fileName, isEntry: false, imports: [], dynamicImports: [], ...o });
  const chunks = [
    chunk('assets/index-main.js', { isEntry: true, imports: ['assets/shared-x.js'], dynamicImports: ['assets/mermaid-render-a.js', 'assets/NoteEditor-b.js'] }),
    chunk('assets/NoteEditor-b.js', { imports: ['assets/shared-x.js'] }),
    chunk('assets/shared-x.js'),
    chunk('assets/mermaid-render-a.js', { imports: ['assets/index-main.js', 'assets/shared-x.js', 'assets/chunk-core.js'], dynamicImports: ['assets/flowDiagram-c.js', 'assets/pieDiagram-d.js'] }),
    chunk('assets/chunk-core.js', { css: ['assets/katex-e.css'] }),
    chunk('assets/flowDiagram-c.js', { imports: ['assets/chunk-core.js', 'assets/index-f.js'] }),
    chunk('assets/index-f.js'),
    chunk('assets/pieDiagram-d.js', { dynamicImports: ['assets/mermaid-render-a.js'] }),
  ];
  const lazy = lazyOnlyFiles(chunks, (c) => c.fileName.startsWith('assets/mermaid-render-'));

  it('collects the renderer and everything only it reaches, never shared or app chunks', () => {
    expect([...lazy].sort()).toEqual([
      'assets/chunk-core.js', 'assets/flowDiagram-c.js', 'assets/index-f.js', 'assets/katex-e.css', 'assets/mermaid-render-a.js', 'assets/pieDiagram-d.js',
    ]);
    expect(lazyOnlyFiles(chunks, () => false).size).toBe(0);
  });

  it('keeps them out of the precache list', () => {
    const files = [...chunks.map((c) => c.fileName), 'assets/katex-e.css', 'index.html'];
    expect(precacheList(files, lazy)).toEqual(['/assets/NoteEditor-b.js', '/assets/index-main.js', '/assets/shared-x.js', '/index.html', '/vite.svg']);
  });

  // Runs the generated worker against fake Cache Storage / fetch.
  function boot(runtime: string[]) {
    const listeners: Record<string, (e: unknown) => void> = {};
    const stores = new Map<string, Map<string, Response>>();
    const open = async (name: string) => {
      if (!stores.has(name)) stores.set(name, new Map());
      const m = stores.get(name)!;
      return {
        match: async (k: string) => m.get(k)?.clone(),
        put: async (k: string, r: Response) => void m.set(k, r),
        keys: async () => [...m.keys()],
        delete: async (k: string) => m.delete(k),
        addAll: async () => undefined,
      };
    };
    const caches = {
      open,
      match: async () => undefined,
      keys: async () => [...stores.keys()],
      delete: async (k: string) => stores.delete(k),
    };
    const fetch = vi.fn(async (req: Request) => Object.defineProperty(new Response('js:' + new URL(req.url).pathname), 'type', { value: 'basic' }));
    const self = {
      location: { origin: 'https://lumi.test' },
      clients: { claim: async () => undefined },
      addEventListener: (t: string, f: (e: unknown) => void) => (listeners[t] = f),
      skipWaiting: () => undefined,
    };
    const src = renderServiceWorker(template, ['/index.html', '/assets/index-main.js'], 'v1', runtime);
    new Function('self', 'caches', 'fetch', src)(self, caches, fetch);
    const get = async (path: string): Promise<Response | null> => {
      let p: Promise<Response> | null = null;
      listeners.fetch({ request: new Request('https://lumi.test' + path), respondWith: (r: Promise<Response>) => (p = r) });
      return p;
    };
    return { listeners, stores, fetch, get, caches };
  }

  it('caches a diagram chunk on first use and serves it offline afterwards', async () => {
    const sw = boot(['/assets/flowDiagram-c.js']);
    const first = await sw.get('/assets/flowDiagram-c.js');
    expect(await first!.text()).toBe('js:/assets/flowDiagram-c.js');
    expect(sw.fetch).toHaveBeenCalledTimes(1);
    sw.fetch.mockRejectedValue(new Error('offline'));
    const again = await sw.get('/assets/flowDiagram-c.js');
    expect(await again!.text()).toBe('js:/assets/flowDiagram-c.js');
    expect(sw.fetch).toHaveBeenCalledTimes(1);
    expect([...sw.stores.keys()]).toEqual(['lumi-lazy-v1']);
    // Not a lazy chunk, not precached: left to the network.
    expect(await sw.get('/assets/other.js')).toBeNull();
  });

  it('bounds the runtime cache and drops older builds on activate', async () => {
    const paths = Array.from({ length: 130 }, (_, i) => `/assets/d${i}.js`);
    const sw = boot(paths);
    for (const p of paths) await sw.get(p);
    const store = sw.stores.get('lumi-lazy-v1')!;
    expect(store.size).toBe(120);
    expect(store.has('/assets/d0.js')).toBe(false);
    expect(store.has('/assets/d129.js')).toBe(true);

    await sw.caches.open('lumi-lazy-old');
    await sw.caches.open('lumi-shell-old');
    await sw.caches.open('other-app');
    let done: Promise<unknown> | null = null;
    sw.listeners.activate({ waitUntil: (p: Promise<unknown>) => (done = p) });
    await done;
    expect([...sw.stores.keys()].sort()).toEqual(['lumi-lazy-v1', 'other-app']);
  });
});

describe('registerServiceWorker', () => {
  it('does nothing outside production builds (dev server, tests)', async () => {
    const register = vi.fn(async () => ({}));
    expect(await registerServiceWorker({ prod: false, navigator: { serviceWorker: { register } }, secure: true })).toBe(false);
    expect(register).not.toHaveBeenCalled();
    // The default env in vitest is not PROD either.
    expect(await registerServiceWorker()).toBe(false);
  });

  it('registers /sw.js at the root scope in production', async () => {
    const register = vi.fn(async () => ({}));
    expect(await registerServiceWorker({ prod: true, navigator: { serviceWorker: { register } }, secure: true })).toBe(true);
    expect(register).toHaveBeenCalledWith('/sw.js', { scope: '/' });
  });

  it('is a silent no-op without support, on insecure origins, or when registration fails', async () => {
    expect(await registerServiceWorker({ prod: true, navigator: {}, secure: true })).toBe(false);
    const register = vi.fn(async () => ({}));
    expect(await registerServiceWorker({ prod: true, navigator: { serviceWorker: { register } }, secure: false })).toBe(false);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const failing = vi.fn(async () => { throw new Error('blocked'); });
    expect(await registerServiceWorker({ prod: true, navigator: { serviceWorker: { register: failing } }, secure: true })).toBe(false);
    warn.mockRestore();
  });
});

describe('lazy code-block grammars', async () => {
  const { isLazyGrammarModule } = await import('./sw-build.ts');
  it('legacy modes and lang-* (not lang-markdown) are lazy roots', () => {
    expect(isLazyGrammarModule('/w/node_modules/@codemirror/legacy-modes/mode/shell.js')).toBe(true);
    expect(isLazyGrammarModule('/w/node_modules/@codemirror/lang-javascript/dist/index.js')).toBe(true);
    expect(isLazyGrammarModule('/w/node_modules/@codemirror/lang-html/dist/index.js')).toBe(true);
    expect(isLazyGrammarModule('/w/node_modules/@lezer/javascript/dist/index.js')).toBe(true);
  });
  it('the editor core stays precached', () => {
    for (const id of [
      '/w/node_modules/@codemirror/lang-markdown/dist/index.js',
      '/w/node_modules/@lezer/markdown/dist/index.js',
      '/w/node_modules/@lezer/common/dist/index.js',
      '/w/node_modules/@lezer/lr/dist/index.js',
      '/w/node_modules/@lezer/highlight/dist/index.js',
      '/w/node_modules/@codemirror/language-data/dist/index.js',
      '/w/src/lib/markdown-lang.ts',
    ]) expect(isLazyGrammarModule(id)).toBe(false);
  });
});
