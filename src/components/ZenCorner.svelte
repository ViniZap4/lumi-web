<script lang="ts">
  // Modo zen hot corner (lib/zen.svelte.ts). Mounted once by the book
  // shell. It renders nothing: while zen is on it watches pointer moves
  // (passive, document level) and tells the controller whether the
  // pointer is in the top-left hot corner or over the revealed chrome.
  // Keys are never observed, so typing cannot reveal anything.
  //
  // The global CSS below is the whole of zen's visual contract: with
  // `data-zen` on <html> the shell's bars are gone, and the top bar
  // becomes an overlay that dissolves in on the glide spring while
  // `data-zen-reveal` is set. Under Reduce Motion it is a ≤ 100 ms
  // opacity dissolve, no transforms.
  import { onDestroy } from 'svelte';
  import { zen as defaultZen, inHotCorner, type ZenController } from '../lib/zen.svelte.ts';

  type Props = { controller?: ZenController };
  const { controller = defaultZen }: Props = $props();

  /** Selector of the chrome that stays revealed under the pointer. */
  const CHROME = '[data-zen-chrome], .topbar';

  function onMove(e: PointerEvent): void {
    if (e.pointerType === 'touch') return;
    const t = e.target as Element | null;
    const overChrome = controller.revealed && !!t?.closest?.(CHROME);
    controller.pointer(inHotCorner(e.clientX, e.clientY) || overChrome);
  }
  function onLeave(e: PointerEvent): void {
    // relatedTarget null = the pointer left the document.
    if (!e.relatedTarget) controller.pointerLeftWindow();
  }

  let attached = false;
  function attach(on: boolean): void {
    if (typeof document === 'undefined' || on === attached) return;
    attached = on;
    if (on) {
      document.addEventListener('pointermove', onMove, { passive: true });
      document.addEventListener('pointerout', onLeave, { passive: true });
    } else {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerout', onLeave);
    }
  }

  // Listeners exist only while zen is on: zero cost otherwise.
  $effect(() => attach(controller.on));
  onDestroy(() => attach(false));
</script>

<style>
  /* Bars that disappear entirely. */
  :global(:root[data-zen] [data-testid='editor-status']),
  :global(:root[data-zen] [data-testid='note-bar']),
  :global(:root[data-zen] .reading-head),
  :global(:root[data-zen] .pane-bar),
  :global(:root[data-zen] .kb-bar),
  :global(:root[data-zen] .cv-bar) {
    display: none !important;
  }

  /* The top bar is the corner dock: an overlay, out of the layout, so
     revealing it never moves the text. Hidden = invisible and inert
     (visibility drops after the fade so Tab cannot reach it). */
  :global(:root[data-zen] .topbar) {
    position: fixed !important;
    top: 0;
    left: 0;
    right: 0;
    z-index: 60 !important;
    opacity: 0;
    visibility: hidden;
    pointer-events: none;
    transition:
      opacity var(--spring-glide-ms, 410ms) var(--spring-glide, ease),
      visibility 0s linear var(--spring-glide-ms, 410ms);
  }
  :global(:root[data-zen][data-zen-reveal] .topbar) {
    opacity: 1;
    visibility: visible;
    pointer-events: auto;
    transition:
      opacity var(--spring-glide-ms, 410ms) var(--spring-glide, ease),
      visibility 0s;
  }

  /* Reduce Motion (app setting or OS): ≤ 100 ms opacity only. These
     beat the global kill-switch in app.css on specificity. */
  :global(:root[data-motion='reduce'][data-zen] .topbar) {
    transition: opacity 90ms linear, visibility 0s linear 90ms !important;
  }
  :global(:root[data-motion='reduce'][data-zen][data-zen-reveal] .topbar) {
    transition: opacity 90ms linear, visibility 0s !important;
  }
  @media (prefers-reduced-motion: reduce) {
    :global(:root[data-zen] .topbar) {
      transition: opacity 90ms linear, visibility 0s linear 90ms !important;
    }
    :global(:root[data-zen][data-zen-reveal] .topbar) {
      transition: opacity 90ms linear, visibility 0s !important;
    }
  }
</style>
