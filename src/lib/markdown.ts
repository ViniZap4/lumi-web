// Markdown rendering for the note preview. marked → DOMPurify. Media
// embeds are handled by post-render walk so each gets a sanitised
// element instead of an opaque iframe injection through the parser.
//
// Sanitisation is conservative: HTML profile + an explicit forbid
// list. Style attributes and event handlers are dropped — slice 4.6
// will harden further with a strict CSP header on the served HTML.

import { Marked } from 'marked';
import DOMPurify from 'dompurify';

// One Marked instance, configured for note bodies. GFM + breaks =
// roughly what Obsidian does, which matches the TUI client's
// expectations for the same files.
const markedInstance = new Marked({
  gfm: true,
  breaks: true,
  pedantic: false,
});

// Allow-list of iframe sources for media embeds. Anything else gets
// scrubbed during sanitisation.
const EMBED_HOST_ALLOWLIST = new Set<string>([
  'www.youtube-nocookie.com',
  'www.youtube.com',
  'player.vimeo.com',
]);

// DOMPurify hook: when an iframe survives the parse step we double-
// check its src against the allow-list and add `sandbox` defensively.
DOMPurify.addHook('uponSanitizeElement', (node, data) => {
  if (data.tagName !== 'iframe') return;
  const el = node as HTMLIFrameElement;
  const src = el.getAttribute('src') ?? '';
  try {
    const url = new URL(src);
    if (!EMBED_HOST_ALLOWLIST.has(url.host)) {
      el.remove();
      return;
    }
  } catch {
    el.remove();
    return;
  }
  el.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-presentation');
  el.setAttribute('loading', 'lazy');
  el.setAttribute('referrerpolicy', 'no-referrer');
});

export interface RenderOptions {
  /** Absolute base URL for relative image / link resolution. Optional. */
  baseURL?: string;
}

/**
 * Render markdown source to a sanitised HTML string suitable for
 * dropping into a `{@html ...}` Svelte tag. Never executes scripts;
 * stylesheets are dropped; only allow-listed iframes survive.
 */
export function renderMarkdown(src: string, opts: RenderOptions = {}): string {
  if (!src) return '';

  // Pre-transform: lift bare `![alt](src)` paragraphs that point at a
  // YouTube / Vimeo URL into <iframe> embeds. marked would otherwise
  // render them as <img> tags with broken src.
  const withEmbeds = liftMediaEmbeds(src);

  const rawHtml = markedInstance.parse(withEmbeds, { async: false }) as string;
  const safe = DOMPurify.sanitize(rawHtml, {
    USE_PROFILES: { html: true },
    ADD_TAGS: ['iframe'],
    ADD_ATTR: ['allow', 'allowfullscreen', 'frameborder', 'scrolling', 'sandbox', 'loading', 'referrerpolicy', 'target', 'rel'],
    FORBID_TAGS: ['style', 'script', 'object', 'embed', 'form', 'input', 'button', 'meta', 'link'],
    FORBID_ATTR: ['style', 'onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'onblur'],
  });

  // Resolve relative links if a baseURL was supplied. The notes
  // preview pane doesn't ship one yet; reserved for media support in
  // a later slice.
  return opts.baseURL ? resolveRelativeURLs(safe, opts.baseURL) : safe;
}

// liftMediaEmbeds rewrites `![alt](https://www.youtube.com/...)` and
// `![alt](https://player.vimeo.com/...)` paragraphs into raw
// <iframe> blocks so marked emits them as HTML rather than <img>.
function liftMediaEmbeds(src: string): string {
  return src.replace(
    /^\s*!\[([^\]]*)\]\(([^)]+)\)\s*$/gm,
    (match, _alt, url) => {
      const embed = embedHTMLFor(url);
      return embed ?? match;
    },
  );
}

function embedHTMLFor(rawURL: string): string | null {
  let u: URL;
  try {
    u = new URL(rawURL);
  } catch {
    return null;
  }
  // YouTube.
  if (u.host === 'www.youtube.com' || u.host === 'youtube.com' || u.host === 'youtu.be') {
    let id = '';
    if (u.host === 'youtu.be') {
      id = u.pathname.slice(1);
    } else if (u.pathname.startsWith('/watch')) {
      id = u.searchParams.get('v') ?? '';
    } else if (u.pathname.startsWith('/embed/')) {
      id = u.pathname.split('/')[2] ?? '';
    }
    if (!id) return null;
    return `<iframe src="https://www.youtube-nocookie.com/embed/${id}" allowfullscreen frameborder="0"></iframe>`;
  }
  // Vimeo.
  if (u.host === 'vimeo.com' || u.host === 'player.vimeo.com') {
    const id =
      u.host === 'vimeo.com'
        ? u.pathname.split('/').filter(Boolean)[0] ?? ''
        : u.pathname.split('/').filter(Boolean)[1] ?? '';
    if (!id) return null;
    return `<iframe src="https://player.vimeo.com/video/${id}" allowfullscreen frameborder="0"></iframe>`;
  }
  return null;
}

function resolveRelativeURLs(html: string, base: string): string {
  return html.replace(/(\b(?:href|src)=")(?!https?:|data:|mailto:|#)([^"]+)"/g, (_m, p, ref) => {
    try {
      return `${p}${new URL(ref, base).toString()}"`;
    } catch {
      return `${p}${ref}"`;
    }
  });
}
