<script lang="ts">
  // Renders a registered note view (lib/note-views.ts) for a pane:
  // loads its component on first use and passes the NoteViewProps.
  import type { Component } from 'svelte';
  import { noteViewSpec, type NoteViewProps } from '../lib/note-views.ts';

  const props: NoteViewProps = $props();
  const view = $derived(props.view);

  let Comp = $state<Component<NoteViewProps> | null>(null);
  let error = $state<string | null>(null);

  $effect(() => {
    const spec = noteViewSpec(view);
    Comp = null;
    error = null;
    if (!spec) {
      error = `Unknown view “${view}”.`;
      return;
    }
    let live = true;
    spec.load().then(
      (c) => { if (live) Comp = c; },
      (e) => { if (live) error = `Failed to load the ${spec.label} view: ${(e as Error).message}`; },
    );
    return () => { live = false; };
  });
</script>

{#if Comp}
  <Comp {...props} />
{:else if error}
  <div class="nv-state error" role="alert">{error}</div>
{:else}
  <div class="nv-state"><span class="spinner" aria-hidden="true"></span>Loading view…</div>
{/if}

<style>
  .nv-state {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--sp-2);
    padding: var(--sp-6);
    color: var(--color-text-dim);
    font-size: var(--text-sm);
  }
  .nv-state.error { color: var(--color-error); }
  .spinner {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    border: 2px solid var(--hairline);
    border-top-color: var(--color-primary);
    animation: nv-spin 0.7s linear infinite;
  }
  @keyframes nv-spin { to { transform: rotate(360deg); } }
</style>
