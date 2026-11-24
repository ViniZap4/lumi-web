<script lang="ts">
  // Hover link preview card (SPEC-PARTE2 §4). Note links show the first
  // ~40 lines rendered through the shared sanitizer (marked +
  // DOMPurify, lib/markdown.ts), with title, folder and updated time;
  // external links show a URL card and are never fetched.
  //
  // Opened by `K` the card takes focus: j/k scroll, d/u half a page,
  // Enter opens, Ctrl-w f (or v) opens in a vertical split, Ctrl-w F (or
  // s) in a horizontal one, Esc / q close.
  import { onMount, tick } from 'svelte';
  import { loadNote, peekNote } from '../lib/note-content.ts';
  import { previewExcerpt, updatedLabel, type HoverTarget } from '../lib/hover-preview.ts';
  import { renderBlocks } from '../lib/markdown.ts';
  import { dirOf } from '../lib/notetree.ts';
  import { urlCard, type OpenWhere } from '../lib/link-open.ts';
  import { PaneKeys } from '../lib/pane-nav.ts';
  import { editorSettings } from '../lib/editor-settings.svelte.ts';
  import { keyLabel } from '../lib/platform.ts';
  import MarkdownView from './MarkdownView.svelte';
  import CanvasMini from './CanvasMini.svelte';
  import KanbanMini from './KanbanMini.svelte';
  import NoteIcon from './NoteIcon.svelte';
  import { previewKindFor } from '../lib/preview/structured-preview.ts';
  import type { NoteContent } from '../lib/types.ts';

  interface Props {
    target: HoverTarget;
    vaultID: string;
    anchor: { left: number; top: number; bottom: number };
    /** Opened from the keyboard (`K`): focus the card. */
    keyboard?: boolean;
    onopen: (where: OpenWhere) => void;
    onclose: () => void;
    /** Pointer over the card (keeps it open) / left it. */
    onhold?: () => void;
    onleave?: () => void;
  }
  const { target, vaultID, anchor, keyboard = false, onopen, onclose, onhold, onleave }: Props = $props();

  const W = 400;
  const H = 360;
  let card = $state<HTMLElement | null>(null);
  let scroller = $state<HTMLElement | null>(null);
  let body = $state<string | null>(null);
  /** Full content (canvas / board previews draw it, not the excerpt). */
  let content = $state<NoteContent | null>(null);
  let truncated = $state(false);
  let error = $state<string | null>(null);
  const keys = new PaneKeys();

  const note = $derived(target.kind === 'note' ? target.note : null);
  const ext = $derived(target.kind === 'external' ? urlCard(target.url) : null);
  const kind = $derived(note ? previewKindFor(note, content) : 'markdown');
  const blocks = $derived(body != null && kind === 'markdown' ? renderBlocks(body) : []);
  const folder = $derived(note ? dirOf(note.path || '') : '');
  const updated = $derived(note ? updatedLabel(note.updated_at) : '');

  // Position: below the link when it fits, else above; clamped.
  const pos = $derived.by(() => {
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1024;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 768;
    const w = Math.min(W, vw - 24);
    const left = Math.max(12, Math.min(anchor.left - 16, vw - w - 12));
    const below = vh - anchor.bottom;
    const h = target.kind === 'note' ? Math.min(H, Math.max(160, Math.max(below, anchor.top) - 20)) : 120;
    const top = below >= h + 12 || below >= anchor.top ? anchor.bottom + 8 : Math.max(12, anchor.top - h - 8);
    // Grow out of the link (shared-element entrance): the transform
    // origin sits where the link is, on the card's near edge.
    const ox = Math.max(8, Math.min(w - 8, anchor.left - left + 12));
    return { left, top, w, h, above: top < anchor.top, ox };
  });

  $effect(() => {
    const n = note;
    if (!n) return;
    const hit = peekNote(vaultID, n.id);
    if (hit) setBody(hit.content);
    let live = true;
    loadNote(vaultID, n.id).then(
      (r) => { if (live) setBody(r.content); },
      (e) => { if (live && body == null) error = (e as Error).message; },
    );
    return () => { live = false; };
  });

  function setBody(c: NoteContent): void {
    content = c;
    const ex = previewExcerpt(c.body ?? '');
    body = ex.text;
    truncated = ex.truncated;
  }

  onMount(() => {
    if (keyboard) void tick().then(() => card?.focus({ preventScroll: true }));
  });

  function onKey(e: KeyboardEvent): void {
    const pk = keys.feed(e, { ctrlHjkl: false });
    if (pk) {
      e.preventDefault();
      e.stopPropagation();
      if (pk.kind === 'win') {
        if (pk.cmd === 'linkV' || pk.cmd === 'vsplit') onopen('vsplit');
        else if (pk.cmd === 'linkH' || pk.cmd === 'split') onopen('hsplit');
        else if (pk.cmd === 'close') onclose();
      }
      return;
    }
    const sc = scroller;
    const half = (sc?.clientHeight ?? 300) / 2;
    let handled = true;
    switch (e.key) {
      case 'j': case 'ArrowDown': if (sc) sc.scrollTop += 48; break;
      case 'k': case 'ArrowUp': if (sc) sc.scrollTop -= 48; break;
      case 'd': case 'PageDown': case ' ': if (sc) sc.scrollTop += half; break;
      case 'u': case 'PageUp': if (sc) sc.scrollTop -= half; break;
      case 'g': if (sc) sc.scrollTop = 0; break;
      case 'G': if (sc) sc.scrollTop = sc.scrollHeight; break;
      case 'Enter': case 'o': onopen('current'); break;
      case 'v': onopen('vsplit'); break;
      case 's': onopen('hsplit'); break;
      case 'Escape': case 'q': case 'K': onclose(); break;
      case 'Tab': handled = false; break;
      default: handled = e.key.length === 1;
    }
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="hover-card"
  class:above={pos.above}
  class:ext={target.kind !== 'note'}
  role="dialog"
  aria-label={note ? `Preview of ${note.title}` : 'Link'}
  tabindex="-1"
  style="left: {pos.left}px; top: {pos.top}px; width: {pos.w}px; --ox: {pos.ox}px; {target.kind === 'note' ? `max-height: ${pos.h}px` : ''}"
  data-vt-target="hover-card"
  bind:this={card}
  onkeydown={onKey}
  onpointerenter={onhold}
  onpointerleave={onleave}
  data-testid="hover-card"
>
  {#if note}
    <header class="hc-head">
      <div class="hc-title-row">
        <span class="hc-icon"><NoteIcon {kind} size={13} /></span>
        <span class="hc-title">{note.title}</span>
      </div>
      <div class="hc-meta">
        <span class="hc-folder">{folder ? folder + '/' : '/'}</span>
        {#if updated}<span class="hc-dot" aria-hidden="true">·</span><span>updated {updated}</span>{/if}
      </div>
    </header>
    <div class="hc-scroll" bind:this={scroller}>
      {#if kind === 'canvas' && content}
        <CanvasMini text={content.body ?? ''} onopen={() => onopen('current')} />
      {:else if kind === 'kanban' && content}
        <KanbanMini text={content.body ?? ''} onopen={() => onopen('current')} />
      {:else if body != null}
        <div class="lumi-prose compact" data-prose={editorSettings.value.proseFont}>
          <MarkdownView {blocks} />
        </div>
        {#if truncated}<div class="hc-more">…</div>{/if}
      {:else if error}
        <div class="hc-state err">{error}</div>
      {:else}
        <div class="hc-state"><span class="hc-skel skeleton"></span><span class="hc-skel skeleton short"></span><span class="hc-skel skeleton"></span></div>
      {/if}
    </div>
    <footer class="hc-actions">
      <button class="ui-btn sm" type="button" onclick={() => onopen('current')}>Open <kbd>⏎</kbd></button>
      <button class="ui-btn sm ghost" type="button" onclick={() => onopen('vsplit')} title="Open in a vertical split ({keyLabel('⌘')}-click, ⌃w f)">Split <kbd>⌃w f</kbd></button>
      <span class="hc-spacer"></span>
      <button class="ui-btn ghost sm icon" type="button" onclick={onclose} aria-label="Close preview" title="Close (Esc)">
        <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
      </button>
    </footer>
  {:else if target.kind === 'missing'}
    <div class="hc-url">
      <span class="hc-url-host">No note here yet</span>
      <span class="hc-url-path mono">{target.path}</span>
    </div>
  {:else}
    <div class="hc-url">
      <span class="hc-url-host">
        {#if ext?.secure}<svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><rect x="3.5" y="7" width="9" height="6.5" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M5.5 7V5.25a2.5 2.5 0 0 1 5 0V7" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>{/if}
        {ext ? ext.host : 'Link'}
      </span>
      {#if ext?.path}<span class="hc-url-path mono">{ext.path}</span>{/if}
      <span class="hc-url-note">External link · opens in a new tab</span>
    </div>
  {/if}
</div>

<style>
  .hover-card {
    position: fixed;
    z-index: 260;
    display: flex;
    flex-direction: column;
    background: var(--color-background);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-pop);
    overflow: hidden;
    outline: none;
    transform-origin: var(--ox, 0) top;
    animation: hc-in var(--spring-bouncy-ms, 220ms) var(--spring-bouncy, var(--ease)) both;
  }
  .hover-card.above { transform-origin: var(--ox, 0) bottom; }
  .hover-card:focus-visible { box-shadow: var(--shadow-pop), 0 0 0 2px var(--ring); }
  @keyframes hc-in { from { opacity: 0; transform: scale(0.92); } 35% { opacity: 1; } }
  .hc-head {
    flex: none;
    padding: 10px 14px 8px;
    border-bottom: 1px solid color-mix(in srgb, var(--hairline) 60%, transparent);
    background: color-mix(in srgb, var(--color-overlay-bg) 40%, var(--color-background));
  }
  .hc-title-row { display: flex; align-items: center; gap: 7px; min-width: 0; }
  .hc-icon { flex: none; color: var(--color-primary); }
  .hc-title { font-weight: 650; font-size: var(--text-md); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; letter-spacing: -0.005em; }
  .hc-meta { display: flex; gap: 5px; margin-top: 2px; font-size: var(--text-2xs); color: var(--color-text-dim); font-variant-numeric: tabular-nums; }
  .hc-folder { font-family: var(--font-mono); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .hc-scroll { flex: 1; min-height: 0; overflow-y: auto; padding: 12px 16px 6px; overscroll-behavior: contain; }
  .hc-more { color: var(--color-text-dim); text-align: center; padding-bottom: 6px; letter-spacing: 0.2em; }
  .hc-actions {
    flex: none;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 6px 8px;
    border-top: 1px solid color-mix(in srgb, var(--hairline) 60%, transparent);
  }
  .hc-actions kbd { height: 15px; min-width: 15px; font-size: 10px; }
  .hc-spacer { flex: 1; }
  .hc-state { display: flex; flex-direction: column; gap: 8px; padding: 4px 0 10px; color: var(--color-text-dim); font-size: var(--text-sm); }
  .hc-state.err { color: var(--color-error); }
  .hc-skel { height: 10px; border-radius: 5px; }
  .hc-skel.short { width: 60%; }
  .hc-url { display: flex; flex-direction: column; gap: 3px; padding: 12px 14px; min-width: 0; }
  .hc-url-host { display: inline-flex; align-items: center; gap: 6px; font-weight: 600; font-size: var(--text-sm); }
  .hc-url-path { font-size: var(--text-xs); color: var(--color-text-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .hc-url-note { font-size: var(--text-2xs); color: var(--color-text-dim); margin-top: 3px; }
  .mono { font-family: var(--font-mono); }
</style>
