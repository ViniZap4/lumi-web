// @vitest-environment jsdom
// WP0.6: rendering a note never makes the browser fetch another host by
// itself. Every URL-bearing attribute a browser would auto-load is
// audited in the rendered DOM (reader, raw HTML, Live Preview), and
// the click-to-load path fetches without cookies or Referer.
import { describe, it, expect, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { ensureSyntaxTree } from '@codemirror/language';
import { renderMarkdown } from './markdown.ts';
import { livePreview } from './live-preview.ts';
import { loadRemoteImage, isRemoteURL, REMOTE_IMG_LABEL } from './remote-images.ts';
import indexHtml from '../../index.html?raw';
import nginxConf from '../../nginx.conf?raw';

const HOSTILE = [
  '# Notes',
  '',
  '![leak](https://evil.test/p.png?q=SECRET)',
  '![titled](https://evil.test/t.png "caption")',
  '![proto](//evil.test/r.png)',
  'inline ![x](http://evil.test/i.gif) text and a [link](https://evil.test/page) and <https://evil.test/auto>',
  '',
  '<img src="https://evil.test/raw.png" alt="raw">',
  '<img srcset="https://evil.test/a.png 1x, https://evil.test/b.png 2x">',
  '<picture><source srcset="https://evil.test/s.webp"><img src="local.png"></picture>',
  '<video poster="https://evil.test/poster.jpg" src="https://evil.test/v.mp4"></video>',
  '<audio src="https://evil.test/a.mp3"></audio>',
  '<table background="https://evil.test/bg.png"><tr><td>x</td></tr></table>',
  '<object data="https://evil.test/o"></object>',
  '<link rel="stylesheet" href="https://evil.test/s.css">',
  '<div style="background:url(https://evil.test/css.png)">styled</div>',
  '',
  '| a | b |',
  '|---|---|',
  '| ![t](https://evil.test/cell.png) | 2 |',
  '',
  '> [!note] callout ![c](https://evil.test/callout.png)',
  '',
  '- [ ] task ![k](https://evil.test/task.png)',
  '',
].join('\n');

/** Every URL the browser would fetch on its own from this subtree. */
function autoFetchURLs(root: ParentNode): string[] {
  const out: string[] = [];
  const attrs = ['src', 'srcset', 'poster', 'data', 'background', 'href', 'xlink:href'];
  root.querySelectorAll('*').forEach((el) => {
    const tag = el.tagName.toLowerCase();
    for (const a of attrs) {
      const v = el.getAttribute(a);
      if (!v) continue;
      // Links and anchors only navigate on a click.
      if (a === 'href' && (tag === 'a' || tag === 'area')) continue;
      // The allow-listed embed iframes are the documented exception.
      if (tag === 'iframe') continue;
      if (/(^|[\s,])(https?:)?\/\//i.test(v)) out.push(`${tag}[${a}]=${v}`);
    }
    const style = el.getAttribute('style') ?? '';
    if (/url\(/i.test(style)) out.push(`${tag}[style]=${style}`);
  });
  return out;
}

describe('remote content is never auto-loaded', () => {
  it('the reader HTML for a hostile note has zero auto-fetching URLs', () => {
    const host = document.createElement('div');
    host.innerHTML = renderMarkdown(HOSTILE);
    document.body.append(host);
    expect(autoFetchURLs(host)).toEqual([]);
    // Images became click-to-load placeholders (markdown and raw HTML).
    const holders = host.querySelectorAll<HTMLElement>('.md-remote-img');
    expect(holders.length).toBeGreaterThanOrEqual(9);
    expect(holders[0].dataset.remoteSrc).toBe('https://evil.test/p.png?q=SECRET');
    expect(holders[0].textContent).toContain(REMOTE_IMG_LABEL);
    expect(holders[0].getAttribute('role')).toBe('button');
    // Links stay links (they only navigate on a click).
    expect(host.querySelector('a[href="https://evil.test/page"]')).not.toBeNull();
    // Local images still render as images.
    expect(host.querySelector('img[src="local.png"]')).not.toBeNull();
    host.remove();
  });

  it('Live Preview shows placeholders, not <img>, for remote images', () => {
    const doc = 'intro\n\n![leak](https://evil.test/lp.png?q=SECRET)\n\n![local](img/a.png)\n\nend';
    const view = new EditorView({
      state: EditorState.create({ doc, selection: { anchor: doc.length }, extensions: [markdown({ base: markdownLanguage }), livePreview()] }),
      parent: document.body,
    });
    ensureSyntaxTree(view.state, view.state.doc.length, 5000);
    view.dispatch({ selection: { anchor: doc.length - 1 } });
    expect(autoFetchURLs(view.dom)).toEqual([]);
    const holder = view.dom.querySelector<HTMLElement>('.md-remote-img');
    expect(holder?.dataset.remoteSrc).toBe('https://evil.test/lp.png?q=SECRET');
    expect(view.dom.querySelector('img.cm-lp-image')?.getAttribute('src')).toBe('img/a.png');
    view.destroy();
  });

  it('in Live Preview a click loads the image inside the widget and it stays', async () => {
    const doc = 'intro\n\n![leak](https://evil.test/lp.png)\n\nend';
    const view = new EditorView({
      state: EditorState.create({ doc, selection: { anchor: doc.length }, extensions: [markdown({ base: markdownLanguage }), livePreview()] }),
      parent: document.body,
    });
    ensureSyntaxTree(view.state, view.state.doc.length, 5000);
    view.dispatch({ selection: { anchor: doc.length - 1 } });
    (URL as unknown as { createObjectURL: unknown }).createObjectURL = () => 'blob:lp';
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(new Blob(['x'], { type: 'image/png' }), { headers: { 'content-type': 'image/png' } })) as typeof fetch;
    try {
      view.dom.querySelector<HTMLElement>('.md-remote-img')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
      view.dispatch({ selection: { anchor: 1 } }); // a later update keeps it
      expect(view.dom.querySelector('.cm-lp-remote-image img')?.getAttribute('src')).toBe('blob:lp');
      expect(view.state.doc.toString()).toBe(doc);
    } finally {
      globalThis.fetch = realFetch;
      view.destroy();
    }
  });

  it('a click loads the image without cookies or Referer, as a blob:', async () => {
    const box = document.createElement('div');
    const el = document.createElement('span');
    el.dataset.remoteSrc = 'https://img.test/a.png';
    el.dataset.alt = 'alt';
    box.append(el);
    document.body.append(box);
    const createObjectURL = vi.fn(() => 'blob:mock');
    (URL as unknown as { createObjectURL: unknown }).createObjectURL = createObjectURL;
    const fetchMock = vi.fn(async () => new Response(new Blob(['x'], { type: 'image/png' }), { headers: { 'content-type': 'image/png' } }));
    expect(await loadRemoteImage(el, fetchMock as unknown as typeof fetch)).toBe('loaded');
    expect(fetchMock).toHaveBeenCalledWith('https://img.test/a.png', expect.objectContaining({ credentials: 'omit', referrerPolicy: 'no-referrer', mode: 'cors' }));
    expect(box.querySelector('img')?.getAttribute('src')).toBe('blob:mock');
    box.remove();
  });

  it('when the host refuses a CORS fetch, the placeholder becomes a safe link', async () => {
    const el = document.createElement('span');
    el.dataset.remoteSrc = 'https://img.test/b.png';
    document.body.append(el);
    const fetchMock = vi.fn(async () => { throw new TypeError('cors'); });
    expect(await loadRemoteImage(el, fetchMock as unknown as typeof fetch)).toBe('link');
    const a = document.body.querySelector<HTMLAnchorElement>('a.md-remote-img-link');
    expect(a?.getAttribute('href')).toBe('https://img.test/b.png');
    expect(a?.rel).toBe('noopener noreferrer');
    a?.remove();
  });

  it('isRemoteURL', () => {
    for (const r of ['https://a/b.png', 'http://a', '//a/b', ' HTTPS://A']) expect(isRemoteURL(r)).toBe(true);
    for (const l of ['a.png', '/x.png', 'data:image/png;base64,AA', 'blob:x']) expect(isRemoteURL(l)).toBe(false);
  });
});

describe('CSP', () => {
  const meta = /<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(indexHtml)![1];
  const header = /add_header Content-Security-Policy "([^"]+)"/.exec(nginxConf)![1];
  const directive = (csp: string, name: string) => csp.split(';').map((d) => d.trim()).find((d) => d.startsWith(name + ' ')) ?? '';

  it('img-src does not allow arbitrary https: hosts', () => {
    expect(directive(meta, 'img-src')).toBe("img-src 'self' data: blob:");
  });
  it('index.html and nginx.conf carry the same policy (nginx adds frame-ancestors only)', () => {
    expect(header.replace(/; frame-ancestors 'none'$/, '')).toBe(meta);
  });
});
