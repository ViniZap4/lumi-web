<script lang="ts">
  // Settings, full screen (replaces the cramped editor-settings modal).
  // Sections: Editor, Vim, Appearance, Keys, Offline & storage, Account.
  // Every control writes through its store (editorSettings / theme),
  // which sanitises + persists per device and is picked up live by a
  // mounted editor — no global save step. The .vimrc is the exception:
  // it is a draft until "Apply" (or ⌘S), and its parse diagnostics show
  // inline per line while typing.
  //
  // Search filters rows across every section by title + keywords.
  import { onMount, onDestroy, tick, untrack } from 'svelte';
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
    type EditorSettings,
  } from '../lib/editor-settings.ts';
  import { parseVimrc, errorCount, displayLhs, MAX_VIMRC_BYTES, VIMRC_EXAMPLE } from '../lib/vimrc.ts';
  import { effectiveSettings } from '../lib/vim-config.ts';
  import { theme } from '../lib/theme.svelte.ts';
  import { themes, themeOrder } from '../lib/themes.ts';
  import type { ThemeMode } from '../lib/types.ts';
  import { uiState, type SettingsSection } from '../lib/uistate.svelte.ts';
  import { accounts } from '../lib/accounts.svelte.ts';
  import { books } from '../lib/books.svelte.ts';
  import { offline, bundleMarkdown, downloadText, exportFilename } from '../lib/offline.svelte.ts';
  import { serverLabel } from '../lib/serverurl.ts';
  import { isEditableTarget } from '../lib/shortcuts.ts';
  import { keymapFor } from '../lib/keymap-help.ts';
  import { keyLabel } from '../lib/platform.ts';
  const KEYMAP = keymapFor();
  import type { VimrcEditorHandle } from '../lib/vimrc-editor.ts';

  const s = $derived(editorSettings.value);
  const eff = $derived(effectiveSettings(s));
  const over = (k: keyof EditorSettings) => eff.overridden.includes(k);

  const SECTIONS: Array<{ id: SettingsSection; label: string; hint: string }> = [
    { id: 'editor', label: 'Editor', hint: 'Editing mode, layout, fonts' },
    { id: 'vim', label: 'Vim', hint: 'Escape keys, mappings, .vimrc' },
    { id: 'appearance', label: 'Appearance', hint: 'Theme, legend' },
    { id: 'keys', label: 'Keys', hint: 'Keymap reference' },
    { id: 'storage', label: 'Offline & storage', hint: 'Local copies, conflicts' },
    { id: 'account', label: 'Account', hint: 'Servers and sign-in' },
  ];

  /** Searchable rows: id → [section, title + keywords]. */
  const INDEX: Record<string, [SettingsSection, string]> = {
    editMode: ['editor', 'editing mode live preview source markdown'],
    previewSplit: ['editor', 'preview beside source split side by side rendered result pane'],
    openIn: ['editor', 'opening a note shows reading view editor open'],
    readable: ['editor', 'readable line length width column'],
    wrap: ['editor', 'wrap long lines wrapping'],
    gutter: ['editor', 'line numbers relative gutter number'],
    fontSize: ['editor', 'font size text zoom'],
    tabSize: ['editor', 'tab size indent tabstop'],
    prose: ['editor', 'prose font typeface serif sans mono reading'],
    vimOn: ['vim', 'vim keybindings mode modal'],
    escape: ['vim', 'escape sequences jj jk kj ff insert esc'],
    timeout: ['vim', 'escape timeout delay ms'],
    mappings: ['vim', 'mappings map noremap keys remap'],
    vimrc: ['vim', 'vimrc .vimrc config leader mapleader set map nnoremap'],
    themeMode: ['appearance', 'theme mode dark light auto system colour color'],
    themes: ['appearance', 'theme dark light tokyo catppuccin dracula obsidian palette'],
    legend: ['appearance', 'command legend bottom bar hints which-key keys'],
    motion: ['appearance', 'reduce motion animation transitions accessibility vestibular'],
    keymap: ['keys', 'keymap shortcuts keys reference yazi help'],
    keysLegend: ['keys', 'command legend bottom bar hints which-key'],
    storage: ['storage', 'offline storage quota space persist local copies indexeddb'],
    conflicts: ['storage', 'conflict copies export download discard'],
    accounts: ['account', 'account sign in servers logout sair entrar'],
  };

  let section = $state<SettingsSection>(untrack(() => uiState.settings) ?? 'editor');
  let query = $state('');
  let searchEl = $state<HTMLInputElement | null>(null);
  const q = $derived(query.trim().toLowerCase());
  const matches = $derived(
    q ? new Set(Object.entries(INDEX).filter(([, [, kw]]) => q.split(/\s+/).every((w) => kw.includes(w))).map(([id]) => id)) : null,
  );
  function show(id: string): boolean {
    return matches ? matches.has(id) : INDEX[id][0] === section;
  }
  function sectionVisible(id: SettingsSection): boolean {
    if (!matches) return section === id;
    return Object.entries(INDEX).some(([rid, [sec]]) => sec === id && matches.has(rid));
  }
  const noResults = $derived(matches != null && matches.size === 0);

  function close(): void {
    uiState.closeSettings();
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      // Esc inside the vimrc editor belongs to vim.
      const t = e.target as HTMLElement | null;
      if (t?.closest?.('.vimrc-host')) return;
      e.preventDefault();
      e.stopPropagation();
      if (query) query = '';
      else close();
      return;
    }
    if (isEditableTarget(e.target)) return;
    if (e.key === '/' || ((e.metaKey || e.ctrlKey) && e.key === 'f')) {
      e.preventDefault();
      searchEl?.focus();
    } else if (/^[1-6]$/.test(e.key) && !e.metaKey && !e.ctrlKey) {
      section = SECTIONS[Number(e.key) - 1].id;
      query = '';
    }
    // Keep shell keys (j/k/a/d…) from reaching the book view underneath.
    e.stopPropagation();
  }

  onMount(() => {
    window.addEventListener('keydown', onKey, true);
    void tick().then(() => searchEl?.focus());
    void loadStorage();
  });
  onDestroy(() => {
    window.removeEventListener('keydown', onKey, true);
    vimrcEd?.destroy();
  });

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
    import('../lib/vimrc-editor.ts')
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

  // ---- appearance -------------------------------------------------------------

  const darkThemes = themeOrder.filter((n) => themes[n].isDark);
  const lightThemes = themeOrder.filter((n) => !themes[n].isDark);
  const MODES: ThemeMode[] = ['auto', 'dark', 'light'];

  // ---- storage --------------------------------------------------------------------

  let usage = $state<{ used: number; quota: number } | null>(null);
  let persisted = $state<boolean | null>(null);
  async function loadStorage(): Promise<void> {
    try {
      const est = await navigator.storage?.estimate?.();
      if (est) usage = { used: est.usage ?? 0, quota: est.quota ?? 0 };
      persisted = (await navigator.storage?.persisted?.()) ?? null;
    } catch {
      usage = null;
    }
  }
  async function requestPersist(): Promise<void> {
    try {
      persisted = (await navigator.storage?.persist?.()) ?? persisted;
    } catch {
      // ignore
    }
  }
  function fmtBytes(n: number): string {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
    return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
  }
  const pendingHere = $derived(books.active?.vault_id ? offline.pendingNotes(books.active.vault_id).length : 0);
  function exportConflicts(): void {
    const items = offline.conflicts.map((c) => ({ vaultID: c.vaultID, noteID: c.noteID, title: c.title, text: c.text }));
    if (items.length) downloadText(exportFilename(items), bundleMarkdown(items));
  }

  function num(e: Event): number {
    return Number((e.currentTarget as HTMLInputElement).value);
  }
  function checked(e: Event): boolean {
    return (e.currentTarget as HTMLInputElement).checked;
  }
