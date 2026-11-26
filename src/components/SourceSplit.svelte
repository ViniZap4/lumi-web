<script lang="ts">
  // Source mode + rendered preview side by side.
  //
  // - The preview re-renders ~120 ms after typing stops (debounced Y.Text
  //   observer); only changed blocks are re-parsed (lib/markdown.ts).
  // - Scroll sync maps editor lines ↔ preview offsets through the
  //   blocks' `data-line` anchors (lib/scroll-sync.ts). Only the pane
  //   the user last touched drives, so the two never ping-pong.
  // - The divider resizes by drag or keyboard (←/→, h/l, Home/End,
  //   Enter resets) and is a proper ARIA separator.
  // - Narrow windows collapse to Source | Preview tabs.
  // - Focused, the preview is a keyboard reader (lib/preview-keys.ts):
  //   the view feeds keys, `run` scrolls / jumps / finds here.
  import { onMount, untrack, type Snippet } from 'svelte';
  import type { EditorView } from '@codemirror/view';
  import type * as Y from 'yjs';
  import MarkdownView from './MarkdownView.svelte';
  import { renderBlocks, createDocRenderCache } from '../lib/markdown.ts';
  import { normalizeAnchors, measureAnchors, lineToOffset, offsetToLine, ScrollLeader, debounce, PREVIEW_DEBOUNCE_MS, type Anchor } from '../lib/scroll-sync.ts';
  import { PREVIEW_RATIO_MIN, PREVIEW_RATIO_MAX, clampRatio } from '../lib/editor-settings.ts';
  import { headingTarget, findRanges, nextMatchIndex, type PreviewAction } from '../lib/preview-keys.ts';
  import { motionAllowed } from '../lib/motion.ts';
  import { clearFindHighlights, paintFindHighlights } from '../lib/find-highlight.ts';

  interface Props {
    /** Preview showing. Off → the editor alone, full width (the editor
     *  stays mounted either way, so toggling keeps cursor + history). */
    enabled: boolean;
    ytext: Y.Text;
    editorView: () => EditorView | null;
    ratio: number;
    /** Prose typeface (matches the reader). */
    prose?: 'sans' | 'serif' | 'mono';
    onratio: (r: number) => void;
    ontoggletask?: (index: number) => void;
    onlink?: (href: string, e: MouseEvent) => void;
    /** Which side has keyboard focus (subtle indicator). */
    focused?: 'editor' | 'split' | null;
    /** Tabs layout (narrow) changed. */
    onnarrow?: (narrow: boolean) => void;
    children: Snippet;
  }
  const { enabled, ytext, editorView, ratio, prose = 'sans', onratio, ontoggletask, onlink, focused = null, onnarrow, children }: Props = $props();

  let text = $state(untrack(() => (enabled ? ytext.toString() : '')));
  // Per-document cache: a one-block edit re-lexes and re-renders that
  // block only (lib/markdown.ts DocRenderCache).
  const docCache = createDocRenderCache();
  const blocks = $derived(enabled ? renderBlocks(text, { cache: docCache }) : []);
  // Fresh text the moment the preview is switched on.
  $effect(() => {
    if (enabled) untrack(() => (text = ytext.toString()));
  });

  let root = $state<HTMLElement | null>(null);
  let scroller = $state<HTMLElement | null>(null);
  let body = $state<HTMLElement | null>(null);
  let srcPane = $state<HTMLElement | null>(null);
  let live = $state(untrack(() => ratio));
  let dragging = $state(false);
  let narrow = $state(false);
  let tab = $state<'source' | 'preview'>('source');
  $effect(() => onnarrow?.(narrow));

  // ---- find (/ n N) --------------------------------------------------------
  let findOpen = $state(false);
  let findQuery = $state('');
  let findInput = $state<HTMLInputElement | null>(null);
  let findInfo = $state('');
  let ranges: Range[] = [];
  let matchIdx = -1;

  const leader = new ScrollLeader();
  let anchors: Anchor[] = [];
  let frame = 0;

  $effect(() => {
    if (!dragging) live = ratio;
  });

  onMount(() => {
    const update = debounce(() => (text = ytext.toString()), PREVIEW_DEBOUNCE_MS);
    const obs = () => {
      if (enabled) update();
    };
    ytext.observe(obs);

    let mq: MediaQueryList | null = null;
    const onmq = () => (narrow = !!mq?.matches);
    try {
      mq = window.matchMedia('(max-width: 860px)');
      onmq();
      mq.addEventListener?.('change', onmq);
    } catch {
      /* jsdom */
    }

    // Editor scroll → preview (wired once the view exists).
    let sd: HTMLElement | null = null;
    const onEditorScroll = () => {
      if (leader.accepts('source')) schedule('source');
    };
    const wire = () => {
      const v = editorView();
      if (!v || sd === v.scrollDOM) return;
      sd?.removeEventListener('scroll', onEditorScroll);
      sd = v.scrollDOM;
      sd.addEventListener('scroll', onEditorScroll, { passive: true });
    };
    wire();
    const wireTimer = setInterval(wire, 500);

    return () => {
      ytext.unobserve(obs);
      update.cancel();
      mq?.removeEventListener?.('change', onmq);
      sd?.removeEventListener('scroll', onEditorScroll);
      clearInterval(wireTimer);
      cancelAnimationFrame(frame);
    };
  });

  // Images loading / width changes move the anchors.
  $effect(() => {
    const el = body;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => remeasure());
    ro.observe(el);
    return () => ro.disconnect();
  });

  function remeasure(): void {
    if (!body || !scroller) return;
    const v = editorView();
    anchors = normalizeAnchors(measureAnchors(body, scroller), v ? v.state.doc.lines : 0, scroller.scrollHeight);
    // Keep the preview aligned with the editor after a re-render.
    if (leader.current === 'source') schedule('source');
  }

  function schedule(from: 'source' | 'preview'): void {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => (from === 'source' ? syncFromEditor() : syncFromPreview()));
  }

  /** Document-top offset inside the editor scroller. */
  function docOffset(v: EditorView): number {
    const sd = v.scrollDOM;
    return v.documentTop - sd.getBoundingClientRect().top + sd.scrollTop;
  }

  function syncFromEditor(): void {
    const v = editorView();
    const sc = scroller;
    if (!v || !sc || narrow || !enabled) return;
    const sd = v.scrollDOM;
    let top: number;
    if (sd.scrollTop <= 1) top = 0;
    else if (sd.scrollTop + sd.clientHeight >= sd.scrollHeight - 2) top = sc.scrollHeight;
    else {
      const y = sd.scrollTop - docOffset(v);
      const blk = v.lineBlockAtHeight(Math.max(0, y));
      const ln = v.state.doc.lineAt(blk.from).number - 1;
      const frac = blk.height > 0 ? Math.min(1, Math.max(0, (y - blk.top) / blk.height)) : 0;
      top = lineToOffset(anchors, ln + frac);
    }
    if (Math.abs(sc.scrollTop - top) > 1) sc.scrollTop = top;
  }

  function syncFromPreview(): void {
    const v = editorView();
    const sc = scroller;
    if (!v || !sc || narrow || !enabled) return;
    const sd = v.scrollDOM;
    let target: number;
    if (sc.scrollTop <= 1) target = 0;
    else if (sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 2) target = sd.scrollHeight;
    else {
      const line = offsetToLine(anchors, sc.scrollTop);
      const n = Math.min(v.state.doc.lines, Math.max(1, Math.floor(line) + 1));
      const blk = v.lineBlockAt(v.state.doc.line(n).from);
      target = docOffset(v) + blk.top + (line - Math.floor(line)) * blk.height;
    }
    if (Math.abs(sd.scrollTop - target) > 1) sd.scrollTop = target;
  }

  function onPreviewScroll(): void {
    if (leader.accepts('preview')) schedule('preview');
  }

  // ---- divider -----------------------------------------------------------------

  function ratioAt(clientX: number): number {
    const r = root?.getBoundingClientRect();
    if (!r || r.width === 0) return live;
    return clampRatio((clientX - r.left) / r.width, live);
  }
  function onDividerDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    e.preventDefault();
    dragging = true;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  }
  function onDividerMove(e: PointerEvent): void {
    if (dragging) live = ratioAt(e.clientX);
  }
  function onDividerUp(): void {
    if (!dragging) return;
    dragging = false;
    onratio(live);
    requestAnimationFrame(remeasure);
  }
  function onDividerKey(e: KeyboardEvent): void {
    const step = e.shiftKey ? 0.1 : 0.02;
    let next: number | null = null;
    if (e.key === 'ArrowLeft' || e.key === 'h') next = live - step;
    else if (e.key === 'ArrowRight' || e.key === 'l') next = live + step;
    else if (e.key === 'Home') next = PREVIEW_RATIO_MIN;
    else if (e.key === 'End') next = PREVIEW_RATIO_MAX;
    else if (e.key === 'Enter' || e.key === '=') next = 0.5;
    if (next == null) return;
    e.preventDefault();
    e.stopPropagation();
    live = clampRatio(next, live);
    onratio(live);
    requestAnimationFrame(remeasure);
  }

  function onTabKey(e: KeyboardEvent): void {
    if (['ArrowLeft', 'ArrowRight', 'h', 'l'].includes(e.key)) {
      e.preventDefault();
      tab = tab === 'source' ? 'preview' : 'source';
      root?.querySelector<HTMLElement>(`[role="tab"][data-tab="${tab}"]`)?.focus();
    }
  }

  /** Toggle between panes on narrow screens (and focus the editor). */
  export function showTab(t: 'source' | 'preview'): void {
    tab = t;
  }

  // ---- keyboard reader (split preview focused) --------------------------------

  /** Focus the preview pane (switching to its tab when narrow). */
  export async function focusPreview(): Promise<boolean> {
    if (!enabled) return false;
    if (narrow) tab = 'preview';
    await Promise.resolve();
    if (!scroller) return false;
    scroller.focus({ preventScroll: true });
    if (narrow) requestAnimationFrame(remeasure);
    return true;
  }

  /** Show the source side (narrow tabs) before the editor is focused. */
  export function revealSource(): void {
    if (narrow) tab = 'source';
  }

  /** The preview scroller (hint mode root). */
  export function previewElement(): HTMLElement | null {
    return scroller;
  }

  /** 1-based source line shown at the top of the preview. */
  export function topLine(): number | null {
    if (!scroller || !enabled) return null;
    if (!anchors.length) remeasure();
    const line = offsetToLine(anchors, scroller.scrollTop + 8);
    return Math.max(1, Math.floor(line) + 1);
  }

  function smoothTo(top: number): void {
    const sc = scroller;
    if (!sc) return;
    leader.claim('preview');
    const t = Math.max(0, Math.min(top, sc.scrollHeight - sc.clientHeight));
    if (typeof sc.scrollTo === 'function') sc.scrollTo({ top: t, behavior: motionAllowed() ? 'smooth' : 'auto' });
    else sc.scrollTop = t;
  }

  function headingTops(): number[] {
    if (!body || !scroller) return [];
    const base = scroller.getBoundingClientRect().top - scroller.scrollTop;
    return Array.from(body.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6')).map((h) => Math.round(h.getBoundingClientRect().top - base - 12));
  }

  /** Run a reader action. Returns false when it does not apply here. */
  export function run(a: PreviewAction): boolean {
    const sc = scroller;
    if (!sc || !enabled) return false;
    const h = sc.clientHeight || 600;
    switch (a.kind) {
      case 'scroll': {
        const step = a.unit === 'line' ? 56 : a.unit === 'half' ? h / 2 : h * 0.9;
        if (a.unit === 'line') {
          leader.claim('preview');
          sc.scrollTop += step * a.n;
        } else smoothTo(sc.scrollTop + step * a.n);
        return true;
      }
      case 'top': smoothTo(0); return true;
      case 'bottom': smoothTo(sc.scrollHeight); return true;
      case 'heading': {
        const t = headingTarget(headingTops(), sc.scrollTop, a.dir, a.n);
        if (t != null) smoothTo(t);
        return true;
      }
      case 'find': void openFind(); return true;
      case 'findNext': stepMatch(a.dir); return true;
      case 'open': {
        const el = document.activeElement as HTMLElement | null;
        if (el && el !== sc && sc.contains(el) && el.matches('a[href], button, input[data-task]')) {
          el.click();
          return true;
        }
        return false;
      }
      default: return false;
    }
  }

  async function openFind(): Promise<void> {
    findOpen = true;
    await Promise.resolve();
    findInput?.focus();
    findInput?.select();
  }

  function paint(): void {
    paintFindHighlights(ranges, matchIdx);
    findInfo = findQuery ? (ranges.length ? `${matchIdx + 1}/${ranges.length}` : 'no match') : '';
  }

  function reveal(r: Range): void {
    const sc = scroller;
    if (!sc) return;
    const rect = r.getBoundingClientRect();
    const top = rect.top - sc.getBoundingClientRect().top + sc.scrollTop;
    leader.claim('preview');
    sc.scrollTop = Math.max(0, top - sc.clientHeight / 3);
    // The current match is the selection too, so `y` copies it.
    try {
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(r);
    } catch { /* jsdom */ }
  }

  /** Recompute matches; the first one at/after the top of the view wins. */
  function search(): void {
    ranges = body && findQuery ? findRanges(body, findQuery) : [];
    matchIdx = -1;
    if (ranges.length && scroller) {
      const scTop = scroller.getBoundingClientRect().top;
      const i = ranges.findIndex((r) => r.getBoundingClientRect().top >= scTop - 1);
      matchIdx = i >= 0 ? i : 0;
      reveal(ranges[matchIdx]);
    }
    paint();
  }

  function stepMatch(dir: 1 | -1): void {
    if (!ranges.length && findQuery) search();
    if (!ranges.length) return;
    matchIdx = nextMatchIndex(ranges.length, matchIdx, dir);
    reveal(ranges[matchIdx]);
    paint();
  }

  function onFindKey(e: KeyboardEvent): void {
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      findOpen = false;
      scroller?.focus({ preventScroll: true });
    } else if (e.key === 'Escape') {
      e.preventDefault();
      findOpen = false;
      findQuery = '';
      ranges = [];
      matchIdx = -1;
      paint();
      scroller?.focus({ preventScroll: true });
    }
  }

  /** Esc in the reader: clear an active search first. */
  export function clearFind(): boolean {
    if (!findQuery) return false;
    findQuery = '';
    ranges = [];
    matchIdx = -1;
    paint();
    try { window.getSelection()?.removeAllRanges(); } catch { /* jsdom */ }
    return true;
  }

  // Re-render invalidates the ranges.
  function onRendered(): void {
    remeasure();
    if (findQuery) {
      ranges = body ? findRanges(body, findQuery) : [];
      matchIdx = Math.min(matchIdx, ranges.length - 1);
      paint();
    }
  }

  $effect(() => () => clearFindHighlights());
