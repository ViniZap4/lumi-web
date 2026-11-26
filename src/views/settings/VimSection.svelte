<script lang="ts">
  // Settings → Vim: the switch, escape sequences, timeout, the .vimrc
  // (a draft until Apply or ⌘S, with inline diagnostics) and mappings.
  import { onDestroy, untrack } from 'svelte';
  import { editorSettings } from '../../lib/editor-settings.svelte.ts';
  import {
    validateEscapeSequence,
    validateMapping,
    ESCAPE_TIMEOUT_MIN,
    ESCAPE_TIMEOUT_MAX,
    MAX_ESCAPE_SEQUENCES,
    MAX_MAPPINGS,
    type MapMode,
  } from '../../lib/editor-settings.ts';
  import { parseVimrc, errorCount, displayLhs, MAX_VIMRC_BYTES, VIMRC_EXAMPLE } from '../../lib/vimrc.ts';
  import { keyLabel } from '../../lib/platform.ts';
  import type { VimrcEditorHandle } from '../../lib/vimrc-editor.ts';
  import { num, checked, type ShowRow } from './form.ts';

  const { show }: { show: ShowRow } = $props();
  const s = $derived(editorSettings.value);

  onDestroy(() => vimrcEd?.destroy());

  // ---- vim: escape sequences + mappings -----------------------------------

  let seqInput = $state('');
  let seqError = $state<string | null>(null);
  const SEQ_PRESETS = ['jj', 'jk', 'kj', 'ff'];

  function addSequence(raw = seqInput): void {
    const r = validateEscapeSequence(raw);
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

  let mapMode = $state<MapMode>('normal');
  let mapLhs = $state('');
  let mapRhs = $state('');
  let mapNoremap = $state(true);
  let mapError = $state<string | null>(null);
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

  // ---- vim: .vimrc ----------------------------------------------------------

  let draft = $state(untrack(() => editorSettings.value.vimrc));
  const parsed = $derived(parseVimrc(draft));
  const dirty = $derived(draft !== s.vimrc);
  const draftBytes = $derived(new TextEncoder().encode(draft).length);
  const counts = $derived({
    errors: errorCount(parsed),
    warnings: parsed.diagnostics.filter((d) => d.severity === 'warning').length,
  });
  let savedFlash = $state(false);
  let vimrcHost = $state<HTMLElement | null>(null);
  let vimrcEd: VimrcEditorHandle | null = null;
  let vimrcFallback = $state(false);

  function applyVimrc(): void {
    editorSettings.update({ vimrc: draft });
    draft = editorSettings.value.vimrc; // sanitised form
    vimrcEd?.setText(draft);
    savedFlash = true;
    setTimeout(() => (savedFlash = false), 1600);
  }
  function revertVimrc(): void {
    draft = s.vimrc;
    vimrcEd?.setText(draft);
  }
  function insertExample(): void {
    draft = VIMRC_EXAMPLE;
    vimrcEd?.setText(draft);
  }

  // Mount the CodeMirror vimrc editor when the Vim rows are on screen.
  $effect(() => {
    const host = vimrcHost;
    if (!host || vimrcEd || vimrcFallback) return;
    const useVim = untrack(() => s.vim);
    import('../../lib/vimrc-editor.ts')
      .then((m) => {
        if (!host.isConnected || vimrcEd) return;
        vimrcEd = m.createVimrcEditor(host, untrack(() => draft), {
          onChange: (t) => (draft = t),
          onSave: () => applyVimrc(),
          vim: useVim,
        });
        vimrcEd.setDiagnostics(untrack(() => parsed.diagnostics));
      })
      .catch(() => (vimrcFallback = true));
    return () => {
      vimrcEd?.destroy();
      vimrcEd = null;
    };
  });
  $effect(() => {
    const d = parsed.diagnostics;
    vimrcEd?.setDiagnostics(d);
  });
</script>

<section class="group" aria-labelledby="sec-vim">
  <h2 id="sec-vim">Vim</h2>
  {#if show('vimOn')}
    <label class="row">
      <div class="row-text"><span class="row-title">Vim keybindings</span><span class="row-desc">Modal editing in the note editor. The .vimrc below only applies while this is on.</span></div>
      <input type="checkbox" class="ui-switch" checked={s.vim} onchange={(e) => editorSettings.update({ vim: checked(e) })} />
    </label>
  {/if}
  {#if show('escape')}
    <div class="row stack">
      <div class="row-text">
        <span class="row-title">Leave insert mode with</span>
        <span class="row-desc">Type these two letters quickly in insert mode to act as <kbd>Esc</kbd>. A lone first letter still types normally.</span>
      </div>
      <div class="chips">
        {#each s.escapeSequences as seq (seq)}
          <span class="chip on">
            <span class="mono">{seq}</span>
            <button type="button" aria-label="Remove {seq}" onclick={() => removeSequence(seq)}>×</button>
          </span>
        {/each}
        {#each SEQ_PRESETS.filter((p) => !s.escapeSequences.includes(p)) as p (p)}
          <button type="button" class="chip add" onclick={() => addSequence(p)} disabled={!s.vim}><span class="mono">+ {p}</span></button>
        {/each}
        <form class="chip-form" onsubmit={(e) => { e.preventDefault(); addSequence(); }}>
          <input class="ui-input mono chip-input" placeholder="custom…" maxlength="4" bind:value={seqInput} aria-label="Custom escape sequence" disabled={!s.vim} />
        </form>
      </div>
      {#if seqError}<p class="err">{seqError}</p>{/if}
    </div>
  {/if}
  {#if show('timeout')}
    <div class="row">
      <div class="row-text"><span class="row-title">Sequence timeout</span><span class="row-desc">How long the second key may take.</span></div>
      <div class="range">
        <input type="range" min={ESCAPE_TIMEOUT_MIN} max={ESCAPE_TIMEOUT_MAX} step="50" value={s.escapeTimeout}
          aria-label="Escape sequence timeout" oninput={(e) => editorSettings.update({ escapeTimeout: num(e) })} />
        <span class="value">{s.escapeTimeout}ms</span>
      </div>
    </div>
  {/if}
  {#if show('vimrc')}
    <div class="row stack">
      <div class="row-text">
        <span class="row-title">.vimrc</span>
        <span class="row-desc">
          A safe subset, parsed — never executed: <code>map</code>/<code>nnoremap</code>/<code>inoremap</code>/<code>vnoremap</code>/<code>unmap</code>…,
          <code>let mapleader</code>, <code>set number relativenumber wrap tabstop shiftwidth expandtab</code> and <code>" comments</code>.
          Map to <code>:ex</code> commands like <code>:w</code>, <code>:q</code>, <code>:link</code>, <code>:preview</code>. Applies on save; stored on this device.
        </span>
      </div>
      <div class="vimrc-host" bind:this={vimrcHost} data-testid="vimrc-editor">
        {#if vimrcFallback}
          <textarea class="ui-input mono vimrc-fallback" spellcheck="false" bind:value={draft} aria-label=".vimrc"></textarea>
        {/if}
      </div>
      <div class="vimrc-bar">
        <span class="vimrc-stats" data-testid="vimrc-stats">
          {parsed.maps.length} {parsed.maps.length === 1 ? 'mapping' : 'mappings'} · leader <span class="mono">{parsed.leader}</span>
          {#if counts.errors}<span class="e"> · {counts.errors} {counts.errors === 1 ? 'error' : 'errors'}</span>{/if}
          {#if counts.warnings}<span class="w"> · {counts.warnings} unsupported</span>{/if}
          <span class="bytes"> · {(draftBytes / 1024).toFixed(1)}/{MAX_VIMRC_BYTES / 1024} KB</span>
        </span>
        <span class="vimrc-actions">
          {#if !draft.trim()}<button class="ui-btn sm ghost" type="button" onclick={insertExample}>Insert example</button>{/if}
          {#if dirty}<button class="ui-btn sm ghost" type="button" onclick={revertVimrc}>Revert</button>{/if}
          <button class="ui-btn sm primary" type="button" disabled={!dirty} onclick={applyVimrc} data-testid="vimrc-apply">
            {savedFlash ? 'Applied' : 'Apply'} <kbd class="on-primary">{keyLabel('⌘S')}</kbd>
          </button>
        </span>
      </div>
      {#if parsed.diagnostics.length}
        <ul class="diags" data-testid="vimrc-diagnostics">
          {#each parsed.diagnostics as d, i (i)}
            <li class="diag {d.severity}">
              <button type="button" class="ui-link line" onclick={() => vimrcEd?.goToLine(d.line)}>line {d.line}</button>
              <span>{d.message}</span>
            </li>
          {/each}
        </ul>
      {/if}
      {#if parsed.maps.length}
        <details class="effective">
          <summary>Effective mappings</summary>
          <table>
            <tbody>
              {#each parsed.maps as m (m.line + m.lhs)}
                <tr><td class="mode">{m.mode}</td><td class="mono">{displayLhs(m, parsed.leader)}</td><td class="arrow">{m.noremap ? '→' : '⇢'}</td><td class="mono">{m.rhs}</td></tr>
              {/each}
            </tbody>
          </table>
        </details>
      {/if}
    </div>
  {/if}
  {#if show('mappings')}
    <div class="row stack">
      <div class="row-text"><span class="row-title">Quick mappings</span><span class="row-desc">One-off maps without writing a vimrc.</span></div>
      {#if s.mappings.length}
        <ul class="maps">
          {#each s.mappings as m, i (i)}
            <li>
              <span class="mode">{m.mode}</span>
              <span class="mono">{m.lhs}</span>
              <span class="arrow">{m.noremap ? '→' : '⇢'}</span>
              <span class="mono">{m.rhs}</span>
              <button type="button" class="ui-btn ghost sm icon" aria-label="Remove mapping {m.lhs}" onclick={() => removeMapping(i)}>×</button>
            </li>
          {/each}
        </ul>
      {/if}
      <form class="map-form" onsubmit={(e) => { e.preventDefault(); addMapping(); }}>
        <select class="ui-input" bind:value={mapMode} aria-label="Mode">
          <option value="normal">normal</option>
          <option value="insert">insert</option>
          <option value="visual">visual</option>
        </select>
        <input class="ui-input mono" placeholder="lhs" bind:value={mapLhs} aria-label="Keys" />
        <input class="ui-input mono" placeholder="rhs" bind:value={mapRhs} aria-label="Maps to" />
        <label class="inline"><input type="checkbox" bind:checked={mapNoremap} /> noremap</label>
        <button class="ui-btn sm" type="submit">Add</button>
      </form>
      {#if mapError}<p class="err">{mapError}</p>{/if}
    </div>
  {/if}
</section>
