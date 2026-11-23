<script lang="ts">
  // Modal form for POST /api/vaults. Slug is optional — the server
  // auto-generates one from the name when omitted. On success the
  // store has prepended the new vault to the live list, so the
  // parent just closes the modal (and optionally jumps into it).
  //
  // Keyboard: Esc (or q outside a text field) closes from anywhere in
  // the dialog; Enter submits the form natively; Tab cycles inside.
  // Focus returns to whatever opened the modal.

  import { onMount, onDestroy } from 'svelte';
  import { captureFocus, isTextTarget, trapTab } from '../lib/list-keys.ts';
  import { vaults } from '../lib/vaults.svelte.ts';
  import { ApiError } from '../lib/types.ts';
  import { accounts } from '../lib/accounts.svelte.ts';
  import { books } from '../lib/books.svelte.ts';
  import { serverLabel } from '../lib/serverurl.ts';

  interface Props {
    onclose: () => void;
    onCreated?: (id: string) => void;
  }

  const { onclose, onCreated }: Props = $props();

  let name = $state('');
  let slug = $state('');
  let submitting = $state(false);
  let localError = $state<string | null>(null);
  // "Novo livro: escolher onde" (SPEC-LIVROS §5) — which account
  // (server) the book is created on. Defaults to the active book's.
  const usable = $derived(accounts.list.filter((a) => a.status === 'ok'));
  let accountKey = $state<string>(books.activeAccountKey() ?? '');

  async function submit(e: Event): Promise<void> {
    e.preventDefault();
    if (submitting) return;
    const n = name.trim();
    if (!n) return;
    submitting = true;
    localError = null;
    try {
      const v = await vaults.create(
        { name: n, slug: slug.trim() || undefined },
        accountKey || undefined,
      );
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

  let panelEl = $state<HTMLElement | null>(null);
  const restoreFocus = captureFocus();

  function handleKey(e: KeyboardEvent): void {
    if (e.key === 'Escape' || (e.key === 'q' && !e.ctrlKey && !e.metaKey && !e.altKey && !isTextTarget(e.target))) {
      e.preventDefault();
      onclose();
    }
  }

  /** Keys inside the dialog never reach the view underneath. */
  function onPanelKey(e: KeyboardEvent): void {
    e.stopPropagation();
    if (trapTab(e, panelEl)) return;
    handleKey(e);
  }

  onMount(() => window.addEventListener('keydown', handleKey));
  onDestroy(() => {
    window.removeEventListener('keydown', handleKey);
    restoreFocus();
  });
</script>

<div
  class="overlay"
  role="presentation"
  onclick={onclose}
>
  <div
    class="panel"
    role="dialog"
    aria-modal="true"
    aria-labelledby="new-book-title"
    tabindex="-1"
    bind:this={panelEl}
    data-testid="vault-create"
    onclick={(e) => e.stopPropagation()}
    onkeydown={onPanelKey}
  >
    <form class="form" onsubmit={submit}>
      <h2 id="new-book-title">Novo livro</h2>
      {#if usable.length > 1}
        <label class="hint" for="new-book-account">onde</label>
        <select id="new-book-account" class="input" bind:value={accountKey} disabled={submitting}>
          {#each usable as a (a.key)}
            <option value={a.key}>{serverLabel(a.server_url)} · {a.username}</option>
          {/each}
        </select>
      {/if}
      <!-- svelte-ignore a11y_autofocus -->
      <input
        class="input"
        type="text"
        placeholder="Name (e.g. Personal notes)"
        aria-label="Name"
        bind:value={name}
        disabled={submitting}
        autofocus
        required
      />
      <input
        class="input"
        type="text"
        placeholder="Slug (optional — auto-generated)"
        aria-label="Slug"
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
    background: color-mix(in srgb, var(--color-overlay-bg) 55%, rgba(0, 0, 0, 0.45));
    backdrop-filter: blur(2px);
    animation: ui-fade 120ms var(--ease);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 150;
    padding: 1rem;
  }
  .panel {
    background: var(--color-background);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-pop);
    animation: ui-rise 140ms var(--ease);
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
    border-radius: var(--radius-sm);
    color: var(--color-text);
    font-family: inherit;
    font-size: 0.95rem;
    outline: none;
  }
  .input:focus { border-color: var(--color-primary); box-shadow: 0 0 0 3px var(--tint-primary); }
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
  .primary:focus-visible, .link:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
</style>