</script>

<div
  class="split"
  class:on={enabled}
  class:narrow={enabled && narrow}
  class:dragging
  bind:this={root}
  style="--ratio: {live}"
  data-testid="source-split"
>
  {#if enabled && narrow}
    <div class="tabs" role="tablist" aria-label="Source or preview">
      <button type="button" role="tab" data-tab="source" aria-selected={tab === 'source'} tabindex={tab === 'source' ? 0 : -1}
        aria-controls="split-src" onclick={() => (tab = 'source')} onkeydown={onTabKey}>Source</button>
      <button type="button" role="tab" data-tab="preview" aria-selected={tab === 'preview'} tabindex={tab === 'preview' ? 0 : -1}
        aria-controls="split-preview" onclick={() => { tab = 'preview'; requestAnimationFrame(remeasure); }} onkeydown={onTabKey}>Preview</button>
    </div>
  {/if}
  <div
    class="pane src"
    class:pane-focus={focused === 'editor'}
    data-pane="editor"
    id="split-src"
    role={enabled && narrow ? 'tabpanel' : undefined}
    hidden={enabled && narrow && tab !== 'source'}
    bind:this={srcPane}
    onpointerdowncapture={() => leader.claim('source')}
    onwheelcapture={() => leader.claim('source')}
    onkeydowncapture={() => leader.claim('source')}
  >
    {@render children()}
  </div>
  {#if enabled && !narrow}
    <!-- A focusable separator is a widget (WAI-ARIA window splitter). -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
    <div
      class="divider"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize source and preview"
      aria-valuemin={PREVIEW_RATIO_MIN * 100}
      aria-valuemax={PREVIEW_RATIO_MAX * 100}
      aria-valuenow={Math.round(live * 100)}
      tabindex="0"
      title="Drag to resize · ←/→ · Enter resets"
      onpointerdown={onDividerDown}
      onpointermove={onDividerMove}
      onpointerup={onDividerUp}
      onpointercancel={onDividerUp}
      ondblclick={() => { live = 0.5; onratio(0.5); }}
      onkeydown={onDividerKey}
    ><span class="grip" aria-hidden="true"></span></div>
  {/if}
  {#if enabled}
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <section
    class="pane preview-pane"
    class:pane-focus={focused === 'split'}
    data-pane="split"
    id="split-preview"
    role={narrow ? 'tabpanel' : 'region'}
    aria-label="Rendered preview"
    hidden={narrow && tab !== 'preview'}
    tabindex="0"
    bind:this={scroller}
    onscroll={onPreviewScroll}
    onpointerdowncapture={() => leader.claim('preview')}
    onwheelcapture={() => leader.claim('preview')}
    onkeydowncapture={() => leader.claim('preview')}
    onfocusin={() => leader.claim('preview')}
    data-testid="split-preview"
  >
    {#if findOpen}
      <div class="find-bar" data-testid="preview-find">
        <span class="find-slash" aria-hidden="true">/</span>
        <input class="find-input" type="search" aria-label="Find in preview" placeholder="find in preview"
          bind:this={findInput} bind:value={findQuery} oninput={search} onkeydown={onFindKey}
          onblur={() => (findOpen = false)} autocomplete="off" spellcheck="false" />
        <span class="find-info">{findInfo}</span>
      </div>
    {:else if findQuery}
      <div class="find-bar idle" aria-live="polite"><span class="find-slash" aria-hidden="true">/</span>{findQuery}<span class="find-info">{findInfo} · n N</span></div>
    {/if}
    <article class="rendered lumi-prose split-rendered" data-prose={prose}>
      <MarkdownView {blocks} bind:element={body} {ontoggletask} {onlink} animateUpdates onrendered={onRendered} />
    </article>
  </section>
  {/if}
</div>

<style>
  .split {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr);
  }
  .split.on { grid-template-columns: minmax(0, calc(var(--ratio) * 100% - 5px)) 10px minmax(0, 1fr); }
  .split.on.narrow { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr); }
  .pane { min-width: 0; min-height: 0; }
  .pane[hidden] { display: none; }
  .src { display: flex; overflow: hidden; }
  :global(.split .src .note-editor-host) { min-height: 0; height: 100%; }
  :global(.split.on .src .note-editor-host) { max-width: none; }
  .split.on .preview-pane { animation: split-in 180ms var(--ease); }
  @keyframes split-in { from { opacity: 0; transform: translateX(10px); } }
  .preview-pane {
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: clamp(20px, 5vh, 56px) clamp(16px, 3vw, 40px) 40vh;
    outline: none;
    background: color-mix(in srgb, var(--color-text) 2.2%, var(--color-background));
  }
  /* Focused pane: a quiet accent line on top (pane navigation). */
  .pane-focus { box-shadow: inset 0 2px 0 color-mix(in srgb, var(--color-primary) 50%, transparent); }
  .find-bar {
    position: sticky;
    top: calc(-1 * clamp(20px, 5vh, 56px) + 6px);
    z-index: 3;
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    max-width: 420px;
    margin: 0 0 var(--sp-3) auto;
    padding: 4px 10px;
    border: 1px solid var(--hairline);
    border-radius: var(--radius-sm);
    background: var(--color-background);
    box-shadow: var(--shadow-pop);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }
  .find-bar.idle { color: var(--color-text-dim); box-shadow: none; }
  .find-slash { color: var(--color-primary); }
  .find-input { flex: 1; min-width: 0; border: none; outline: none; background: transparent; color: var(--color-text); font: inherit; }
  .find-info { color: var(--color-text-dim); margin-left: auto; white-space: nowrap; }
  :global(::highlight(lumi-find)) { background-color: color-mix(in srgb, var(--color-warning) 30%, transparent); }
  :global(::highlight(lumi-find-current)) { background-color: color-mix(in srgb, var(--color-primary) 40%, transparent); }
  .split-rendered { max-width: calc(var(--md-measure) + 2px); margin: 0 auto; }
  .divider {
    position: relative;
    cursor: col-resize;
    touch-action: none;
    outline: none;
    display: grid;
    place-items: center;
  }
  .divider::before {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    left: 50%;
    width: 1px;
    background: var(--hairline);
    transition: background 120ms var(--ease), width 120ms var(--ease);
  }
  .grip {
    position: relative;
    width: 4px;
    height: 28px;
    border-radius: 3px;
    background: var(--color-border);
    opacity: 0;
    transition: opacity 120ms var(--ease), background 120ms var(--ease);
  }
  .divider:hover .grip, .divider:focus-visible .grip, .split.dragging .grip { opacity: 1; background: var(--color-primary); }
  .divider:hover::before, .divider:focus-visible::before, .split.dragging .divider::before { background: color-mix(in srgb, var(--color-primary) 60%, transparent); }
  .split.dragging { cursor: col-resize; user-select: none; }
  .tabs {
    display: flex;
    gap: 2px;
    padding: var(--sp-2) var(--sp-3);
  }
  .tabs [role='tab'] {
    flex: 1;
    height: 28px;
    border: 1px solid var(--hairline);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text-dim);
    font-size: var(--text-xs);
    font-weight: 500;
    cursor: pointer;
  }
  .tabs [role='tab'][aria-selected='true'] { background: var(--tint-active); color: var(--color-text); border-color: transparent; }
</style>
