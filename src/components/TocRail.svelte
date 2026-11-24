<script lang="ts">
  // Outline rail beside the reader (Settings-free: it appears only when
  // the gutter is wide enough — lib/toc.ts tocFits). Click a heading to
  // jump; the current section is lit as you scroll (one passive scroll
  // listener, one rAF read per frame). Collapsible; remembered.
  import { buildToc, activeTocIndex, tocDepths, tocFits, TOC_RAIL_W, type TocItem } from '../lib/toc.ts';
  import { scrollBehavior } from '../lib/motion.ts';

  interface Props {
    /** The reader's scroll container. */
    scrollEl: HTMLElement | null;
  }
  const { scrollEl }: Props = $props();

  const KEY = 'lumi.v2.toc-collapsed';
  let collapsed = $state(readCollapsed());
  let items = $state<TocItem[]>([]);
  let active = $state(-1);
  let fits = $state(false);
  let pos = $state({ top: 0, left: 0 });

  function readCollapsed(): boolean {
    try {
      return localStorage.getItem(KEY) === '1';
    } catch {
      return false;
    }
  }
  function toggle(): void {
    collapsed = !collapsed;
    try {
      localStorage.setItem(KEY, collapsed ? '1' : '0');
    } catch {
      /* storage blocked: session-only */
    }
  }

  function byId(root: HTMLElement, id: string): HTMLElement | null {
    return root.querySelector<HTMLElement>(`[id="${id.replace(/["\\]/g, '\\$&')}"]`);
  }

  function article(): HTMLElement | null {
    return scrollEl?.querySelector<HTMLElement>('article.rendered') ?? null;
  }

  // Layout: where the rail sits and whether it fits.
  function layout(): void {
    const el = scrollEl;
    const art = article();
    if (!el || !art) {
      fits = false;
      return;
    }
    const r = el.getBoundingClientRect();
    const a = art.getBoundingClientRect();
    fits = tocFits(r.width, a.width, TOC_RAIL_W);
    // Beside the text column (not at the far window edge on big screens).
    pos = { top: Math.round(r.top + 12), left: Math.round(Math.min(a.right + 48, r.right - TOC_RAIL_W - 20)) };
  }

  let raf = 0;
  function spy(): void {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      const el = scrollEl;
      if (!el || items.length === 0) return;
      const top = el.getBoundingClientRect().top;
      const tops = items.map((it) => {
        const h = byId(el, it.id);
        return h ? h.getBoundingClientRect().top - top : Infinity;
      });
      active = activeTocIndex(tops);
    });
  }

  $effect(() => {
    const el = scrollEl;
    if (!el) return;
    let t: ReturnType<typeof setTimeout> | null = null;
    const rebuild = () => {
      t = null;
      items = buildToc(article());
      layout();
      spy();
    };
    rebuild();
    // Content changes (remote edits, a different note) rebuild at most
    // every 250 ms.
    const mo = new MutationObserver(() => { if (!t) t = setTimeout(rebuild, 250); });
    mo.observe(el, { childList: true, subtree: true });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(layout) : null;
    ro?.observe(el);
    const art = article();
    if (art) ro?.observe(art);
    el.addEventListener('scroll', spy, { passive: true });
    window.addEventListener('resize', layout);
    return () => {
      mo.disconnect();
      ro?.disconnect();
      el.removeEventListener('scroll', spy);
      window.removeEventListener('resize', layout);
      if (t) clearTimeout(t);
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };
  });

  const depths = $derived(tocDepths(items));

  function go(it: TocItem): void {
    const h = scrollEl ? byId(scrollEl, it.id) : null;
    h?.scrollIntoView({ block: 'start', behavior: scrollBehavior() });
  }
</script>

{#if fits && items.length >= 2}
  <nav class="toc" class:collapsed aria-label="Contents" data-testid="toc-rail" style="top: {pos.top}px; left: {pos.left}px; width: {TOC_RAIL_W}px">
    <button type="button" class="toc-head" onclick={toggle} aria-expanded={!collapsed} title={collapsed ? 'Show contents' : 'Hide contents'}>
      <span class="toc-label">Contents</span>
      <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </button>
    {#if !collapsed}
      <ol class="toc-list">
        {#each items as it, i (it.id + i)}
          <li style="--d: {depths[i]}">
            <button type="button" class="toc-item" class:on={i === active} aria-current={i === active ? 'location' : undefined} onclick={() => go(it)} title={it.text}>{it.text}</button>
          </li>
        {/each}
      </ol>
    {/if}
  </nav>
{/if}

<style>
  .toc {
    position: fixed;
    z-index: 3;
    max-height: calc(100dvh - 140px);
    display: flex;
    flex-direction: column;
    font-size: var(--text-xs);
    animation: ui-fade var(--dur-fade) var(--ease);
  }
  .toc-head {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    align-self: flex-start;
    height: 22px;
    padding: 0 6px;
    margin-left: 4px;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--ink-3);
    font: inherit;
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    letter-spacing: var(--tracking-caps);
    text-transform: uppercase;
    cursor: pointer;
  }
  .toc-head:hover { background: var(--tint-hover); color: var(--ink-2); }
  .toc-head svg { transition: transform var(--spring-snappy-ms) var(--spring-snappy); }
  .toc.collapsed .toc-head svg { transform: rotate(-90deg); }
  .toc-list {
    list-style: none;
    margin: 4px 0 0;
    padding: 0 0 0 2px;
    overflow-y: auto;
    border-left: 1px solid var(--hairline-soft);
    scrollbar-width: none;
  }
  .toc-item {
    display: block;
    width: 100%;
    margin-left: -1px;
    padding: 3px 8px 3px calc(10px + var(--d, 0) * 12px);
    border: none;
    border-left: 2px solid transparent;
    background: transparent;
    color: var(--ink-3);
    font: inherit;
    line-height: 1.35;
    text-align: left;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: pointer;
    transition: color var(--dur-fade) var(--ease), border-color var(--dur-fade) var(--ease), background var(--dur-tap) var(--ease);
  }
  .toc-item:hover { color: var(--ink-1); background: var(--tint-hover); }
  .toc-item.on { color: var(--accent-ink); border-left-color: var(--accent); font-weight: 600; }
  .toc-item:focus-visible { outline: none; box-shadow: inset 0 0 0 2px var(--ring); }
  @media (hover: none) and (pointer: coarse) { .toc { display: none; } }
</style>
