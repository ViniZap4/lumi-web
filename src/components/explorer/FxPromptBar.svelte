<script lang="ts">
  // The explorer's create / rename prompt: one line that previews what
  // Enter will do (note in a folder, a new folder, a move) before it runs.
  import { untrack } from 'svelte';
  import { planCreate, planRename, planFolderRename } from '../../lib/fileops.ts';
  import type { FxPrompt, FxPlan } from './fx-types.ts';

  interface Props {
    prompt: FxPrompt | null;
    /** The folder the explorer shows (where `create` lands). */
    dir: string;
    busy: boolean;
    /** Run the plan (the view's file operations). */
    run: (p: FxPrompt, plan: FxPlan) => Promise<void>;
    /** The prompt closed (submitted or cancelled): focus the column. */
    ondone: () => void;
  }
  let { prompt = $bindable(), dir, busy = $bindable(), run, ondone }: Props = $props();

  let input = $state<HTMLInputElement | null>(null);
  let err = $state<string | null>(null);
  // A new prompt starts without the last one's error.
  $effect(() => {
    void prompt;
    untrack(() => (err = null));
  });

  const plan: FxPlan | null = $derived.by(() => {
    const p = prompt;
    if (!p || !p.text.trim()) return null;
    if (p.kind === 'create') return planCreate(dir, p.text);
    if (p.entry.kind === 'folder') return planFolderRename(p.entry.path, p.text);
    return planRename(p.entry.path, p.entry.note.title ?? p.entry.name, p.text);
  });
  const preview = $derived.by(() => {
    const pl = plan;
    if (!pl) return prompt?.kind === 'create' ? 'name · a/b/name · dir/' : 'new name · dir/name · dir/';
    switch (pl.kind) {
      case 'error': return pl.message;
      case 'none': return 'unchanged';
      case 'folder': return 'path' in pl ? `folder ${pl.path}/` : `move folder → ${pl.to}/`;
      case 'note':
        if ('folder' in pl) return `note “${pl.title}” in ${pl.folder ? pl.folder + '/' : 'book root'}`;
        return [pl.title ? `title “${pl.title}”` : '', pl.path ? `→ ${pl.path}` : ''].filter(Boolean).join(' · ');
    }
    return '';
  });

  /** Focus the field: caret at the start (prefilled `.canvas`, `/`) or
   *  the whole text selected. */
  export function focus(caretAtStart = false): void {
    input?.focus();
    if (caretAtStart) input?.setSelectionRange(0, 0);
    else input?.select();
  }

  export async function submit(): Promise<void> {
    const p = prompt;
    const pl = plan;
    if (!p || !pl || busy) return;
    if (pl.kind === 'error') {
      err = pl.message;
      return;
    }
    if (pl.kind === 'none') {
      prompt = null;
      return ondone();
    }
    busy = true;
    try {
      await run(p, pl);
      prompt = null;
      ondone();
    } catch (e) {
      err = (e as Error).message;
    } finally {
      busy = false;
    }
  }

  function onKey(e: KeyboardEvent): void {
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      prompt = null;
      ondone();
    }
  }
</script>

{#if prompt}
  <form class="fx-bar" onsubmit={(e) => { e.preventDefault(); void submit(); }} data-testid="prompt">
    <span class="fx-tag">{prompt.kind === 'create' ? 'new' : 'rename'}</span>
    <span class="fx-dir mono">{prompt.kind === 'create' ? (dir ? dir + '/' : '/') : ''}</span>
    <input class="fx-input mono" bind:this={input} bind:value={prompt.text} onkeydown={onKey} disabled={busy} autocomplete="off" spellcheck="false" aria-label={prompt.kind === 'create' ? 'New note or folder (end with /)' : 'New name or path'} />
    <span class="fx-hint" class:err={plan?.kind === 'error' || !!err}>{err ?? preview}</span>
  </form>
{/if}

<style>
  .fx-bar {
    position: relative;
    flex: none;
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    min-height: 34px;
    padding: 0 var(--sp-3) 0 var(--sp-4);
    border-top: 1px solid var(--hairline-soft);
    font-size: var(--text-xs);
    background: var(--surface-1);
    animation: ui-rise var(--spring-snappy-ms) var(--spring-snappy);
  }
  .fx-tag { padding: 2px 8px; border-radius: var(--radius-xs); font-family: var(--font-mono); font-size: var(--text-2xs); font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; background: var(--color-primary); color: var(--color-background); box-shadow: 0 0 12px -2px var(--accent-glow); }
  .fx-dir { color: var(--ink-3); }
  .fx-input { flex: 1; min-width: 60px; border: none; outline: none; background: transparent; color: var(--color-text); font-size: var(--text-sm); }
  .fx-hint { flex: none; max-width: 45%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--ink-3); }
  .fx-hint.err { color: var(--color-error); }
  .mono { font-family: var(--font-mono); }
</style>
