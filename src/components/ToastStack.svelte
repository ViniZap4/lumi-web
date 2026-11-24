<script lang="ts">
  // Toast stack (lib/toasts.svelte.ts): bottom-centre, above the status
  // bar. New toasts slide in (toast-in, app.css); the others move up
  // with a spring FLIP; leaving ones fade out. Click dismisses. Polite
  // live region; nothing takes focus.
  import { flip as flipAnim } from 'svelte/animate';
  import { fly } from 'svelte/transition';
  import { toasts } from '../lib/toasts.svelte.ts';
  import { motionAllowed, SPRING, springEase as ease } from '../lib/motion.ts';

  interface Props {
    /** Distance from the bottom of the viewport (px). */
    bottom?: number;
  }
  const { bottom = 40 }: Props = $props();

  const springEase = (t: number) => ease(SPRING.gentle.points, t);
  const dur = (ms: number) => (motionAllowed() ? ms : 0);
</script>

<div class="toast-stack" style="bottom: {bottom}px" role="status" aria-live="polite" data-testid="toast-stack">
  {#each toasts.list as t (t.id)}
    <button
      type="button"
      class="toast {t.tone}"
      data-testid="toast"
      animate:flipAnim={{ duration: dur(SPRING.gentle.ms), easing: springEase }}
      in:fly={{ y: 14, duration: dur(SPRING.bouncy.ms), easing: springEase }}
      out:fly={{ y: 8, duration: dur(140), opacity: 0 }}
      onclick={() => toasts.dismiss(t.id)}
      title="Dismiss"
    >{t.text}</button>
  {/each}
</div>

<style>
  .toast-stack {
    position: fixed;
    left: 50%;
    transform: translateX(-50%);
    z-index: 420;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    pointer-events: none;
    max-width: min(520px, calc(100vw - 32px));
  }
  .toast {
    pointer-events: auto;
    max-width: 100%;
    padding: 6px 14px;
    border: 1px solid var(--hairline);
    border-radius: 999px;
    background: color-mix(in srgb, var(--color-overlay-bg) 40%, var(--color-background));
    color: var(--color-text);
    box-shadow: var(--shadow-pop);
    font-size: var(--text-xs);
    font-family: var(--font-ui);
    text-align: center;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: pointer;
  }
  .toast.warn { border-color: color-mix(in srgb, var(--color-warning) 45%, transparent); background: color-mix(in srgb, var(--color-warning) 12%, var(--color-background)); }
  .toast.error { border-color: color-mix(in srgb, var(--color-error) 45%, transparent); background: color-mix(in srgb, var(--color-error) 12%, var(--color-background)); }
</style>
