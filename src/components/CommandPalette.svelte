<script lang="ts">
  // Command palette (space / : / ⌘K): fuzzy over commands and, unless
  // opened in command mode (`:`), the notes of the book. ↑/↓ or ⌃n/⌃p
  // move, ⏎ runs, Esc closes. The list is capped so a 10k-note book
  // stays instant.
  import { onMount, tick } from 'svelte';
  import { fuzzyScore, linkCandidates } from '../lib/links.ts';
  import type { NoteSummary } from '../lib/types.ts';
  import type { PaletteCommand } from '../lib/palette.ts';
  import { keyLabel } from '../lib/platform.ts';

  interface Props {
    commands: readonly PaletteCommand[];
    notes?: readonly NoteSummary[];
    /** `:` mode: commands only. */
    commandMode?: boolean;
    onnote?: (id: string) => void;
    /** `:` mode: run the typed line as an ex command (`vsplit plan`).
     *  true = handled (the palette closes). */
    onex?: (line: string) => boolean;
    onclose: () => void;
  }
  const { commands, notes = [], commandMode = false, onnote, onex, onclose }: Props = $props();

  type Item =
    | { kind: 'cmd'; key: string; title: string; detail?: string; cmd: PaletteCommand }
    | { kind: 'note'; key: string; title: string; detail: string; id: string };

  let query = $state('');
  let cursor = $state(0);
  let inputEl = $state<HTMLInputElement | null>(null);
  let listEl = $state<HTMLElement | null>(null);

  const items: Item[] = $derived.by(() => {
    const q = query.trim();
    const cmds = commands
      .map((c) => ({ c, s: fuzzyScore(q, c.title + ' ' + (c.group ?? '')) }))
      .filter((x) => x.s != null)
      .sort((a, b) => (q ? b.s! - a.s! : 0))
      .map((x): Item => ({ kind: 'cmd', key: 'c:' + x.c.id, title: x.c.title, detail: x.c.keys, cmd: x.c }));
    if (commandMode) return cmds;
    const ns = q
      ? linkCandidates(notes, q, { limit: 30 }).map((c): Item => ({ kind: 'note', key: 'n:' + c.id, title: c.title, detail: c.folder || '/', id: c.id }))
      : [];
    // Notes first when the query looks like a search, commands first otherwise.
    return ns.length && q.length > 1 ? [...ns.slice(0, 20), ...cmds.slice(0, 8)] : [...cmds, ...ns];
  });

  $effect(() => {
    void query;
    cursor = 0;
  });

  $effect(() => {
    const el = listEl?.querySelector<HTMLElement>(`[data-i="${cursor}"]`);
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' });
  });

  onMount(() => {
    void tick().then(() => inputEl?.focus());
  });

  // A pointer that merely rests while the list scrolls under it must
  // not steal the keyboard cursor: only real movement selects.
  let lastPointer = '';
  function hover(i: number, e: MouseEvent): void {
    const p = `${e.clientX},${e.clientY}`;
    if (p === lastPointer) return;
    lastPointer = p;
    cursor = i;
  }

  function run(i: number): void {
    const it = items[i];
    if (!it) return;
    onclose();
    if (it.kind === 'cmd') it.cmd.run();
    else onnote?.(it.id);
  }

  function onKey(e: KeyboardEvent): void {
    const n = items.length;
    if (e.key === 'Escape') {
      e.preventDefault();
      onclose();
    } else if (e.key === 'ArrowDown' || (e.ctrlKey && (e.key === 'n' || e.key === 'j'))) {
      e.preventDefault();
      if (n) cursor = (cursor + 1) % n;
    } else if (e.key === 'ArrowUp' || (e.ctrlKey && (e.key === 'p' || e.key === 'k'))) {
      e.preventDefault();
      if (n) cursor = (cursor - 1 + n) % n;
    } else if (e.key === 'Tab') {
      // Tab / ⇧Tab walk the results (focus stays in the input).
      e.preventDefault();
      if (n) cursor = (cursor + (e.shiftKey ? -1 : 1) + n) % n;
    } else if (e.ctrlKey && (e.key === 'd' || e.key === 'u')) {
      e.preventDefault();
      if (n) cursor = Math.max(0, Math.min(n - 1, cursor + (e.key === 'd' ? 5 : -5)));
    } else if (e.key === 'PageDown' || e.key === 'PageUp') {
      e.preventDefault();
      if (n) cursor = Math.max(0, Math.min(n - 1, cursor + (e.key === 'PageDown' ? 8 : -8)));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (commandMode && onex && query.trim()) {
        const line = query;
        onclose();
        if (onex(line)) return;
      }
      run(cursor);
    } else if (e.key === 'Backspace' && commandMode && query === '') {
      e.preventDefault();
      onclose();
    }
    e.stopPropagation();
  }
