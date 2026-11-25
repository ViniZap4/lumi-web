// @vitest-environment jsdom
//
// /p/:slug public reader (M3): anonymous requests only (no auth header,
// no token, no cookies, no Referer) even with a signed-in account on
// this device; sanitised rendering; pt-BR refusals.

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { mount, unmount, flushSync, tick } from 'svelte';
import PublicReader from './PublicReader.svelte';
import { parsePublicPath, publicNotePath, publicServer, getPublicBook, PublicError } from './public-api.ts';

const S = 'https://mirror.example';
type Call = { url: string; init: RequestInit };
let calls: Call[];
let routes: Record<string, () => Response>;
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const fakeFetch = (async (url: string, init: RequestInit = {}) => {
  calls.push({ url, init });
  return (routes[url] ?? (() => json(404, { error: 'not_found' })))();
}) as unknown as typeof fetch;

let target: HTMLElement;
let cmp: Record<string, any> | null = null;
async function settle(): Promise<void> {
  for (let i = 0; i < 8; i++) {
    await Promise.resolve();
    await tick();
    await new Promise((r) => setTimeout(r, 0));
  }
  flushSync();
}

beforeEach(() => {
  calls = [];
  routes = {
    [`${S}/api/public/books/blog`]: () => json(200, { name: 'Blog', notes: [{ id: 'hello', path: 'hello.md', title: 'Hello', kind: 'markdown', updated_at: '' }] }),
    [`${S}/api/public/books/blog/notes/hello`]: () =>
      json(200, { id: 'hello', path: 'hello.md', title: 'Hello', kind: 'markdown', updated_at: '', body: '# Hi\n\nPublic **text** <img src=x onerror="alert(1)"><script>alert(2)</script>' }),
  };
  // A signed-in account on this device: must never be used here.
  localStorage.setItem('lumi.tab.accounts.v1', JSON.stringify({ token: 'SECRET-TOKEN' }));
  sessionStorage.setItem('lumi.tab.accounts.v1', JSON.stringify({ token: 'SECRET-TOKEN' }));
  document.cookie = 'lumi=SECRET-COOKIE';
  target = document.createElement('div');
  document.body.appendChild(target);
});
afterEach(() => {
  if (cmp) unmount(cmp);
  cmp = null;
  target.remove();
  localStorage.clear();
  sessionStorage.clear();
});

describe('public reader', () => {
  it('fetches anonymously and renders the note through the sanitiser', async () => {
    cmp = mount(PublicReader, { target, props: { slug: 'blog', noteID: 'hello', server: S, fetchImpl: fakeFetch } });
    await settle();
    const art = target.querySelector('[data-testid="public-note"]')!;
    expect(art.textContent).toContain('Public text');
    expect(art.querySelector('strong')?.textContent).toBe('text');
    expect(art.innerHTML).not.toMatch(/onerror|<script/i);
    expect(calls.map((c) => c.url)).toEqual([`${S}/api/public/books/blog`, `${S}/api/public/books/blog/notes/hello`]);
    for (const c of calls) {
      expect(c.init.credentials).toBe('omit');
      expect(c.init.referrerPolicy).toBe('no-referrer');
      const h = new Headers(c.init.headers);
      expect(h.has('Authorization')).toBe(false);
      expect(h.has('X-Lumi-Token')).toBe(false);
      expect(JSON.stringify(c.init)).not.toContain('SECRET');
      expect(c.url).not.toContain('token');
    }
  });

  it('pt-BR refusals: 404, 410 gone, 429 with the wait', async () => {
    routes[`${S}/api/public/books/gone`] = () => json(410, { error: 'gone' });
    cmp = mount(PublicReader, { target, props: { slug: 'gone', noteID: null, server: S, fetchImpl: fakeFetch } });
    await settle();
    expect(target.querySelector('[data-testid="public-error"]')?.textContent).toBe('Este livro não é mais público.');
    routes[`${S}/api/public/books/busy`] = () => json(429, { error: 'rate_limited', retry_after: 30 }, { 'Retry-After': '30' });
    await expect(getPublicBook(S, 'busy', fakeFetch)).rejects.toMatchObject({ status: 429, message: 'Muitas leituras seguidas. Tente de novo em 30 s.' });
    await expect(getPublicBook(S, 'nope', fakeFetch)).rejects.toBeInstanceOf(PublicError);
  });
});

describe('public paths', () => {
  it('parses /p/:slug and /p/:slug/n/:id, rejects anything else', () => {
    expect(parsePublicPath('/p/blog')).toEqual({ slug: 'blog', noteID: null });
    expect(parsePublicPath('/p/blog/')).toEqual({ slug: 'blog', noteID: null });
    expect(parsePublicPath('/p/blog/n/hello%20world.canvas')).toEqual({ slug: 'blog', noteID: 'hello world.canvas' });
    expect(parsePublicPath('/')).toBeNull();
    expect(parsePublicPath('/p/')).toBeNull();
    expect(parsePublicPath('/p/bad slug')).toBeNull();
    expect(parsePublicPath('/p/blog/n/a%2Fb')).toBeNull();
    expect(publicNotePath('blog', 'a b')).toBe('/p/blog/n/a%20b');
  });

  it('the server is the build default or this origin — never from the URL', () => {
    expect(publicServer('https://api.example/', 'https://web.example')).toBe('https://api.example');
    expect(publicServer(null, 'https://web.example')).toBe('https://web.example');
  });
});
