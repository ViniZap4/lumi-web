// Remote images are click-to-load (WP0.6, owner decision Q2).
//
// The CSP no longer allows `img-src https:`: one image URL planted in a
// note (by a collaborator, a federated book or, later, an AI) would
// otherwise make every viewer's browser call that host with zero
// clicks. Rendered markdown, raw HTML <img> and Live Preview show a
// placeholder instead. A click on it is the user's explicit choice:
// the image is fetched without cookies or Referer (connect-src) and
// shown from a blob: URL; when the host refuses that (no CORS), the
// placeholder becomes a link that opens the image in a new tab.
// A per-book image proxy (opt-in, server side) is a later step.

export const REMOTE_IMG_CLASS = 'md-remote-img';
export const REMOTE_IMG_LABEL = 'Imagem externa — clique para carregar';
const MAX_BYTES = 15 * 1024 * 1024;

/** An absolute http(s) or protocol-relative URL: fetched from another
 *  host, so never loaded without a click. */
export function isRemoteURL(raw: string): boolean {
  const s = raw.trim();
  return /^https?:/i.test(s) || s.startsWith('//');
}

function hostOf(url: string): string {
  try {
    return new URL(url, 'https://x.invalid').host;
  } catch {
    return '';
  }
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Placeholder markup (it goes through DOMPurify like everything else). */
export function remoteImageHTML(src: string, alt: string): string {
  const host = hostOf(src);
  return `<span class="${REMOTE_IMG_CLASS}" role="button" tabindex="0" data-remote-src="${esc(src)}" data-alt="${esc(alt)}" title="${esc(src)}">`
    + `<span class="md-remote-img-label">${REMOTE_IMG_LABEL}</span>`
    + (host ? `<span class="md-remote-img-host">${esc(host)}</span>` : '')
    + (alt ? `<span class="md-remote-img-alt">${esc(alt)}</span>` : '')
    + '</span>';
}

/** The same placeholder as a DOM node (Live Preview, sanitiser hook). */
export function remoteImageElement(doc: Document, src: string, alt: string): HTMLElement {
  const el = doc.createElement('span');
  el.className = REMOTE_IMG_CLASS;
  el.setAttribute('role', 'button');
  el.tabIndex = 0;
  el.dataset.remoteSrc = src;
  el.dataset.alt = alt;
  el.title = src;
  const label = doc.createElement('span');
  label.className = 'md-remote-img-label';
  label.textContent = REMOTE_IMG_LABEL;
  el.append(label);
  const host = hostOf(src);
  if (host) {
    const h = doc.createElement('span');
    h.className = 'md-remote-img-host';
    h.textContent = host;
    el.append(h);
  }
  if (alt) {
    const a = doc.createElement('span');
    a.className = 'md-remote-img-alt';
    a.textContent = alt;
    el.append(a);
  }
  return el;
}

/** Load the image behind a placeholder (after the user's click). */
export async function loadRemoteImage(el: HTMLElement, fetchImpl: typeof fetch = fetch): Promise<'loaded' | 'link' | 'skip'> {
  const src = el.dataset.remoteSrc ?? '';
  if (!isRemoteURL(src) || el.dataset.state === 'loading') return 'skip';
  el.dataset.state = 'loading';
  el.setAttribute('aria-busy', 'true');
  let url: URL | null = null;
  try {
    url = new URL(src, window.location.href);
  } catch {
    // handled below
  }
  if (!url || (url.protocol !== 'https:' && url.protocol !== 'http:')) {
    // Not loadable: leave the placeholder usable, not stuck "busy".
    delete el.dataset.state;
    el.removeAttribute('aria-busy');
    return 'skip';
  }
  try {
    const res = await fetchImpl(url.href, { mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'follow' });
    const type = res.headers.get('content-type') ?? '';
    if (!res.ok || !/^image\//i.test(type)) throw new Error('not an image');
    const blob = await res.blob();
    if (blob.size > MAX_BYTES) throw new Error('too large');
    const img = document.createElement('img');
    img.src = URL.createObjectURL(blob);
    img.alt = el.dataset.alt ?? '';
    img.title = src;
    img.decoding = 'async';
    el.replaceWith(img);
    return 'loaded';
  } catch {
    // The host does not allow a cookie-less cross-origin fetch: offer a
    // plain link instead (the browser then fetches it as a page).
    const a = document.createElement('a');
    a.className = `${REMOTE_IMG_CLASS} md-remote-img-link`;
    a.href = url.href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.referrerPolicy = 'no-referrer';
    a.textContent = 'Não foi possível carregar aqui — abrir a imagem em nova aba';
    a.title = src;
    el.replaceWith(a);
    return 'link';
  }
}
