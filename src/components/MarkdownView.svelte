<script lang="ts">
  // Rendered markdown (reader, split preview, read-only previews).
  // Blocks are keyed by their source, so an edit re-renders only the
  // blocks that changed; changed blocks fade in (GPU: opacity only).
  // Every block carries `data-line` for the split preview's scroll
  // sync. All HTML here is DOMPurify output (lib/markdown.ts); the
  // interactive bits (copy, task toggles, zoom) are added by
  // lib/rendered-enhance.ts, never by note content.
  import { tick, untrack } from 'svelte';
  import type { MdBlock } from '../lib/markdown.ts';
  import { enhanceRendered, codeTextFor } from '../lib/rendered-enhance.ts';
  import { motionAllowed } from '../lib/motion.ts';

  interface Props {
    blocks: readonly MdBlock[];
    /** Toggle task `index` (document order). Absent → read-only. */
    ontoggletask?: (index: number) => void;
    /** Open an in-app note link / external link (reader routing). */
    onlink?: (href: string, e: MouseEvent) => void;
    /** Fade blocks that changed since the last render. */
    animateUpdates?: boolean;
    element?: HTMLElement | null;
    /** Called after the DOM reflects new blocks (scroll sync remeasure). */
    onrendered?: () => void;
  }
  let { blocks, ontoggletask, onlink, animateUpdates = false, element = $bindable(null), onrendered }: Props = $props();

  let zoom = $state<{ src: string; alt: string } | null>(null);
  let zoomReturn: HTMLElement | null = null;
  let zoomClose = $state<HTMLButtonElement | null>(null);
  let prevKeys = new Set<string>();

  $effect(() => {
    const bs = blocks;
    const canToggle = !!ontoggletask;
    void tick().then(() => {
      if (!element) return;
      enhanceRendered(element, { canToggle });
      if (animateUpdates && prevKeys.size && motionAllowed()) {
        const els = element.querySelectorAll<HTMLElement>(':scope > .md-b');
        bs.forEach((b, i) => {
          if (!prevKeys.has(b.key)) els[i]?.animate?.([{ opacity: 0.35 }, { opacity: 1 }], { duration: 180, easing: 'ease-out' });
        });
      }
      prevKeys = new Set(bs.map((b) => b.key));
      untrack(() => onrendered?.());
    });
  });

  function onclick(e: MouseEvent): void {
    const t = e.target as HTMLElement | null;
    if (!t) return;
    const copy = t.closest<HTMLButtonElement>('button[data-action="copy-code"]');
    if (copy) {
      e.preventDefault();
      void navigator.clipboard?.writeText(codeTextFor(copy)).then(
        () => flashButton(copy, 'Copied'),
        () => flashButton(copy, 'Failed'),
      );
      return;
    }
    const box = t.closest<HTMLInputElement>('input[data-task]');
    if (box) {
      if (!ontoggletask) {
        e.preventDefault();
        return;
      }
      ontoggletask(Number(box.dataset.task));
      return;
    }
    const img = t.closest<HTMLImageElement>('img[data-zoom]');
    if (img) {
      e.preventDefault();
      openZoom(img);
      return;
    }
    const a = t.closest<HTMLAnchorElement>('a[href]');
    if (!a) return;
    const href = a.getAttribute('href') ?? '';
    if (href.startsWith('#')) {
      // In-note anchors (headings, footnotes): scroll inside the pane,
      // never touch the app URL.
      e.preventDefault();
      const id = decodeURIComponent(href.slice(1));
      const target = element?.querySelector<HTMLElement>(`[id="${CSS.escape(id)}"]`);
      target?.scrollIntoView({ block: 'start', behavior: motionAllowed() ? 'smooth' : 'auto' });
      return;
    }
    onlink?.(href, e);
  }

  function onkeydown(e: KeyboardEvent): void {
    const t = e.target as HTMLElement | null;
    if (e.key === 'Enter' && t?.matches?.('input[data-task]')) {
      e.preventDefault();
      t.click();
    }
  }

  function flashButton(b: HTMLButtonElement, text: string): void {
    b.textContent = text;
    b.classList.add('done');
    setTimeout(() => {
      b.textContent = 'Copy';
      b.classList.remove('done');
    }, 1200);
  }

  async function openZoom(img: HTMLImageElement): Promise<void> {
    zoomReturn = (document.activeElement as HTMLElement | null) ?? null;
    zoom = { src: img.currentSrc || img.src, alt: img.alt };
    await tick();
    zoomClose?.focus();
  }
  function closeZoom(): void {
    zoom = null;
    zoomReturn?.focus?.({ preventScroll: true });
    zoomReturn = null;
  }
  function onZoomKey(e: KeyboardEvent): void {
    if (e.key === 'Escape' || e.key === 'q') {
      e.preventDefault();
      e.stopPropagation();
      closeZoom();
    }
  }
</script>

<!-- Clicks route links/tasks/copy; keyboard reaches the same targets
     as real links, checkboxes and buttons. -->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="md-body" bind:this={element} {onclick} {onkeydown} data-testid="md-body">
  {#each blocks as b (b.key)}
    <div class="md-b" data-line={b.line}>{@html b.html}</div>
  {/each}
</div>

{#if zoom}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="ui-scrim md-zoom" onclick={closeZoom} onkeydown={onZoomKey} role="dialog" aria-modal="true" aria-label="Image" tabindex="-1">
    <img src={zoom.src} alt={zoom.alt} />
    <button class="ui-btn sm md-zoom-close" type="button" bind:this={zoomClose} onclick={closeZoom}>Close <kbd>Esc</kbd></button>
  </div>
{/if}

<style>
  .md-zoom { align-items: center; padding: var(--sp-6); cursor: zoom-out; }
  .md-zoom img {
    max-width: min(96vw, 1600px);
    max-height: 86vh;
    border-radius: var(--radius);
    box-shadow: var(--shadow-pop);
    animation: ui-rise 160ms var(--ease);
  }
  .md-zoom-close { position: fixed; top: var(--sp-4); right: var(--sp-4); background: var(--color-background); }
</style>
