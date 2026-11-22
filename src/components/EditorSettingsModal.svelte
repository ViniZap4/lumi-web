<script lang="ts">
  // Editor settings (per device). Every control writes through
  // editorSettings.update(), which sanitises + persists and is picked
  // up live by a mounted NoteEditor — no save step.
  import { onMount, onDestroy, tick } from 'svelte';
  import { editorSettings } from '../lib/editor-settings.svelte.ts';
  import {
    validateEscapeSequence,
    validateMapping,
    FONT_SIZE_MIN,
    FONT_SIZE_MAX,
    TAB_SIZES,
    ESCAPE_TIMEOUT_MIN,
    ESCAPE_TIMEOUT_MAX,
    MAX_ESCAPE_SEQUENCES,
    MAX_MAPPINGS,
    type MapMode,
  } from '../lib/editor-settings.ts';

  const s = $derived(editorSettings.value);

  let seqInput = $state('');
  let seqError = $state<string | null>(null);
  let mapMode = $state<MapMode>('normal');
  let mapLhs = $state('');
  let mapRhs = $state('');
  let mapNoremap = $state(true);
  let mapError = $state<string | null>(null);
  let panel = $state<HTMLElement | null>(null);

  function close(): void {
    editorSettings.open = false;
  }

  function handleKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  }

  onMount(() => {
    window.addEventListener('keydown', handleKey, true);
    void tick().then(() => panel?.focus());
  });
  onDestroy(() => window.removeEventListener('keydown', handleKey, true));

  function addSequence(): void {
    const r = validateEscapeSequence(seqInput);
    if (!r.ok) {
      seqError = r.error;
      return;
    }
    if (s.escapeSequences.includes(r.value)) {
      seqError = `“${r.value}” is already mapped.`;
      return;
    }
    if (s.escapeSequences.length >= MAX_ESCAPE_SEQUENCES) {
      seqError = `At most ${MAX_ESCAPE_SEQUENCES} sequences.`;
      return;
    }
    editorSettings.update({ escapeSequences: [...s.escapeSequences, r.value] });
    seqInput = '';
    seqError = null;
  }

  function removeSequence(seq: string): void {
    editorSettings.update({ escapeSequences: s.escapeSequences.filter((x) => x !== seq) });
  }

  function addMapping(): void {
    const m = validateMapping({ mode: mapMode, lhs: mapLhs, rhs: mapRhs, noremap: mapNoremap });
    if (!m) {
      mapError = 'Both sides are required (max 32 chars); ex-command lhs (“:…”) is not supported.';
      return;
    }
    if (s.mappings.length >= MAX_MAPPINGS) {
      mapError = `At most ${MAX_MAPPINGS} mappings.`;
      return;
    }
    editorSettings.update({ mappings: [...s.mappings, m] });
    mapLhs = '';
    mapRhs = '';
    mapError = null;
  }

  function removeMapping(i: number): void {
    editorSettings.update({ mappings: s.mappings.filter((_, j) => j !== i) });
  }

  function num(e: Event): number {
    return Number((e.currentTarget as HTMLInputElement | HTMLSelectElement).value);
  }
  function checked(e: Event): boolean {
    return (e.currentTarget as HTMLInputElement).checked;
  }
</script>

