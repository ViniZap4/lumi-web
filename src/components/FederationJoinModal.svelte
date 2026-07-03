<script lang="ts">
  // Modal form for POST /api/federation/join — makes THIS server a
  // follower of a remote vault. The operator pastes the home server's
  // URL + the federation-invite token they received out-of-band; on
  // success the server materialises a local replica vault and the
  // parent refreshes the vault list and jumps into it.
  //
  // Keyboard: Esc closes; Enter submits the form natively.

  import { onMount, onDestroy } from 'svelte';
  import { federation } from '../lib/federation.svelte.ts';
  import { ApiError } from '../lib/types.ts';

  interface Props {
    onclose: () => void;
    onJoined?: (vaultID: string) => void;
  }

  const { onclose, onJoined }: Props = $props();

  let homeURL = $state('');
  let token = $state('');
  let jurisdiction = $state('');
  let submitting = $state(false);
  let localError = $state<string | null>(null);

  function errorText(e: unknown): string {
    if (e instanceof ApiError) {
      if (e.status === 403) return 'You don’t have permission to join federations on this server.';
      return e.detail ?? e.code;
    }
    return (e as Error).message;
  }

  async function submit(e: Event): Promise<void> {
    e.preventDefault();
    if (submitting) return;
    const home = homeURL.trim();
    const tok = token.trim();
    if (!home || !tok) return;
    if (!/^https?:\/\//.test(home)) {
      localError = 'Home server must be a full URL (https://…).';
      return;
    }
    submitting = true;
    localError = null;
    try {
      const out = await federation.joinFederation({
        home_url: home,
        token: tok,
        jurisdiction: jurisdiction.trim() || undefined,
      });
      onJoined?.(out.vault.id);
      onclose();
    } catch (e) {
      // Keep the modal open so the operator can fix the URL / token.
      localError = errorText(e);
    } finally {
      submitting = false;
    }
  }

  function handleKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      onclose();
    }
  }

  onMount(() => window.addEventListener('keydown', handleKey));
  onDestroy(() => window.removeEventListener('keydown', handleKey));
</script>

<div
  class="overlay"
  role="presentation"
  onclick={onclose}
  onkeydown={(e) => { if (e.key === 'Escape') onclose(); }}
>
  <div
    class="panel"
    role="dialog"
    aria-modal="true"
    aria-label="Join federated vault"
    tabindex="-1"
    onclick={(e) => e.stopPropagation()}
    onkeydown={(e) => e.stopPropagation()}
  >
    <form class="form" onsubmit={submit}>
      <h2>Join federated vault</h2>
      <p class="hint">
        Link this server to a vault hosted elsewhere. You need a
        federation-invite token from the home vault’s operator; this
        server then keeps a live, full replica of the vault.
      </p>
      <!-- svelte-ignore a11y_autofocus -->
      <input
        class="input"
        type="url"
        placeholder="Home server URL (https://…)"
        bind:value={homeURL}
        disabled={submitting}
        autofocus
        required
      />
      <input
        class="input"
        type="text"
        placeholder="Federation invite token"
        bind:value={token}
        disabled={submitting}
        required
      />
      <input
        class="input"
        type="text"
        placeholder="Jurisdiction (optional, e.g. BR)"
        bind:value={jurisdiction}
        disabled={submitting}
      />
      <p class="hint">
        Jurisdiction declares where this server stores data; it’s shown
        to the vault’s owner on the home server (residency notice).
      </p>
      {#if localError}<div class="error">{localError}</div>{/if}
      <div class="actions">
        <button class="primary" type="submit" disabled={submitting || !homeURL.trim() || !token.trim()}>
          {submitting ? '…' : 'Join'}
        </button>
        <button class="link" type="button" onclick={onclose} disabled={submitting}>Cancel</button>
      </div>
    </form>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 150;
    padding: 1rem;
  }
  .panel {
    background: var(--color-background);
    border: 1px solid var(--color-border, var(--color-muted));
    border-radius: 6px;
    width: min(440px, 100%);
    padding: 1.25rem;
    outline: none;
  }
  .form {
    display: flex;
    flex-direction: column;
    gap: 0.65rem;
  }
  h2 {
    margin: 0 0 0.2rem;
    font-size: 1rem;
    font-weight: 600;
    color: var(--color-text);
  }
  .input {
    padding: 0.5rem 0.7rem;
    background: var(--color-overlay-bg, var(--color-background));
    border: 1px solid var(--color-border, var(--color-muted));
    border-radius: 4px;
    color: var(--color-text);
    font-family: inherit;
    font-size: 0.95rem;
    outline: none;
  }
  .input:focus { border-color: var(--color-secondary); }
  .hint {
    margin: 0;
    color: var(--color-text-dim, var(--color-muted));
    font-size: 0.78rem;
  }
  .error {
    color: var(--color-error);
    font-size: 0.85rem;
  }
  .actions {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    margin-top: 0.4rem;
  }
  .primary {
    padding: 0.45rem 0.95rem;
    background: var(--color-primary);
    border: none;
    border-radius: 4px;
    color: var(--color-background);
    font-family: inherit;
    font-size: 0.9rem;
    font-weight: 600;
    cursor: pointer;
  }
  .primary:disabled { opacity: 0.5; cursor: progress; }
  .link {
    background: transparent;
    border: none;
    color: var(--color-secondary);
    font-family: inherit;
    font-size: 0.85rem;
    cursor: pointer;
    padding: 0 0.4rem;
  }
  .link:hover { text-decoration: underline; }
</style>