</script>

<div class="ui-scrim" role="presentation" onclick={onclose}>
  <div
    class="ui-sheet palette"
    role="dialog"
    aria-modal="true"
    aria-label="Command palette"
    tabindex="-1"
    onclick={(e) => e.stopPropagation()}
    onkeydown={onKey}
    data-testid="palette"
  >
    <div class="input-row">
      <span class="prompt" aria-hidden="true">{commandMode ? ':' : '›'}</span>
      <input
        bind:this={inputEl}
        class="input"
        type="text"
        placeholder={commandMode ? 'command' : 'Search notes and commands'}
        aria-label={commandMode ? 'Command' : 'Search notes and commands'}
        role="combobox"
        aria-expanded="true"
        aria-controls="palette-list"
        aria-activedescendant={items[cursor] ? `pal-${cursor}` : undefined}
        bind:value={query}
        autocomplete="off"
        spellcheck="false"
      />
    </div>
    <ul class="list" id="palette-list" role="listbox" bind:this={listEl}>
      {#each items as it, i (it.key)}
        {#if i === 0 || items[i - 1].kind !== it.kind}
          <li class="ui-eyebrow sep" role="presentation">{it.kind === 'cmd' ? 'Commands' : 'Notes'}</li>
        {/if}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <li
          id="pal-{i}"
          data-i={i}
          class="item"
          class:cursor={i === cursor}
          role="option"
          aria-selected={i === cursor}
          onclick={() => run(i)}
          onmousemove={(e) => hover(i, e)}
        >
          <span class="icon" aria-hidden="true">
            {#if it.kind === 'note'}
              <svg viewBox="0 0 16 16" width="13" height="13"><path d="M4 2h5l3 3v9H4z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>
            {:else}
              <svg viewBox="0 0 16 16" width="13" height="13"><path d="m5 4 4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
            {/if}
          </span>
          <span class="title">{it.title}</span>
          {#if it.detail}<span class="detail">{it.kind === 'cmd' ? keyLabel(it.detail) : it.detail}</span>{/if}
        </li>
      {:else}
        <li class="none" role="presentation">No matches</li>
      {/each}
    </ul>
  </div>
</div>

<style>
  .palette { width: min(600px, 100%); }
  .input-row {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    padding: 0 var(--sp-4);
    height: 48px;
    border-bottom: 1px solid var(--hairline);
  }
  .prompt { font-family: var(--font-mono); color: var(--color-primary); font-weight: 600; }
  .input {
    flex: 1;
    min-width: 0;
    border: none;
    outline: none;
    background: transparent;
    font-size: var(--text-lg);
    color: var(--color-text);
  }
  .input::placeholder { color: var(--color-text-dim); }
  .list {
    list-style: none;
    overflow-y: auto;
    padding: var(--sp-1) var(--sp-2) var(--sp-2);
    max-height: 56vh;
  }
  .sep { padding: var(--sp-2) var(--sp-2) var(--sp-1); }
  .item {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    height: 34px;
    padding: 0 var(--sp-2);
    border-radius: var(--radius-sm);
    cursor: pointer;
    font-size: var(--text-sm);
  }
  .item.cursor { background: var(--tint-active); }
  .icon { color: var(--color-text-dim); display: inline-flex; }
  .item.cursor .icon { color: var(--color-primary); }
  .title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .detail {
    flex: none;
    max-width: 40%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    color: var(--color-text-dim);
  }
  .none { padding: var(--sp-4); color: var(--color-text-dim); font-size: var(--text-sm); text-align: center; }
</style>
