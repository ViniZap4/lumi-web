<script lang="ts">
  // Sync state dot (SPEC-LIVROS §4.1 "Indicador"). Shape differs per
  // state, not only colour, so it is legible without colour vision; the
  // pt-BR label is always available to assistive tech.
  import { STATE_LABEL, PENDING_LABEL, type BookSyncState } from '../lib/bookstatus.ts';

  interface Props {
    state: BookSyncState;
    label?: boolean;
    /** Unsent local edits (BookStatus.pending) — shown as a qualifier. */
    pending?: boolean;
  }
  const { state, label = false, pending = false }: Props = $props();
  const text = $derived(STATE_LABEL[state].pt + (pending ? ` · ${PENDING_LABEL.pt}` : ''));
</script>

<span class="sync-dot-wrap" data-state={state} data-pending={pending ? 'true' : undefined} title={text}>
  {#if state === 'not_bound'}
    <span class="glyph" aria-hidden="true">▭</span>
  {:else if state === 'read_only'}
    <span class="glyph" aria-hidden="true">🔒︎</span>
  {:else}
    <span class="dot dot-{state}" aria-hidden="true"></span>
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
  .dot-syncing {
    background: var(--color-info, var(--color-secondary));
    animation: pulse 1.2s ease-in-out infinite;
  }
  .dot-offline { border: 1.5px solid var(--color-muted); background: transparent; }
  .dot-error { background: var(--color-error); }
  .dot-needs_login { background: var(--color-warning, #e0af68); }
  .glyph { font-size: 0.7rem; line-height: 1; }
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }
  @media (prefers-reduced-motion: reduce) {
    .dot-syncing { animation: none; }
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
</style>
