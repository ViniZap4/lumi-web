<script lang="ts">
  // Sync state dot (SPEC-LIVROS §4.1 "Indicador"). Shape differs per
  // state, not only colour, so it is legible without colour vision; the
  // pt-BR label is always available to assistive tech.
  //
  // Alive (SPEC-PARTE2 §1): the dot breathes while syncing and sends a
  // one-shot ring when a change from elsewhere lands — either the
  // `pulse` counter prop grows, or (with `vaultID`) the book's
  // remoteActivity counter does. Both are off under reduced motion
  // (app.css kill-switch).
  import { untrack } from 'svelte';
  import { STATE_LABEL, PENDING_LABEL, type BookSyncState } from '../lib/bookstatus.ts';
  import { remoteActivity } from '../lib/remote-activity.svelte.ts';

  interface Props {
    state: BookSyncState;
    label?: boolean;
    /** Unsent local edits (BookStatus.pending) — shown as a qualifier. */
    pending?: boolean;
    /** Book whose remote changes make the dot pulse. */
    vaultID?: string | null;
    /** Bump to pulse once (alternative to vaultID). */
    pulse?: number;
  }
  const { state: st, label = false, pending = false, vaultID = null, pulse = 0 }: Props = $props();

  // Pulses seen since mount (only growth after mount rings).
  const signal = $derived(pulse + remoteActivity.tick(vaultID));
  let seen = untrack(() => signal);
  let rings = $state(0);
  $effect(() => {
    const s = signal;
    untrack(() => {
      if (s > seen) rings++;
      seen = s;
    });
  });
  const text = $derived(STATE_LABEL[st].pt + (pending ? ` · ${PENDING_LABEL.pt}` : ''));
</script>

<span class="sync-dot-wrap" data-state={st} data-pending={pending ? 'true' : undefined} title={text}>
  {#if st === 'not_bound'}
    <span class="glyph" aria-hidden="true">▭</span>
  {:else if st === 'read_only'}
    <span class="glyph" aria-hidden="true">🔒︎</span>
  {:else}
    <span class="dot-box" aria-hidden="true">
      <span class="dot dot-{st}"></span>
      {#key rings}{#if rings > 0}<span class="ping" data-testid="sync-ping"></span>{/if}{/key}
    </span>
  {/if}
  {#if label}<span class="label">{text.toLowerCase()}</span>{:else}<span class="sr-only">{text}</span>{/if}
</span>

<style>
  .sync-dot-wrap {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.78rem;
    color: var(--color-text-dim, var(--color-muted));
    white-space: nowrap;
  }
  .dot {
    width: 0.55rem;
    height: 0.55rem;
    border-radius: 50%;
    display: inline-block;
    box-sizing: border-box;
  }
  .dot-up_to_date { background: var(--color-success, #9ece6a); }
  .dot-box { position: relative; display: inline-grid; place-items: center; }
  .dot-syncing {
    background: var(--color-info, var(--color-secondary));
    animation: sync-breathe 1.6s ease-in-out infinite;
  }
  .ping {
    position: absolute;
    inset: 0;
    border-radius: 50%;
    border: 1.5px solid var(--color-primary);
    pointer-events: none;
    animation: sync-ping 700ms cubic-bezier(0.2, 0.7, 0.2, 1) forwards;
  }
  .dot-offline { border: 1.5px solid var(--color-muted); background: transparent; }
  .dot-error { background: var(--color-error); }
  .dot-needs_login { background: var(--color-warning, #e0af68); }
  .glyph { font-size: 0.7rem; line-height: 1; }
  @media (prefers-reduced-motion: reduce) {
    .dot-syncing { animation: none; }
    .ping { display: none; }
  }
  :global(:root[data-motion='reduce']) .ping { display: none; }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
</style>
