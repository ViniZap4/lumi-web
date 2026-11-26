// Hover link preview (SPEC-PARTE2 §4): a card after 350 ms over a link
// in any rendered note (delegated from the shell's root), or at once
// with `K`.

import { notes } from '../../lib/notes.svelte.ts';
import { editorSettings } from '../../lib/editor-settings.svelte.ts';
import { classifyLink, type OpenWhere, type LinkAt } from '../../lib/link-open.ts';
import { HoverIntent, type HoverTarget } from '../../lib/hover-preview.ts';
import type { Workspace } from './workspace.svelte.ts';

export type HoverState = {
  target: HoverTarget;
  anchor: { left: number; top: number; bottom: number };
  keyboard: boolean;
  leaf: string;
  returnTo: HTMLElement | null;
};

type HoverReq = { href: string; fromPath: string; leaf: string; el: HTMLElement; wiki: boolean };

/** The hover card's target for a link, or null for anchors / unsafe. */
export function hoverTargetFor(list: typeof notes.list, href: string, fromPath: string, wiki: boolean): HoverTarget | null {
  const t = classifyLink(list, fromPath, href, wiki);
  if (t.kind === 'note') return { kind: 'note', note: t.note };
  if (t.kind === 'external') return { kind: 'external', url: t.url };
  if (t.kind === 'missing') return { kind: 'missing', path: t.path };
  return null;
}

/** The rendered link under a pointer event, if it can preview. */
export function hoverLinkEl(t: EventTarget | null): HTMLElement | null {
  const el = t instanceof Element ? t.closest<HTMLElement>('a[href], [data-lp-note], [data-lp-href]') : null;
  if (!el || !el.closest('.md-body, .cm-editor') || el.closest('.hover-card, .fx')) return null;
  return el;
}

export class HoverController {
  current = $state<HoverState | null>(null);
  /** The link the pointer is over (gf / K fall back to it). */
  lastEl: Element | null = null;
  private quietUntil = 0;
  readonly intent = new HoverIntent<HoverReq>((r) => this.show(r, false), () => (this.current = null));

  constructor(private readonly ws: Workspace) {}

  /** No card for `ms` (the layout moves under a still pointer). */
  quiet(ms: number): void {
    this.quietUntil = Date.now() + ms;
  }

  private show(r: HoverReq, keyboard: boolean): void {
    const target = hoverTargetFor(notes.list, r.href, r.fromPath, r.wiki);
    if (!target || !r.el.isConnected) {
      this.intent.hide();
      return;
    }
    const b = r.el.getBoundingClientRect();
    this.current = { target, anchor: { left: b.left, top: b.top, bottom: b.bottom }, keyboard, leaf: r.leaf, returnTo: keyboard ? (document.activeElement as HTMLElement | null) : null };
  }

  /** `K`: the card for a link, without the hover delay. */
  key = (l: LinkAt | null, rect: { left: number; top: number; bottom: number } | null, fromPath: string, leaf = this.ws.panes.activeLeafId): void => {
    if (!l) return this.ws.flash('no link under the cursor', 'warn');
    const target = hoverTargetFor(notes.list, l.href, fromPath, l.wiki);
    if (!target) return;
    const el = rect ? null : linkElFor(this.ws.activeReaderRoot(), l.href);
    const b = rect ?? el?.getBoundingClientRect() ?? { left: 80, top: 80, bottom: 96 };
    this.intent.showNow({ href: l.href, fromPath, leaf, el: el ?? this.ws.rootEl!, wiki: l.wiki }, 'k:' + l.href);
    this.current = { target, anchor: { left: b.left, top: b.top, bottom: b.bottom }, keyboard: true, leaf, returnTo: document.activeElement as HTMLElement | null };
  };

  close = (): void => {
    const ret = this.current?.returnTo;
    this.intent.hide();
    this.current = null;
    ret?.focus?.({ preventScroll: true });
  };

  openFrom = (where: OpenWhere): void => {
    const h = this.current;
    if (!h) return;
    this.close();
    if (h.target.kind === 'note') this.ws.openIn(h.target.note.id, where, h.leaf);
    else if (h.target.kind === 'external') window.open(h.target.url, '_blank', 'noopener,noreferrer');
  };

  /** The card was left by the pointer (a keyboard card stays). */
  leave = (): void => {
    if (!this.current?.keyboard) this.intent.leave();
  };

  onOver = (e: PointerEvent): void => {
    if (e.pointerType === 'touch' || !editorSettings.value.hoverPreview || Date.now() < this.quietUntil) return;
    const el = hoverLinkEl(e.target);
    if (!el) return;
    const href = el.getAttribute('data-lp-note') ?? el.getAttribute('href') ?? el.getAttribute('data-lp-href') ?? '';
    if (!href || href.startsWith('#')) return;
    this.lastEl = el;
    const host = el.closest<HTMLElement>('[data-leaf]');
    const leaf = host?.dataset.leaf ?? this.ws.panes.primaryLeaf;
    const fromPath = el.closest<HTMLElement>('[data-note-path]')?.dataset.notePath ?? this.ws.leafPath(leaf);
    this.intent.enter({ href, fromPath, leaf, el, wiki: false }, `${leaf}|${fromPath}|${href}`);
  };

  onOut = (e: PointerEvent): void => {
    const el = hoverLinkEl(e.target);
    if (!el) return;
    if (e.relatedTarget instanceof Node && el.contains(e.relatedTarget)) return;
    if (this.lastEl === el) this.lastEl = null;
    this.leave();
  };
}

function linkElFor(root: HTMLElement | null, href: string): HTMLElement | null {
  if (!root) return null;
  return Array.from(root.querySelectorAll<HTMLElement>('a[href]')).find((x) => x.getAttribute('href') === href) ?? null;
}
