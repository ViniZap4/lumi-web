<script lang="ts">
  // Modal form for POST /api/vaults. Slug is optional — the server
  // auto-generates one from the name when omitted. On success the
  // store has prepended the new vault to the live list, so the
  // parent just closes the modal (and optionally jumps into it).
  //
  // Keyboard: Esc closes; Enter submits the form natively.

  import { onMount, onDestroy } from 'svelte';
  import { vaults } from '../lib/vaults.svelte.ts';
  import { ApiError } from '../lib/types.ts';

  interface Props {
    onclose: () => void;
    onCreated?: (id: string) => void;
  }

  const { onclose, onCreated }: Props = $props();

  let name = $state('');
  let slug = $state('');
  let submitting = $state(false);
  let localError = $state<string | null>(null);

  async function submit(e: Event): Promise<void> {
    e.preventDefault();
    if (submitting) return;
    const n = name.trim();
    if (!n) return;
    submitting = true;
    localError = null;
    try {
      const v = await vaults.create({ name: n, slug: slug.trim() || undefined });
      onCreated?.(v.id);
      onclose();
    } catch (e) {
      // The store already surfaced lastError; keep the modal open so
      // the user can correct the slug / name and try again.
      localError = e instanceof ApiError ? (e.detail ?? e.code) : (e as Error).message;
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
    aria-label="Create vault"
    tabindex="-1"
    onclick={(e) => e.stopPropagation()}
    onkeydown={(e) => e.stopPropagation()}
  >
    <form class="form" onsubmit={submit}>
      <h2>Create vault</h2>
      <!-- svelte-ignore a11y_autofocus -->
      <input
        class="input"
        type="text"
        placeholder="Name (e.g. Personal notes)"
        bind:value={name}
        disabled={submitting}
        autofocus
        required
      />
      <input
        class="input"
        type="text"
        placeholder="Slug (optional — auto-generated)"
        bind:value={slug}
        disabled={submitting}
        pattern="[a-z0-9-]*"
        title="Lowercase letters, digits, and hyphens only"
      />
      <p class="hint">
        Slug becomes part of paths and URLs. Leave blank to derive from
        the name.
      </p>
      {#if localError}<div class="error">{localError}</div>{/if}
      <div class="actions">
        <button class="primary" type="submit" disabled={submitting || !name.trim()}>
          {submitting ? '…' : 'Create'}
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
    width: min(420px, 100%);
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
