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
    ><span class="tone-dot" aria-hidden="true"></span>{t.text}</button>
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
    background: var(--glass-bg-strong);
    -webkit-backdrop-filter: var(--glass-blur);
    backdrop-filter: var(--glass-blur);
    color: var(--color-text);
    box-shadow: var(--elev-3), var(--edge-light);
    font-size: var(--text-xs);
    font-family: var(--font-ui);
    text-align: center;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: pointer;
  }
  .toast { display: inline-flex; align-items: center; gap: 8px; transition: transform var(--spring-snappy-ms) var(--spring-snappy); }
  .toast:hover { transform: translateY(-1px); }
  .toast:active { transform: scale(0.97); }
  /* Tone: a small dot, never a whole coloured slab; an error shakes once. */
  .tone-dot { flex: none; width: 6px; height: 6px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 8px var(--accent-glow); animation: pop-in var(--spring-bouncy-ms) var(--spring-bouncy) 80ms both; }
  .toast.warn { border-color: color-mix(in oklch, var(--color-warning) 40%, transparent); }
  .toast.warn .tone-dot { background: var(--color-warning); box-shadow: 0 0 8px color-mix(in oklch, var(--color-warning) 60%, transparent); }
  .toast.error { border-color: color-mix(in oklch, var(--color-error) 45%, transparent); animation: shake 360ms var(--ease) 120ms both; }
  .toast.error .tone-dot { background: var(--color-error); box-shadow: 0 0 8px color-mix(in oklch, var(--color-error) 60%, transparent); }
</style>