<div class="overlay" role="presentation" onclick={close}>
  <div
    class="panel"
    role="dialog"
    aria-modal="true"
    aria-label="Editor settings"
    tabindex="-1"
    bind:this={panel}
    onclick={(e) => e.stopPropagation()}
    onkeydown={(e) => { if (e.key !== 'Escape') e.stopPropagation(); }}
    data-testid="editor-settings"
  >
    <header class="panel-head">
      <h2>Editor</h2>
      <button class="close" type="button" aria-label="Close" onclick={close}>×</button>
    </header>

    <section class="row">
      <h3>View</h3>
      <div class="field">
        <span class="label">Editing mode</span>
        <div class="seg" role="group" aria-label="Editing mode">
          <button type="button" class:active={s.editMode === 'live'} aria-pressed={s.editMode === 'live'}
            onclick={() => editorSettings.update({ editMode: 'live' })}>Live Preview</button>
          <button type="button" class:active={s.editMode === 'source'} aria-pressed={s.editMode === 'source'}
            onclick={() => editorSettings.update({ editMode: 'source' })}>Source</button>
        </div>
      </div>
      <div class="field">
        <span class="label">Opening a note shows</span>
        <div class="seg" role="group" aria-label="Opening a note shows">
          <button type="button" class:active={s.openIn === 'reading'} aria-pressed={s.openIn === 'reading'}
            onclick={() => editorSettings.update({ openIn: 'reading' })}>Reading view</button>
          <button type="button" class:active={s.openIn === 'editing'} aria-pressed={s.openIn === 'editing'}
            onclick={() => editorSettings.update({ openIn: 'editing' })}>Editor</button>
        </div>
      </div>
      <label class="check"><input type="checkbox" checked={s.readableWidth}
        onchange={(e) => editorSettings.update({ readableWidth: checked(e) })} /> Readable line length</label>
      <label class="check"><input type="checkbox" checked={s.lineWrapping}
        onchange={(e) => editorSettings.update({ lineWrapping: checked(e) })} /> Wrap long lines</label>
      <label class="check"><input type="checkbox" checked={s.lineNumbers}
        onchange={(e) => editorSettings.update({ lineNumbers: checked(e) })} /> Line numbers</label>
      <label class="check"><input type="checkbox" checked={s.relativeLineNumbers}
        onchange={(e) => editorSettings.update({ relativeLineNumbers: checked(e) })} /> Relative line numbers</label>
      <div class="field">
        <label class="label" for="es-font">Font size</label>
        <input id="es-font" type="range" min={FONT_SIZE_MIN} max={FONT_SIZE_MAX} step="1" value={s.fontSize}
          oninput={(e) => editorSettings.update({ fontSize: num(e) })} />
        <span class="value">{s.fontSize}px</span>
      </div>
      <div class="field">
        <label class="label" for="es-tab">Tab width</label>
        <select id="es-tab" value={s.tabSize} onchange={(e) => editorSettings.update({ tabSize: num(e) })}>
          {#each TAB_SIZES as t (t)}<option value={t}>{t} spaces</option>{/each}
        </select>
      </div>
    </section>

    <section class="row">
      <h3>Vim</h3>
      <label class="check"><input type="checkbox" checked={s.vim}
        onchange={(e) => editorSettings.update({ vim: checked(e) })} /> Vim keybindings</label>

      <div class="sub" class:dim={!s.vim}>
        <span class="label">Leave insert mode with</span>
        <p class="help">Type the sequence quickly in insert mode to act as <kbd>Esc</kbd> (e.g. <code>jk</code>, <code>jj</code>, <code>ff</code>). A single key still types normally.</p>
        <div class="chips">
          {#each s.escapeSequences as seq (seq)}
            <span class="chip"><code>{seq}</code>
              <button type="button" aria-label="Remove {seq}" onclick={() => removeSequence(seq)}>×</button></span>
          {:else}
            <span class="help">None — only <kbd>Esc</kbd> / <kbd>Ctrl</kbd>+<kbd>[</kbd>.</span>
          {/each}
        </div>
        <form class="inline" onsubmit={(e) => { e.preventDefault(); addSequence(); }}>
          <input class="mono" type="text" maxlength="4" placeholder="jk" aria-label="New escape sequence"
            autocomplete="off" autocapitalize="off" spellcheck="false" bind:value={seqInput} />
          <button type="submit" class="btn">Add</button>
        </form>
        {#if seqError}<div class="err">{seqError}</div>{/if}
        <div class="field">
          <label class="label" for="es-timeout">Sequence timeout</label>
          <input id="es-timeout" type="range" min={ESCAPE_TIMEOUT_MIN} max={ESCAPE_TIMEOUT_MAX} step="50"
            value={s.escapeTimeout} oninput={(e) => editorSettings.update({ escapeTimeout: num(e) })} />
          <span class="value">{s.escapeTimeout} ms</span>
        </div>

        <span class="label">Custom mappings</span>
        <p class="help">Vim key notation, e.g. normal <code>H</code> → <code>^</code>, insert <code>&lt;C-l&gt;</code> → <code>&lt;Right&gt;</code>.</p>
        {#if s.mappings.length > 0}
          <ul class="maps">
            {#each s.mappings as m, i (i + m.mode + m.lhs)}
              <li>
                <span class="mode">{m.mode}</span>
                <code>{m.lhs}</code> → <code>{m.rhs}</code>
                {#if m.noremap}<span class="tag">noremap</span>{/if}
                <button type="button" class="x" aria-label="Remove mapping {m.lhs}" onclick={() => removeMapping(i)}>×</button>
              </li>
            {/each}
          </ul>
        {/if}
        <form class="inline" onsubmit={(e) => { e.preventDefault(); addMapping(); }}>
          <select bind:value={mapMode} aria-label="Mapping mode">
            <option value="normal">normal</option>
            <option value="insert">insert</option>
            <option value="visual">visual</option>
          </select>
          <input class="mono" type="text" placeholder="lhs" aria-label="Mapping keys" maxlength="32"
            autocomplete="off" spellcheck="false" bind:value={mapLhs} />
          <input class="mono" type="text" placeholder="rhs" aria-label="Mapping target" maxlength="32"
            autocomplete="off" spellcheck="false" bind:value={mapRhs} />
          <label class="check small"><input type="checkbox" bind:checked={mapNoremap} /> noremap</label>
          <button type="submit" class="btn">Add</button>
        </form>
        {#if mapError}<div class="err">{mapError}</div>{/if}
      </div>
    </section>

    <section class="row keys">
      <h3>Shortcuts</h3>
      <dl>
        <dt><kbd>Cmd/Ctrl</kbd>+<kbd>E</kbd></dt><dd>Toggle reading ↔ editing</dd>
        <dt><kbd>Cmd/Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>E</kbd></dt><dd>Toggle Live Preview ↔ Source</dd>
        <dt><kbd>Cmd/Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>,</kbd></dt><dd>Editor settings (also vim <code>:settings</code>)</dd>
        <dt><kbd>Cmd/Ctrl</kbd>+<kbd>click</kbd></dt><dd>Open a link in Live Preview</dd>
        <dt>vim <code>:q</code> <code>:wq</code> <code>:x</code></dt><dd>Close the editor (edits are always saved live)</dd>
      </dl>
    </section>

    <footer class="panel-foot">
      <button type="button" class="btn ghost" onclick={() => editorSettings.reset()}>Reset to defaults</button>
      <span class="hint">Saved on this device · <kbd>Esc</kbd> closes</span>
    </footer>
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
    z-index: 200;
    padding: 1rem;
  }
  .panel {
    background: var(--color-background);
    border: 1px solid var(--color-border, var(--color-muted));
    border-radius: 8px;
    width: min(600px, 100%);
    max-height: 88vh;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    outline: none;
    color: var(--color-text);
  }
  .panel-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.85rem 1.1rem;
    border-bottom: 1px solid var(--color-separator, var(--color-border));
    position: sticky;
    top: 0;
    background: var(--color-background);
    z-index: 1;
  }
  .panel-head h2 { margin: 0; font-size: 1rem; font-weight: 600; }
  .close {
    background: transparent;
    border: none;
    color: var(--color-text-dim, var(--color-muted));
    font-size: 1.4rem;
    line-height: 1;
    cursor: pointer;
    padding: 0 0.4rem;
  }
  .close:hover { color: var(--color-text); }
  .row {
    padding: 0.75rem 1.1rem;
    border-bottom: 1px solid var(--color-separator, var(--color-border));
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .row h3 {
    margin: 0 0 0.2rem;
    font-size: 0.78rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--color-text-dim, var(--color-muted));
    font-weight: 600;
  }
  .field { display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap; }
  .label { font-size: 0.86rem; min-width: 10rem; }
  .sub { display: flex; flex-direction: column; gap: 0.45rem; padding-left: 0.2rem; }
  .sub.dim { opacity: 0.55; }
  .help { margin: 0; font-size: 0.76rem; color: var(--color-text-dim, var(--color-muted)); }
  .value { font-size: 0.8rem; color: var(--color-text-dim, var(--color-muted)); min-width: 3.5rem; }
  .check { display: flex; align-items: center; gap: 0.45rem; font-size: 0.86rem; cursor: pointer; }
  .check.small { font-size: 0.78rem; }
  .check input { accent-color: var(--color-primary); }
  input[type='range'] { accent-color: var(--color-primary); flex: 1; max-width: 14rem; }
  .seg { display: inline-flex; border: 1px solid var(--color-border, var(--color-muted)); border-radius: 999px; overflow: hidden; }
  .seg button {
    background: transparent;
    border: none;
    color: var(--color-text);
    padding: 0.3rem 0.85rem;
    font: inherit;
    font-size: 0.82rem;
    cursor: pointer;
  }
  .seg button + button { border-left: 1px solid var(--color-border, var(--color-muted)); }
  .seg button.active { background: var(--color-selected-bg, var(--color-overlay-bg)); color: var(--color-primary); }
  .chips { display: flex; flex-wrap: wrap; gap: 0.35rem; }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.1rem 0.25rem 0.1rem 0.55rem;
    border: 1px solid var(--color-primary);
    border-radius: 999px;
    font-size: 0.82rem;
  }
  .chip button, .x {
    background: transparent;
    border: none;
    color: var(--color-text-dim, var(--color-muted));
    cursor: pointer;
    font-size: 1rem;
    line-height: 1;
    padding: 0 0.25rem;
  }
  .chip button:hover, .x:hover { color: var(--color-error, var(--color-text)); }
  .inline { display: flex; gap: 0.4rem; align-items: center; flex-wrap: wrap; }
  input[type='text'], select {
    background: var(--color-overlay-bg, var(--color-background));
    border: 1px solid var(--color-border, var(--color-muted));
    border-radius: 4px;
    color: var(--color-text);
    padding: 0.3rem 0.5rem;
    font: inherit;
    font-size: 0.84rem;
  }
  input[type='text'] { width: 7rem; }
  input[type='text']:focus, select:focus { outline: none; border-color: var(--color-primary); }
  .mono, code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  code { font-size: 0.85em; }
  .btn {
    background: var(--color-overlay-bg, var(--color-background));
    border: 1px solid var(--color-border, var(--color-muted));
    color: var(--color-text);
    border-radius: 4px;
    padding: 0.3rem 0.75rem;
    font: inherit;
    font-size: 0.82rem;
    cursor: pointer;
  }
  .btn:hover { border-color: var(--color-primary); }
  .btn.ghost { background: transparent; }
  .err { color: var(--color-error, #e55); font-size: 0.78rem; }
  .maps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.84rem; }
  .maps li { display: flex; align-items: center; gap: 0.4rem; }
  .mode, .tag {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--color-text-dim, var(--color-muted));
    min-width: 3.6rem;
  }
  .tag { min-width: 0; border: 1px solid var(--color-border, var(--color-muted)); border-radius: 3px; padding: 0 0.25rem; }
  .keys dl { margin: 0; display: grid; grid-template-columns: max-content 1fr; gap: 0.3rem 0.9rem; font-size: 0.82rem; }
  .keys dt { white-space: nowrap; }
  .keys dd { margin: 0; color: var(--color-text-dim, var(--color-muted)); }
  .panel-foot {
    padding: 0.6rem 1.1rem 0.85rem;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.6rem;
  }
  .hint { font-size: 0.76rem; color: var(--color-text-dim, var(--color-muted)); }
  kbd {
    background: var(--color-selected-bg, var(--color-overlay-bg));
    border: 1px solid var(--color-border, var(--color-muted));
    border-radius: 3px;
    padding: 0.05rem 0.35rem;
    font-family: inherit;
    font-size: 0.74rem;
    color: var(--color-secondary);
  }
</style>
