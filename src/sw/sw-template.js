// @ts-nocheck — service-worker global scope; not part of the app bundle.
/* lumi web — app-shell service worker (generated at build time from
 * src/sw/sw-template.js by the plugin in vite.config.js; do not edit dist/sw.js).
 *
 * Scope: ONLY the static app shell of this origin. It never touches
 * API traffic (other origins, /api/, non-GET, anything carrying auth
 * headers) and never sees note content — that lives in IndexedDB.
 *
 *   install   precache index.html + every built asset (hashed names)
 *             except the lazy diagram renderer (mermaid)
 *   activate  drop caches of older builds, take control
 *   navigate  network first (a deploy is picked up at once when
 *             online), cached index.html when the network fails
 *   assets    cache first for the precached build files; the mermaid
 *             chunks are cached on first use (cache first, bounded,
 *             per build) so a diagram type seen once works offline;
 *             network for everything else
 *
 * No skipWaiting on install: a new build waits until every tab of the
 * old one is closed, so an open tab never loses the lazy chunks it may
 * still request.
 */
const VERSION = __LUMI_SW_VERSION__;
const PRECACHE = __LUMI_SW_PRECACHE__;
const CACHE = 'lumi-shell-' + VERSION;
const SHELL = '/index.html';
const NAV_TIMEOUT_MS = 4000;
const PRECACHED = new Set(PRECACHE);
const RUNTIME = new Set(__LUMI_SW_RUNTIME__);
const LAZY_CACHE = 'lumi-lazy-' + VERSION;
const LAZY_MAX = 120;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(PRECACHE.map((p) => new Request(p, { cache: 'reload' })))),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => (k.startsWith('lumi-shell-') && k !== CACHE) || (k.startsWith('lumi-lazy-') && k !== LAZY_CACHE))
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

function withTimeout(p, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;
  if (req.headers.has('authorization') || req.headers.has('x-lumi-token')) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      withTimeout(fetch(req), NAV_TIMEOUT_MS).catch(() =>
        caches.match(SHELL, { cacheName: CACHE }).then((r) => r || fetch(req)),
      ),
    );
    return;
  }

  if (PRECACHED.has(url.pathname)) {
    event.respondWith(caches.match(url.pathname, { cacheName: CACHE }).then((r) => r || fetch(req)));
    return;
  }

  if (RUNTIME.has(url.pathname)) event.respondWith(lazyChunk(req, url.pathname));
});

/** Cache first; a miss is fetched, stored and the cache trimmed to
 *  LAZY_MAX entries (oldest first). Hashed names never go stale. */
async function lazyChunk(req, path) {
  const cache = await caches.open(LAZY_CACHE);
  const hit = await cache.match(path);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok && res.type === 'basic') {
    await cache.put(path, res.clone());
    const keys = await cache.keys();
    for (const k of keys.slice(0, Math.max(0, keys.length - LAZY_MAX))) await cache.delete(k);
  }
  return res;
}
