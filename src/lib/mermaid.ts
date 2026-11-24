// ```mermaid blocks in rendered markdown: the DOM side.
//
// markdown.ts emits `<div class="md-mermaid" data-kind=…><pre
// class="md-mermaid-src"><code>source</code></pre></div>`. This module
// turns such a block into a diagram:
//
//   - mermaid itself lives in a lazy chunk (lib/mermaid-render.ts),
//     imported the first time a block is painted;
//   - results are cached by (source, theme), so remounts (hover card,
//     scrolling a long note, switching notes) and a cache hit after a
//     theme round-trip paint synchronously;
//   - every SVG goes through a dedicated DOMPurify instance before it
//     reaches the DOM (see sanitizeMermaidSvg);
//   - the palette is derived from the live lumi theme tokens, and every
//     painted block re-renders when the theme changes;
//   - a render error becomes a friendly card; the source stays visible.
//
// The block's chrome (header, actions, lightbox) is built here, never
// by note content.

import DOMPurify, { type Config } from 'dompurify';
import { FORBID_ATTR, FORBID_TAGS } from './markdown.ts';
import { mermaidInfo, mermaidLabel } from './mermaid-detect.ts';
import type { MermaidThemeVars, RenderedSvg } from './mermaid-render.ts';
import { openMermaidLightbox } from './mermaid-lightbox.ts';
import '../styles/mermaid.css';

export const MAX_SOURCE = 50_000;

// ── sanitisation ───────────────────────────────────────────────────────

/** SVG-only additions to the note HTML policy (markdown.ts): the SVG
 *  profile, plus `<style>` (scoped below) and `<use>` (local refs only).
 *  Everything that can run script, load a remote resource or embed
 *  HTML is forbidden. */
const SVG_FORBID_TAGS = [
  ...FORBID_TAGS.filter((t) => t !== 'style'),
  'foreignObject', 'foreignobject', 'a', 'image', 'feImage', 'iframe',
  'animate', 'animateMotion', 'animateTransform', 'animateColor', 'set', 'mpath',
];
const SVG_FORBID_ATTR = FORBID_ATTR.filter((a) => a !== 'style');

const SVG_CONFIG: Config & { RETURN_DOM_FRAGMENT: true } = {
  USE_PROFILES: { svg: true, svgFilters: true },
  ADD_TAGS: ['use'],
  FORBID_TAGS: SVG_FORBID_TAGS,
  FORBID_ATTR: SVG_FORBID_ATTR,
  ALLOW_DATA_ATTR: false,
  RETURN_DOM_FRAGMENT: true,
};

