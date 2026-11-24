<script lang="ts">
  // Vim mode pill (SPEC-PARTE2 §1, "the mode pill morphing between vim
  // modes"): one element whose width and colour glide (snappy spring)
  // from NORMAL to INSERT to VISUAL…, with the label cross-fading. The
  // width comes from a hidden measurer, so the morph never waits on the
  // keystroke that changed the mode. Reduced motion: instant.
  import { fade } from 'svelte/transition';
  import { motionAllowed } from '../lib/motion.ts';

  interface Props {
    /** normal | insert | visual | replace | plain */
    mode: string;
    label: string;
  }
  const { mode, label }: Props = $props();

  let measureEl = $state<HTMLElement | null>(null);
  let width = $state<number | null>(null);
  $effect(() => {
    void label;
    const w = measureEl?.offsetWidth ?? 0;
    width = w > 0 ? w : null;
  });
  const dur = () => (motionAllowed() ? 110 : 0);
</script>

<span class="mode-pill" data-mode={mode} data-testid="vim-mode" style={width != null ? `--w: ${width}px` : undefined} title="Vim mode">
  <span class="measure" bind:this={measureEl} data-label={label} aria-hidden="true"></span>
  {#key label}
    <span class="txt" in:fade={{ duration: dur() }} out:fade={{ duration: dur() * 0.6 }}>{label}</span>
  {/key}
</span>

<style>
  .mode-pill {
    --m: var(--color-primary);
    position: relative;
    display: inline-grid;
    flex: none;
    align-self: center;
    box-sizing: content-box;
    width: var(--w, auto);
    height: 1.5em;
    padding: 0 7px;
    border-radius: 4px;
    overflow: hidden;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    line-height: 1.5em;
    background: color-mix(in oklch, var(--m) 16%, transparent);
    color: var(--m);
    box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--m) 28%, transparent), 0 0 12px -3px color-mix(in oklch, var(--m) 55%, transparent);
    transition: width var(--spring-glide-ms, 220ms) var(--spring-glide, ease-out), background var(--dur-fade) ease, color var(--dur-fade) ease, box-shadow var(--dur-fade) ease;
  }
  .mode-pill[data-mode='insert'] { --m: var(--mode-insert); }
  .mode-pill[data-mode='visual'] { --m: var(--mode-visual); }
  .mode-pill[data-mode='replace'] { --m: var(--mode-replace); }
  .mode-pill[data-mode='plain'] { display: none; }
  .txt { grid-area: 1 / 1; white-space: nowrap; }
  .measure { position: absolute; visibility: hidden; white-space: nowrap; pointer-events: none; }
  .measure::after { content: attr(data-label); }
</style>