</script>

{#snippet overriddenBadge(k: keyof EditorSettings)}
  {#if over(k)}<span class="badge" title="Set by your .vimrc while vim is on">.vimrc</span>{/if}
{/snippet}

<div class="settings" role="dialog" aria-modal="true" aria-label="Settings" data-testid="settings-view">
  <aside class="nav">
    <div class="nav-head">
      <button class="ui-btn ghost sm back" type="button" onclick={close} aria-label="Close settings">
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        Settings
      </button>
      <kbd class="esc">Esc</kbd>
    </div>
    <div class="search">
      <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="m10.5 10.5 3 3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
      <input
        bind:this={searchEl}
        class="search-input"
        type="search"
        placeholder="Search settings"
        aria-label="Search settings"
        bind:value={query}
      />
      <kbd>/</kbd>
    </div>
    <nav class="sections" aria-label="Settings sections">
      {#each SECTIONS as sec, i (sec.id)}
        <button
          type="button"
          class="sec"
          class:active={!matches && section === sec.id}
          class:dim={matches != null && !sectionVisible(sec.id)}
          aria-current={!matches && section === sec.id ? 'page' : undefined}
          onclick={() => { section = sec.id; query = ''; }}
        >
          <span class="sec-label">{sec.label}</span>
          <span class="sec-key">{i + 1}</span>
        </button>
      {/each}
    </nav>
  </aside>

  <main class="body">
    <div class="inner">
      {#if noResults}
        <p class="empty">No settings match “{query}”.</p>
      {/if}

      <!-- ── Editor ─────────────────────────────────────────────── -->
      {#if sectionVisible('editor')}
        <section class="group" aria-labelledby="sec-editor">
          <h2 id="sec-editor">Editor</h2>
          {#if show('editMode')}
            <div class="row">
              <div class="row-text"><span class="row-title">Editing mode</span><span class="row-desc">Live Preview hides markdown syntax off the cursor line; Source shows it raw. <kbd>{keyLabel('⌘⇧E')}</kbd></span></div>
              <div class="ui-seg">
                <button type="button" aria-pressed={s.editMode === 'live'} onclick={() => editorSettings.update({ editMode: 'live' })}>Live Preview</button>
                <button type="button" aria-pressed={s.editMode === 'source'} onclick={() => editorSettings.update({ editMode: 'source' })}>Source</button>
              </div>
            </div>
          {/if}
          {#if show('previewSplit')}
            <label class="row">
              <div class="row-text"><span class="row-title">Show preview beside source</span><span class="row-desc">In Source mode, the rendered note sits to the right and scrolls with the editor. Toggle with <kbd>{'\\'}p</kbd>, <kbd>{keyLabel('⌘⌥P')}</kbd> or <kbd>:preview split</kbd>.</span></div>
              <input type="checkbox" class="ui-switch" checked={s.previewSplit} onchange={(e) => editorSettings.update({ previewSplit: checked(e) })} data-testid="preview-split-toggle" />
            </label>
          {/if}
          {#if show('openIn')}
            <div class="row">
              <div class="row-text"><span class="row-title">Opening a note shows</span><span class="row-desc">What <kbd>⏎</kbd> on a note opens.</span></div>
              <div class="ui-seg">
                <button type="button" aria-pressed={s.openIn === 'reading'} onclick={() => editorSettings.update({ openIn: 'reading' })}>Reading</button>
                <button type="button" aria-pressed={s.openIn === 'editing'} onclick={() => editorSettings.update({ openIn: 'editing' })}>Editor</button>
              </div>
            </div>
          {/if}
          {#if show('prose')}
            <div class="row">
              <div class="row-text"><span class="row-title">Prose font</span><span class="row-desc">Typeface for reading and Live Preview. Source mode is always monospace.</span></div>
              <div class="ui-seg">
                <button type="button" aria-pressed={s.proseFont === 'sans'} onclick={() => editorSettings.update({ proseFont: 'sans' })} style="font-family: var(--font-sans)">Sans</button>
                <button type="button" aria-pressed={s.proseFont === 'serif'} onclick={() => editorSettings.update({ proseFont: 'serif' })} style="font-family: var(--font-serif)">Serif</button>
                <button type="button" aria-pressed={s.proseFont === 'mono'} onclick={() => editorSettings.update({ proseFont: 'mono' })} style="font-family: var(--font-mono)">Mono</button>
              </div>
            </div>
          {/if}
          {#if show('fontSize')}
            <div class="row">
              <div class="row-text"><span class="row-title">Font size</span><span class="row-desc">Editor text size.</span></div>
              <div class="range">
                <input id="es-font" type="range" min={FONT_SIZE_MIN} max={FONT_SIZE_MAX} step="1" value={s.fontSize}
                  aria-label="Font size" oninput={(e) => editorSettings.update({ fontSize: num(e) })} />
                <span class="value">{s.fontSize}px</span>
              </div>
            </div>
          {/if}
          {#if show('readable')}
            <label class="row">
              <div class="row-text"><span class="row-title">Readable line length</span><span class="row-desc">Keep the text column around 70 characters wide.</span></div>
              <input type="checkbox" class="ui-switch" checked={s.readableWidth} onchange={(e) => editorSettings.update({ readableWidth: checked(e) })} />
            </label>
          {/if}
          {#if show('wrap')}
            <label class="row">
              <div class="row-text"><span class="row-title">Wrap long lines {@render overriddenBadge('lineWrapping')}</span></div>
              <input type="checkbox" class="ui-switch" checked={eff.lineWrapping} disabled={over('lineWrapping')} onchange={(e) => editorSettings.update({ lineWrapping: checked(e) })} />
            </label>
          {/if}
          {#if show('gutter')}
            <label class="row">
              <div class="row-text"><span class="row-title">Line numbers {@render overriddenBadge('lineNumbers')}</span></div>
              <input type="checkbox" class="ui-switch" checked={eff.lineNumbers} disabled={over('lineNumbers')} onchange={(e) => editorSettings.update({ lineNumbers: checked(e) })} />
            </label>
            <label class="row">
              <div class="row-text"><span class="row-title">Relative line numbers {@render overriddenBadge('relativeLineNumbers')}</span><span class="row-desc">Distance from the cursor line, for <kbd>5j</kbd>-style motions.</span></div>
              <input type="checkbox" class="ui-switch" checked={eff.relativeLineNumbers} disabled={over('relativeLineNumbers')} onchange={(e) => editorSettings.update({ relativeLineNumbers: checked(e) })} />
            </label>
          {/if}
          {#if show('tabSize')}
            <div class="row">
              <div class="row-text"><span class="row-title">Tab size {@render overriddenBadge('tabSize')}</span><span class="row-desc">{over('tabSize') ? `tabstop=${eff.tabSize}, shiftwidth=${eff.indentWidth}` : 'Spaces per indent level.'}</span></div>
              <div class="ui-seg">
                {#each TAB_SIZES as n (n)}
                  <button type="button" disabled={over('tabSize')} aria-pressed={eff.tabSize === n} onclick={() => editorSettings.update({ tabSize: n })}>{n}</button>
                {/each}
              </div>
            </div>
          {/if}
        </section>
      {/if}

      <!-- ── Vim ──────────────────────────────────────────────────── -->
      {#if sectionVisible('vim')}
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
      {/if}

      <!-- ── Appearance ───────────────────────────────────────────── -->
      {#if sectionVisible('appearance')}
        <section class="group" aria-labelledby="sec-appearance">
          <h2 id="sec-appearance">Appearance</h2>
          {#if show('themeMode')}
            <div class="row">
              <div class="row-text"><span class="row-title">Theme</span><span class="row-desc">Auto follows the system light/dark setting.</span></div>
              <div class="ui-seg">
                {#each MODES as m (m)}
                  <button type="button" aria-pressed={theme.settings.mode === m} onclick={() => theme.setMode(m)}>{m}</button>
                {/each}
              </div>
            </div>
          {/if}
          {#if show('themes')}
            {#each [{ label: 'Dark theme', list: darkThemes, cur: theme.settings.darkName, set: (n: string) => theme.setDarkName(n) }, { label: 'Light theme', list: lightThemes, cur: theme.settings.lightName, set: (n: string) => theme.setLightName(n) }] as grp (grp.label)}
              <div class="row stack">
                <div class="row-text"><span class="row-title">{grp.label}</span></div>
                <div class="swatches">
                  {#each grp.list as name (name)}
                    {@const th = themes[name]}
                    <button type="button" class="swatch" class:on={grp.cur === name} aria-pressed={grp.cur === name} onclick={() => grp.set(name)}
                      style="--sw-bg: {th.background}; --sw-fg: {th.text}; --sw-a: {th.primary}; --sw-b: {th.secondary}; --sw-c: {th.accent}; --sw-line: {th.border}">
                      <span class="sw-preview"><span class="sw-bar"></span><span class="sw-bar short"></span><span class="sw-dots"><i></i><i></i><i></i></span></span>
                      <span class="sw-name">{name}</span>
                    </button>
                  {/each}
                </div>
              </div>
            {/each}
          {/if}
          {#if show('legend')}
            <label class="row">
              <div class="row-text"><span class="row-title">Command legend</span><span class="row-desc">A one-line strip above the status bar with the keys for what you are doing now (explorer, reader, vim normal/insert/visual), and completions after <kbd>g</kbd>, <kbd>z</kbd> or the leader.</span></div>
              <input type="checkbox" class="ui-switch" checked={s.legend} onchange={(e) => editorSettings.update({ legend: checked(e) })} data-testid="legend-toggle" />
            </label>
          {/if}
          {#if show('motion')}
            <label class="row">
              <div class="row-text"><span class="row-title">Reduce motion</span><span class="row-desc">Turns off view transitions and UI animation. Always on when your system asks for reduced motion.</span></div>
              <input type="checkbox" class="ui-switch" checked={s.reduceMotion} onchange={(e) => editorSettings.update({ reduceMotion: checked(e) })} data-testid="reduce-motion-toggle" />
            </label>
          {/if}
        </section>
      {/if}

      <!-- ── Keys ─────────────────────────────────────────────────── -->
      {#if sectionVisible('keys')}
        <section class="group" aria-labelledby="sec-keys">
          <h2 id="sec-keys">Keys</h2>
          {#if show('keysLegend')}
            <label class="row">
              <div class="row-text"><span class="row-title">Show the command legend</span><span class="row-desc">Press <kbd>?</kbd> anywhere for the full map. Settings open with <kbd>,</kbd> outside text fields, <kbd>:settings</kbd> in the editor, or the command palette.</span></div>
              <input type="checkbox" class="ui-switch" checked={s.legend} onchange={(e) => editorSettings.update({ legend: checked(e) })} />
            </label>
          {/if}
          {#if show('keymap')}
            <div class="keymap">
              {#each KEYMAP as sec (sec.title)}
                <div class="km-sec">
                  <h3 class="ui-eyebrow">{sec.title}</h3>
                  <dl>
                    {#each sec.rows as [k, label] (k)}
                      <dt class="mono">{k}</dt>
                      <dd>{label}</dd>
                    {/each}
                  </dl>
                </div>
              {/each}
            </div>
          {/if}
        </section>
      {/if}

      <!-- ── Offline & storage ────────────────────────────────────── -->
      {#if sectionVisible('storage')}
        <section class="group" aria-labelledby="sec-storage">
          <h2 id="sec-storage">Offline &amp; storage</h2>
          {#if show('storage')}
            <div class="row">
              <div class="row-text">
                <span class="row-title">Space used on this device</span>
                <span class="row-desc">Offline copies of opened notes, cached note lists and settings, in this browser only.</span>
              </div>
              <span class="value">{usage ? `${fmtBytes(usage.used)} of ${fmtBytes(usage.quota)}` : '—'}</span>
            </div>
            <div class="row">
              <div class="row-text">
                <span class="row-title">Keep offline data</span>
                <span class="row-desc">{persisted ? 'The browser will not evict lumi’s offline copies under storage pressure.' : 'Ask the browser not to evict offline copies when space runs low.'}</span>
              </div>
              {#if persisted}<span class="value ok">persistent</span>{:else}<button class="ui-btn sm" type="button" onclick={() => void requestPersist()}>Make persistent</button>{/if}
            </div>
            {#if books.active}
              <div class="row">
                <div class="row-text"><span class="row-title">Pending in {books.active.name}</span><span class="row-desc">Notes edited offline that have not reached the server yet.</span></div>
                <span class="value">{pendingHere}</span>
              </div>
            {/if}
          {/if}
          {#if show('conflicts')}
            <div class="row">
              <div class="row-text"><span class="row-title">Conflict copies</span><span class="row-desc">Local text that could not be merged (note deleted, another version). Never merged silently.</span></div>
              <span class="row-ctl">
                <span class="value">{offline.conflicts.length}</span>
                <button class="ui-btn sm" type="button" disabled={offline.conflicts.length === 0} onclick={exportConflicts}>Download all</button>
              </span>
            </div>
          {/if}
        </section>
      {/if}

      <!-- ── Account ──────────────────────────────────────────────── -->
      {#if sectionVisible('account')}
        <section class="group" aria-labelledby="sec-account">
          <h2 id="sec-account">Account</h2>
          {#if show('accounts')}
            <ul class="accounts">
              {#each accounts.list as a (a.key)}
                <li>
                  <span class="avatar" aria-hidden="true">{(a.display_name || a.username).slice(0, 1).toUpperCase()}</span>
                  <span class="acct-main">
                    <span class="acct-name">{a.display_name || a.username}</span>
                    <span class="row-desc">{a.username} @ {serverLabel(a.server_url)}{a.remember ? ' · remembered' : ' · this tab only'}</span>
                  </span>
                  {#if a.status === 'needs_login'}
                    <button class="ui-btn sm" type="button" onclick={() => uiState.openSignIn(a.server_url, a.username)}>Entrar</button>
                  {:else}
                    <span class="value ok">signed in</span>
                  {/if}
                </li>
              {/each}
            </ul>
            <div class="row">
              <div class="row-text"><span class="row-title">Books &amp; accounts</span><span class="row-desc">Add a server, sign out of this device (with an export of unsent text), manage books.</span></div>
              <span class="row-ctl">
                <button class="ui-btn sm" type="button" onclick={() => uiState.openAddServer()}>Add server</button>
                <button class="ui-btn sm" type="button" onclick={() => { close(); books.openPicker(); }}>Open books</button>
              </span>
            </div>
          {/if}
        </section>
      {/if}
    </div>
  </main>
</div>

<style>
  .settings {
    position: fixed;
    inset: 0;
    z-index: 150;
    display: grid;
    grid-template-columns: 240px minmax(0, 1fr);
    background: var(--color-background);
    color: var(--color-text);
    animation: ui-fade 120ms var(--ease);
  }
  .nav {
    display: flex;
    flex-direction: column;
    gap: var(--sp-3);
    padding: var(--sp-3);
    border-right: 1px solid var(--hairline);
    background: color-mix(in srgb, var(--color-overlay-bg) 40%, var(--color-background));
    min-height: 0;
  }
  .nav-head { display: flex; align-items: center; justify-content: space-between; }
  .back { font-weight: 600; color: var(--color-text); gap: 6px; padding-left: 4px; }
  .esc { opacity: 0.7; }
  .search {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    height: 32px;
    padding: 0 var(--sp-2);
    border-radius: var(--radius-sm);
    border: 1px solid var(--hairline);
    background: var(--color-background);
    color: var(--color-text-dim);
  }
  .search:focus-within { border-color: var(--color-primary); box-shadow: 0 0 0 3px var(--tint-primary); }
  .search-input {
    flex: 1;
    min-width: 0;
    border: none;
    outline: none;
    background: transparent;
    font-size: var(--text-sm);
    color: var(--color-text);
  }
  .search-input::-webkit-search-cancel-button { display: none; }
  .sections { display: flex; flex-direction: column; gap: 1px; }
  .sec {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 30px;
    padding: 0 var(--sp-2);
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text-dim);
    font-size: var(--text-sm);
    text-align: left;
    cursor: pointer;
  }
  .sec:hover { background: var(--tint-hover); color: var(--color-text); }
  .sec.active { background: var(--tint-active); color: var(--color-text); font-weight: 550; }
  .sec.dim { opacity: 0.4; }
  .sec-key { font-family: var(--font-mono); font-size: var(--text-2xs); opacity: 0.6; }

  .body { overflow-y: auto; min-height: 0; }
  .inner {
    max-width: 760px;
    margin: 0 auto;
    padding: var(--sp-6) var(--sp-5) 20vh;
    display: flex;
    flex-direction: column;
    gap: var(--sp-6);
  }
  .empty { color: var(--color-text-dim); }
  .group h2 {
    font-size: var(--text-lg);
    font-weight: 650;
    letter-spacing: -0.01em;
    margin-bottom: var(--sp-2);
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-5);
    padding: var(--sp-3) 0;
    border-bottom: 1px solid var(--hairline);
  }
  label.row { cursor: pointer; }
  .row.stack { flex-direction: column; align-items: stretch; gap: var(--sp-3); }
  .row-text { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
  .row-title { font-size: var(--text-md); font-weight: 500; display: inline-flex; align-items: center; gap: var(--sp-2); }
  .row-desc { font-size: var(--text-xs); color: var(--color-text-dim); line-height: 1.55; }
  .row-desc code, .row-desc kbd { font-size: 10.5px; }
  code {
    font-family: var(--font-mono);
    font-size: 0.92em;
    padding: 0 3px;
    border-radius: 3px;
    background: var(--tint-hover);
  }
  .row-ctl { display: inline-flex; gap: var(--sp-2); align-items: center; flex: none; }
  .badge {
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 500;
    padding: 1px 5px;
    border-radius: 4px;
    color: var(--color-secondary);
    background: color-mix(in srgb, var(--color-secondary) 14%, transparent);
  }
  .range { display: inline-flex; align-items: center; gap: var(--sp-3); flex: none; }
  .range input { width: 160px; accent-color: var(--color-primary); }
  .value { font-family: var(--font-mono); font-size: var(--text-xs); color: var(--color-text-dim); min-width: 3.5em; text-align: right; white-space: nowrap; }
  .value.ok { color: var(--color-primary); }
  .mono { font-family: var(--font-mono); }
  .err { color: var(--color-error); font-size: var(--text-xs); }

  .chips { display: flex; flex-wrap: wrap; gap: var(--sp-2); align-items: center; }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 28px;
    padding: 0 var(--sp-3);
    border-radius: 999px;
    border: 1px solid var(--hairline);
    background: transparent;
    font-size: var(--text-sm);
    color: var(--color-text-dim);
    cursor: pointer;
  }
  .chip.on {
    background: var(--tint-active);
    border-color: color-mix(in srgb, var(--color-primary) 45%, transparent);
    color: var(--color-text);
    cursor: default;
    font-weight: 600;
  }
  .chip.on button { border: none; background: none; color: var(--color-text-dim); cursor: pointer; font-size: 15px; line-height: 1; }
  .chip.on button:hover { color: var(--color-error); }
  .chip.add:hover { color: var(--color-text); border-color: var(--color-primary); }
  .chip.add:disabled { opacity: 0.4; cursor: not-allowed; }
  .chip-input { width: 96px; height: 28px; border-radius: 999px; font-size: var(--text-sm); }

  .vimrc-host { min-height: 220px; }
  .vimrc-fallback { height: 260px; padding: var(--sp-2); resize: vertical; font-size: 12.5px; line-height: 1.6; }
  .vimrc-bar { display: flex; justify-content: space-between; align-items: center; gap: var(--sp-3); flex-wrap: wrap; }
  .vimrc-stats { font-size: var(--text-xs); color: var(--color-text-dim); }
  .vimrc-stats .e { color: var(--color-error); }
  .vimrc-stats .w { color: var(--color-warning); }
  .vimrc-stats .bytes { opacity: 0.7; }
  .vimrc-actions { display: inline-flex; gap: var(--sp-2); }
  kbd.on-primary { background: transparent; color: inherit; border-color: color-mix(in srgb, var(--color-background) 40%, transparent); }
  .diags { list-style: none; display: flex; flex-direction: column; gap: 2px; font-size: var(--text-xs); }
  .diag { display: flex; gap: var(--sp-2); }
  .diag .line { font-family: var(--font-mono); font-size: var(--text-2xs); min-width: 4.5em; text-align: left; }
  .diag.error span { color: var(--color-error); }
  .diag.warning span { color: var(--color-warning); }
  .diag.info span { color: var(--color-text-dim); }
  .effective summary { cursor: pointer; font-size: var(--text-xs); color: var(--color-text-dim); }
  .effective table { margin-top: var(--sp-2); font-size: var(--text-xs); border-collapse: collapse; }
  .effective td { padding: 2px var(--sp-3) 2px 0; }
  .mode { color: var(--color-text-dim); font-family: var(--font-mono); font-size: var(--text-2xs); }
  .arrow { color: var(--color-text-dim); }

  .maps { list-style: none; display: flex; flex-direction: column; gap: 2px; }
  .maps li { display: flex; align-items: center; gap: var(--sp-3); font-size: var(--text-sm); }
  .maps li .ui-btn { margin-left: auto; }
  .map-form { display: grid; grid-template-columns: 110px 1fr 1fr auto auto; gap: var(--sp-2); align-items: center; }
  .map-form .ui-input { height: 30px; font-size: var(--text-sm); }
  .inline { display: inline-flex; gap: 6px; align-items: center; font-size: var(--text-xs); color: var(--color-text-dim); }

  .swatches { display: grid; grid-template-columns: repeat(auto-fill, minmax(128px, 1fr)); gap: var(--sp-2); }
  .swatch {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 6px;
    border-radius: var(--radius);
    border: 1px solid var(--hairline);
    background: transparent;
    cursor: pointer;
    text-align: left;
  }
  .swatch:hover { border-color: var(--color-text-dim); }
  .swatch.on { border-color: var(--color-primary); box-shadow: 0 0 0 2px var(--tint-primary); }
  .sw-preview {
    height: 46px;
    border-radius: 5px;
    background: var(--sw-bg);
    border: 1px solid var(--sw-line);
    padding: 7px 8px;
    display: flex;
    flex-direction: column;
    gap: 5px;
    position: relative;
  }
  .sw-bar { height: 4px; width: 70%; border-radius: 2px; background: var(--sw-fg); opacity: 0.85; }
  .sw-bar.short { width: 45%; opacity: 0.45; }
  .sw-dots { position: absolute; right: 7px; bottom: 7px; display: flex; gap: 3px; }
  .sw-dots i { width: 7px; height: 7px; border-radius: 50%; background: var(--sw-a); }
  .sw-dots i:nth-child(2) { background: var(--sw-b); }
  .sw-dots i:nth-child(3) { background: var(--sw-c); }
  .sw-name { font-size: var(--text-xs); color: var(--color-text-dim); padding: 0 2px; }
  .swatch.on .sw-name { color: var(--color-text); }

  .keymap { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: var(--sp-5); margin-top: var(--sp-3); }
  .km-sec h3 { margin-bottom: var(--sp-2); font-weight: 500; }
  .km-sec dl { display: grid; grid-template-columns: max-content 1fr; gap: 5px var(--sp-4); font-size: var(--text-sm); }
  .km-sec dt { color: var(--color-text); font-size: var(--text-xs); white-space: nowrap; }
  .km-sec dd { color: var(--color-text-dim); }

  .accounts { list-style: none; display: flex; flex-direction: column; }
  .accounts li { display: flex; align-items: center; gap: var(--sp-3); padding: var(--sp-3) 0; border-bottom: 1px solid var(--hairline); }
  .avatar {
    width: 30px; height: 30px; border-radius: 50%; display: grid; place-items: center; flex: none;
    font-weight: 600; font-size: var(--text-sm);
    color: var(--color-secondary); background: color-mix(in srgb, var(--color-secondary) 12%, transparent);
  }
  .acct-main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .acct-name { font-weight: 550; }

  @media (max-width: 720px) {
    .settings { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr); }
    .nav { border-right: none; border-bottom: 1px solid var(--hairline); padding-bottom: var(--sp-2); }
    .sections { flex-direction: row; overflow-x: auto; gap: var(--sp-1); }
    .sec { flex: none; }
    .sec-key { display: none; }
    .inner { padding: var(--sp-5) var(--sp-4) 20vh; }
    .row { gap: var(--sp-3); }
    .map-form { grid-template-columns: 1fr 1fr; }
    .range input { width: 110px; }
  }
</style>