/** `url(` that points anywhere but a local `#fragment`. */
const REMOTE_URL = /url\s*\(\s*(?!['"]?\s*#)/i;
const BAD_CSS = /expression\s*\(|javascript:|vbscript:|@import|behavio(?:u)?r\s*:|-moz-binding|\\/i;

let purifier: ReturnType<typeof DOMPurify> | null = null;
function svgPurifier(): ReturnType<typeof DOMPurify> {
  if (purifier) return purifier;
  const p = DOMPurify(window);
  p.addHook('uponSanitizeAttribute', (_node, data) => {
    const name = data.attrName.toLowerCase();
    const value = data.attrValue ?? '';
    if (name.startsWith('on')) {
      data.keepAttr = false;
      return;
    }
    if (name === 'href' || name === 'xlink:href') {
      // Diagrams only ever reference their own defs.
      if (!/^#[\w:.-]+$/.test(value.trim())) data.keepAttr = false;
      return;
    }
    if (REMOTE_URL.test(value) || (name === 'style' && BAD_CSS.test(value))) data.keepAttr = false;
  });
  purifier = p;
  return p;
}

/** Split a selector list on top-level commas. */
function splitSelectors(sel: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of sel) {
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

/** Parse CSS with the browser's own parser without applying it: a
 *  constructable sheet (never applied, `@import` ignored), else a
 *  `media="not all"` element that is detached straight away. */
function parseCss(css: string): CSSRuleList | null {
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    return sheet.cssRules;
  } catch {
    // older engines / jsdom
  }
  const el = document.createElement('style');
  el.media = 'not all';
  el.textContent = css;
  document.head.append(el);
  try {
    return el.sheet?.cssRules ?? null;
  } finally {
    el.remove();
  }
}

/**
 * Keep only the CSS rules that are scoped to this diagram (`#id …`)
 * plus keyframes; drop at-rules (`@import`, `@font-face`, `@media`…),
 * rules that escape the scope (a crafted `classDef … } body { … }`)
 * and anything that loads a remote URL. Parsed by the browser's own
 * CSS parser in an inert document, so the result is what would apply.
 */
export function scopeDiagramCss(css: string, id: string): string {
  const rules = parseCss(css.replace(/@import[^;]*;?/gi, ''));
  if (!rules) return '';
  const scope = `#${id}`;
  const keep: string[] = [];
  for (const rule of Array.from(rules)) {
    const text = rule.cssText;
    if (REMOTE_URL.test(text) || BAD_CSS.test(text)) continue;
    // CSSRule.STYLE_RULE = 1, KEYFRAMES_RULE = 7
    if (rule.type === 7) {
      keep.push(text);
      continue;
    }
    if (rule.type !== 1) continue;
    const sel = (rule as CSSStyleRule).selectorText ?? '';
    const parts = splitSelectors(sel);
    if (!parts.length) continue;
    if (parts.every((p) => p === scope || p.startsWith(scope + ' ') || p.startsWith(scope + '.') || p.startsWith(scope + '>') || p.startsWith(scope + ':') || p.startsWith(scope + '['))) {
      keep.push(text);
    }
  }
  return keep.join('\n');
}

/**
 * Sanitise mermaid output. Returns the serialised `<svg>` or '' when
 * nothing usable survives. `id` is the id mermaid rendered with: the
 * root keeps it and embedded CSS must be scoped to it.
 */
export function sanitizeMermaidSvg(svg: string, id: string): string {
  // Links (`click X href …`) become plain groups: mermaid puts the
  // node's position on the <a>, so unwrapping it would move the node.
  // Only markup tags match here (label text is entity-encoded), and the
  // result still goes through the sanitiser, which drops any href.
  const delinked = svg.replace(/<a(?=[\s>])/g, '<g').replace(/<\/a>/g, '</g>');
  const frag = svgPurifier().sanitize(delinked, SVG_CONFIG);
  const root = frag.querySelector('svg');
  if (!root) return '';
  root.setAttribute('id', id);
  root.querySelectorAll('style').forEach((s) => {
    const scoped = scopeDiagramCss(s.textContent ?? '', id);
    if (scoped) s.textContent = scoped;
    else s.remove();
  });
  root.setAttribute('aria-hidden', 'true');
  root.setAttribute('focusable', 'false');
  return root.outerHTML;
}

// ── theme ──────────────────────────────────────────────────────────────

const FALLBACK = {
  primary: '#7aa2f7', secondary: '#bb9af7', accent: '#7dcfff', background: '#1a1b26', overlay: '#16161e',
  text: '#c0caf5', border: '#3b4261', error: '#f7768e', warning: '#e0af68', info: '#7dcfff',
};

function parseHex(c: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].split('').map((x) => x + x).join('') : m[1];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** `a` at weight `t` over `b` (sRGB), as #rrggbb. */
export function mixHex(a: string, b: string, t: number): string {
  const x = parseHex(a);
  const y = parseHex(b);
  if (!x || !y) return x ? a : b;
  const c = x.map((v, i) => Math.round(v * t + y[i] * (1 - t)));
  return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
}

/** Mermaid theme variables from the current lumi theme tokens. */
export function currentMermaidTheme(): MermaidThemeVars {
  const cs = typeof document !== 'undefined' ? getComputedStyle(document.documentElement) : null;
  const tok = (name: string, fb: string): string => {
    const v = cs?.getPropertyValue(name).trim() ?? '';
    return parseHex(v) ? v : fb;
  };
  const p = tok('--color-primary', FALLBACK.primary);
  const s = tok('--color-secondary', FALLBACK.secondary);
  const a = tok('--color-accent', FALLBACK.accent);
  const bg = tok('--color-background', FALLBACK.background);
  const ov = tok('--color-overlay-bg', FALLBACK.overlay);
  const tx = tok('--color-text', FALLBACK.text);
  const bd = tok('--color-border', FALLBACK.border);
  const er = tok('--color-error', FALLBACK.error);
  const wa = tok('--color-warning', FALLBACK.warning);
  const inf = tok('--color-info', FALLBACK.info);
  const dark = (typeof document !== 'undefined' ? document.documentElement.dataset.theme : '') !== 'light';
  const font = (cs?.getPropertyValue('--font-sans').trim() || 'ui-sans-serif, system-ui, sans-serif').replace(/;/g, '');

  // Fills are washes of the theme colours (DESIGN-LANGUAGE §2.3),
  // lines and labels are ink; nothing is a solid accent block.
  const wash = (c: string, t = 0.18) => mixHex(c, bg, t);
  const ink2 = mixHex(tx, bg, 0.78);
  const ink3 = mixHex(tx, bg, dark ? 0.58 : 0.66);
  const line = mixHex(tx, bg, 0.5);
  const series = [p, s, a, wa, inf, er, mixHex(p, s, 0.5), mixHex(a, wa, 0.5), mixHex(s, er, 0.5), mixHex(inf, p, 0.5), mixHex(wa, er, 0.5), mixHex(a, s, 0.5)];
  const vars: Record<string, string> = {
    background: bg,
    primaryColor: wash(p),
    primaryBorderColor: mixHex(p, bg, 0.62),
    primaryTextColor: tx,
    secondaryColor: wash(s),
    secondaryBorderColor: mixHex(s, bg, 0.62),
    secondaryTextColor: tx,
    tertiaryColor: wash(a, 0.12),
    tertiaryBorderColor: mixHex(a, bg, 0.55),
    tertiaryTextColor: tx,
    mainBkg: wash(p),
    nodeBorder: mixHex(p, bg, 0.62),
    nodeTextColor: tx,
    textColor: tx,
    titleColor: tx,
    lineColor: line,
    defaultLinkColor: line,
    edgeLabelBackground: bg,
    clusterBkg: mixHex(tx, bg, 0.04),
    clusterBorder: bd,
    noteBkgColor: wash(wa, 0.16),
    noteTextColor: tx,
    noteBorderColor: mixHex(wa, bg, 0.55),
    actorBkg: wash(p),
    actorBorder: mixHex(p, bg, 0.62),
    actorTextColor: tx,
    actorLineColor: ink3,
    signalColor: ink2,
    signalTextColor: tx,
    labelBoxBkgColor: wash(s),
    labelBoxBorderColor: mixHex(s, bg, 0.6),
    labelTextColor: tx,
    loopTextColor: tx,
    activationBkgColor: wash(a, 0.24),
    activationBorderColor: mixHex(a, bg, 0.6),
    sequenceNumberColor: bg,
    sectionBkgColor: wash(p, 0.1),
    altSectionBkgColor: mixHex(tx, bg, 0.03),
    sectionBkgColor2: wash(s, 0.1),
    taskBkgColor: wash(p, 0.45),
    taskBorderColor: mixHex(p, bg, 0.7),
    taskTextColor: tx,
    taskTextLightColor: tx,
    taskTextOutsideColor: tx,
    taskTextDarkColor: tx,
    activeTaskBkgColor: wash(a, 0.4),
    activeTaskBorderColor: a,
    doneTaskBkgColor: mixHex(tx, bg, 0.18),
    doneTaskBorderColor: ink3,
    critBkgColor: wash(er, 0.4),
    critBorderColor: er,
    todayLineColor: er,
    gridColor: mixHex(tx, bg, 0.16),
    excludeBkgColor: mixHex(tx, bg, 0.06),
    errorBkgColor: wash(er, 0.2),
    errorTextColor: er,
    pieTitleTextColor: tx,
    pieSectionTextColor: dark ? bg : tx,
    pieLegendTextColor: tx,
    pieStrokeColor: bg,
    pieOuterStrokeColor: bd,
    pieOpacity: '0.9',
    labelColor: tx,
    attributeBackgroundColorOdd: mixHex(tx, bg, 0.03),
    attributeBackgroundColorEven: mixHex(tx, bg, 0.07),
    relationColor: line,
    relationLabelColor: tx,
    relationLabelBackground: bg,
    stateBkg: wash(p),
    stateLabelColor: tx,
    compositeBackground: mixHex(tx, bg, 0.04),
    altBackground: mixHex(tx, bg, 0.06),
    specialStateColor: ink2,
    innerEndBackground: ink2,
    fontFamily: font,
  };
  series.forEach((c, i) => {
    vars[`pie${i + 1}`] = mixHex(c, bg, dark ? 0.85 : 0.55);
    vars[`cScale${i}`] = mixHex(c, bg, dark ? 0.32 : 0.28);
    vars[`cScaleLabel${i}`] = tx;
    vars[`cScalePeer${i}`] = mixHex(c, bg, 0.6);
    vars[`cScaleInv${i}`] = mixHex(c, bg, 0.7);
    vars[`fillType${i % 8}`] = wash(c, 0.22);
    if (i < 8) vars[`git${i}`] = mixHex(c, bg, 0.8);
    if (i < 8) vars[`gitBranchLabel${i}`] = dark ? bg : '#ffffff';
  });
  const key = JSON.stringify([dark, font, p, s, a, bg, ov, tx, bd, er, wa, inf]);
  return { key, dark, fontFamily: font, vars };
}

// ── cache + rendering ──────────────────────────────────────────────────

export type MermaidResult = { ok: true; svg: string; id: string } | { ok: false; error: string };

type RenderFn = (source: string, theme: MermaidThemeVars) => Promise<RenderedSvg>;
let renderer: Promise<RenderFn> | null = null;
function loadRenderer(): Promise<RenderFn> {
  renderer ??= import('./mermaid-render.ts').then((m) => m.renderMermaid);
  // A failed chunk load (offline, deploy in between) may succeed later.
  renderer.catch(() => {
    renderer = null;
  });
  return renderer;
}

const CACHE_MAX = 48;
const cache = new Map<string, MermaidResult>();
const inflight = new Map<string, Promise<MermaidResult>>();
let renders = 0;

/** Renders actually performed (cache misses) — for tests. */
export function mermaidStats(): { renders: number; cached: number } {
  return { renders, cached: cache.size };
}
/** Forget cached diagrams (tests; memory pressure). */
export function clearMermaidCache(): void {
  cache.clear();
  inflight.clear();
}

function cacheKey(source: string, theme: MermaidThemeVars): string {
  return theme.key + '\u0000' + source;
}
function cacheGet(k: string): MermaidResult | undefined {
  const v = cache.get(k);
  if (v) {
    cache.delete(k);
    cache.set(k, v);
  }
  return v;
}
function cacheSet(k: string, v: MermaidResult): void {
  cache.set(k, v);
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
}

/** Friendly one-paragraph version of a mermaid error. */
export function errorText(e: unknown): string {
  const raw = e instanceof Error ? e.message : typeof e === 'string' ? e : (e as { str?: string })?.str ?? 'Unknown error';
  const lines = String(raw).split('\n').map((l) => l.replace(/\s+$/, '')).filter((l) => l.trim());
  return lines.slice(0, 6).join('\n').slice(0, 600) || 'Unknown error';
}

/** Cached result for (source, theme), if any. Synchronous. */
export function cachedMermaid(source: string, theme = currentMermaidTheme()): MermaidResult | undefined {
  return cacheGet(cacheKey(source, theme));
}

/** Render (or reuse) a diagram. Never rejects. */
export function renderMermaidCached(source: string, theme = currentMermaidTheme()): Promise<MermaidResult> {
  const k = cacheKey(source, theme);
  const hit = cacheGet(k);
  if (hit) return Promise.resolve(hit);
  const pending = inflight.get(k);
  if (pending) return pending;
  const p = (async (): Promise<MermaidResult> => {
    if (!source.trim()) return { ok: false, error: 'This diagram is empty.' };
    if (source.length > MAX_SOURCE) return { ok: false, error: `This diagram is too large to draw (over ${MAX_SOURCE.toLocaleString('en')} characters).` };
    let render: RenderFn;
    try {
      render = await loadRenderer();
    } catch {
      // Not cached: the next attempt retries the chunk.
      return { ok: false, error: 'The diagram renderer could not be loaded (offline?).' };
    }
    renders++;
    let res: MermaidResult;
    try {
      const out = await render(source, theme);
      const svg = sanitizeMermaidSvg(out.svg, out.id);
      res = svg ? { ok: true, svg, id: out.id } : { ok: false, error: 'The diagram produced no drawable output.' };
    } catch (e) {
      res = { ok: false, error: errorText(e) };
    }
    cacheSet(k, res);
    return res;
  })().finally(() => inflight.delete(k));
  inflight.set(k, p);
  return p;
}

let uid = 0;
/** The cached SVG with a fresh id, so two copies (a hover card and
 *  the reader, the lightbox) never share marker / style ids. */
export function svgInstance(r: { svg: string; id: string }): string {
  return r.svg.split(r.id).join(`lumimmd${++uid}i`);
}

// ── block DOM ──────────────────────────────────────────────────────────

const results = new WeakMap<HTMLElement, MermaidResult>();
const timers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();

/** Source text of a `.md-mermaid` block. */
export function mermaidSource(block: HTMLElement): string {
  return block.querySelector('.md-mermaid-src > code')?.textContent ?? '';
}

/** A fresh `.md-mermaid` block for `source` (Live Preview widget). */
export function createMermaidBlock(source: string): HTMLElement {
  const block = document.createElement('div');
  block.className = 'md-mermaid';
  block.dataset.lang = 'mermaid';
  block.dataset.kind = mermaidInfo(source).kind;
  const pre = document.createElement('pre');
  pre.className = 'md-mermaid-src';
  const code = document.createElement('code');
  code.className = 'language-mermaid';
  code.textContent = source;
  pre.append(code);
  block.append(pre);
  return block;
}

/** Replace a block's source (Live Preview: remote edits). */
export function setMermaidSource(block: HTMLElement, source: string): void {
  const code = block.querySelector('.md-mermaid-src > code');
  if (code && code.textContent !== source) code.textContent = source;
  block.dataset.kind = mermaidInfo(source).kind;
}

function button(action: string, text: string, label: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'md-copy md-mermaid-act';
  b.dataset.mmd = action;
  b.textContent = text;
  b.setAttribute('aria-label', label);
  b.setAttribute('data-hint-target', '');
  return b;
}

function ensureChrome(block: HTMLElement): void {
  if (block.querySelector(':scope > .md-mermaid-head')) return;
  const head = document.createElement('div');
  head.className = 'md-code-head md-mermaid-head';
  const lang = document.createElement('span');
  lang.className = 'md-code-lang';
  lang.textContent = `◇ mermaid · ${block.dataset.kind || 'diagram'}`;
  const tools = document.createElement('span');
  tools.className = 'md-code-tools';
  const src = button('source', 'Source', 'Show diagram source');
  src.setAttribute('aria-pressed', 'false');
  tools.append(src, button('copy-svg', 'Copy SVG', 'Copy diagram as SVG'), button('copy-source', 'Copy source', 'Copy diagram source'), button('expand', 'Expand', 'Open diagram full screen'));
  head.append(lang, tools);
  const fig = document.createElement('div');
  fig.className = 'md-mermaid-fig';
  fig.setAttribute('role', 'img');
  fig.tabIndex = 0;
  block.prepend(head, fig);
  block.addEventListener('click', onBlockClick);
  block.addEventListener('keydown', onBlockKey);
}

function onBlockKey(e: KeyboardEvent): void {
  const t = e.target as HTMLElement;
  if ((e.key === 'Enter' || e.key === ' ') && t.classList.contains('md-mermaid-fig')) {
    e.preventDefault();
    e.stopPropagation();
    expand(t.closest('.md-mermaid') as HTMLElement, t);
  }
}

function flash(b: HTMLButtonElement, text: string): void {
  const prev = b.textContent;
  b.textContent = text;
  b.classList.add('done');
  setTimeout(() => {
    b.textContent = prev;
    b.classList.remove('done');
  }, 1200);
}

export function copyText(text: string, b?: HTMLButtonElement): void {
  void navigator.clipboard?.writeText(text).then(
    () => b && flash(b, 'Copied'),
    () => b && flash(b, 'Failed'),
  );
}

/** Standalone SVG file text for "Copy SVG". */
export function standaloneSvg(r: { svg: string }): string {
  return r.svg.replace(/ aria-hidden="true"/, '').replace(/ focusable="false"/, '');
}

function expand(block: HTMLElement, from: HTMLElement): void {
  const r = results.get(block);
  if (!r || !r.ok) return;
  openMermaidLightbox({
    svg: svgInstance(r),
    label: mermaidLabel(mermaidSource(block)),
    copySvg: () => standaloneSvg(r),
    copySource: () => mermaidSource(block),
    returnFocus: from,
  });
}

function onBlockClick(e: MouseEvent): void {
  const t = e.target as HTMLElement;
  const block = t.closest('.md-mermaid') as HTMLElement | null;
  if (!block) return;
  const b = t.closest<HTMLButtonElement>('button[data-mmd]');
  if (b) {
    e.preventDefault();
    e.stopPropagation();
    const r = results.get(block);
    switch (b.dataset.mmd) {
      case 'copy-source':
        copyText(mermaidSource(block), b);
        break;
      case 'copy-svg':
        if (r?.ok) copyText(standaloneSvg(r), b);
        break;
      case 'source': {
        const on = !block.classList.contains('show-src');
        block.classList.toggle('show-src', on);
        b.setAttribute('aria-pressed', String(on));
        break;
      }
      case 'expand':
        expand(block, b);
        break;
    }
    return;
  }
  // In an editor widget a click on the drawing edits the source (the
  // widget handles it); in the reader it opens the lightbox.
  if (t.closest('.md-mermaid-fig') && block.dataset.surface !== 'editor') {
    e.preventDefault();
    expand(block, t.closest('.md-mermaid-fig') as HTMLElement);
  }
}

function apply(block: HTMLElement, r: MermaidResult, key: string): void {
  results.set(block, r);
  block.dataset.rendered = key;
  const fig = block.querySelector<HTMLElement>(':scope > .md-mermaid-fig');
  const src = mermaidSource(block);
  block.querySelector(':scope > .md-mermaid-error')?.remove();
  if (r.ok) {
    block.dataset.state = 'done';
    if (fig) {
      fig.innerHTML = svgInstance(r); // sanitised by sanitizeMermaidSvg
      fig.setAttribute('aria-label', mermaidLabel(src));
      if (block.dataset.surface !== 'editor') fig.title = 'Click to expand';
    }
    return;
  }
  block.dataset.state = 'error';
  if (fig) {
    fig.replaceChildren();
    fig.removeAttribute('aria-label');
  }
  const card = document.createElement('div');
  card.className = 'md-mermaid-error';
  card.setAttribute('role', 'note');
  const title = document.createElement('p');
  title.className = 'md-mermaid-error-title';
  title.textContent = "Couldn't draw this diagram";
  const msg = document.createElement('pre');
  msg.className = 'md-mermaid-error-msg';
  msg.textContent = r.error;
  const hint = document.createElement('p');
  hint.className = 'md-mermaid-error-hint';
  hint.textContent = 'The source is shown below. See mermaid.js.org for the syntax.';
  card.append(title, msg, hint);
  block.querySelector(':scope > .md-mermaid-head')?.after(card);
}

export interface PaintOptions {
  /** Wait this long before a (non-cached) render; restarts on repaint. */
  debounce?: number;
}

/**
 * Draw one `.md-mermaid` block for the current theme. Idempotent: a
 * block already showing this (source, theme) is left alone; a cache
 * hit paints synchronously; otherwise the previous drawing stays until
 * the new one is ready.
 */
export function paintMermaid(block: HTMLElement, opts: PaintOptions = {}): void {
  ensureChrome(block);
  installThemeWatch();
  const source = mermaidSource(block);
  const theme = currentMermaidTheme();
  const key = cacheKey(source, theme);
  if (block.dataset.rendered === key) return;
  const hit = cacheGet(key);
  const t = timers.get(block);
  if (t) clearTimeout(t);
  if (hit) {
    apply(block, hit, key);
    return;
  }
  if (!block.dataset.state) block.dataset.state = 'pending';
  block.setAttribute('aria-busy', 'true');
  const go = () => {
    timers.delete(block);
    void renderMermaidCached(source, theme).then((r) => {
      // The block may have been edited, re-themed or dropped meanwhile.
      if (mermaidSource(block) !== source || currentMermaidTheme().key !== theme.key) return;
      block.removeAttribute('aria-busy');
      apply(block, r, key);
    });
  };
  if (opts.debounce && opts.debounce > 0) timers.set(block, setTimeout(go, opts.debounce));
  else go();
}

/** Paint every mermaid block under `root` (rendered-enhance pass). */
export function enhanceMermaid(root: ParentNode, opts: PaintOptions = {}): void {
  root.querySelectorAll<HTMLElement>('.md-mermaid').forEach((b) => paintMermaid(b, opts));
}

// ── theme changes ──────────────────────────────────────────────────────

let watching = false;
let lastThemeKey = '';
function installThemeWatch(): void {
  if (watching || typeof MutationObserver === 'undefined' || typeof document === 'undefined') return;
  watching = true;
  lastThemeKey = currentMermaidTheme().key;
  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      const k = currentMermaidTheme().key;
      if (k === lastThemeKey) return;
      lastThemeKey = k;
      document.querySelectorAll<HTMLElement>('.md-mermaid[data-state]').forEach((b) => paintMermaid(b));
    });
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'data-theme', 'class'] });
}
