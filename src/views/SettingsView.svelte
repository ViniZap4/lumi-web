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
  import { uiState, type SettingsSection } from '../lib/uistate.svelte.ts';
  import { isEditableTarget } from '../lib/shortcuts.ts';
  import EditorSection from './settings/EditorSection.svelte';
  import VimSection from './settings/VimSection.svelte';
  import AppearanceSection from './settings/AppearanceSection.svelte';
  import KeysSection from './settings/KeysSection.svelte';
  import StorageSection from './settings/StorageSection.svelte';
  import AccountSection from './settings/AccountSection.svelte';
  import { DeviceStorage } from './settings/storage.svelte.ts';

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
    readingWidth: ['editor', 'reading width largura de leitura measure column narrow medium wide full space'],
    density: ['editor', 'density densidade compact comfortable rows explorer list space'],
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
    paneNav: ['keys', 'panes ctrl-h ctrl-j ctrl-k ctrl-l ctrl-w window split navigate focus tmux'],
    previewCursor: ['keys', 'split preview cursor line return editor sync'],
    hoverPreview: ['keys', 'hover link preview card popup K peek'],
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
    void storage.load();
  });
  onDestroy(() => {
    window.removeEventListener('keydown', onKey, true);
  });

  // ---- storage (loaded once, shown by the storage section) ----------
  const storage = new DeviceStorage();
</script>

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
        <EditorSection {show} />
      {/if}

      <!-- ── Vim ──────────────────────────────────────────────────── -->
      {#if sectionVisible('vim')}
        <VimSection {show} />
      {/if}

      <!-- ── Appearance ───────────────────────────────────────────── -->
      {#if sectionVisible('appearance')}
        <AppearanceSection {show} />
      {/if}

      <!-- ── Keys ─────────────────────────────────────────────────── -->
      {#if sectionVisible('keys')}
        <KeysSection {show} />
      {/if}

      <!-- ── Offline & storage ────────────────────────────────────── -->
      {#if sectionVisible('storage')}
        <StorageSection {show} {storage} />
      {/if}

      <!-- ── Account ──────────────────────────────────────────────── -->
      {#if sectionVisible('account')}
        <AccountSection {show} />
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
  @media (max-width: 720px) {
    .settings { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr); }
  }

  /* Everything inside, including the section components. */
  .settings :global {
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
      .nav { border-right: none; border-bottom: 1px solid var(--hairline); padding-bottom: var(--sp-2); }
      .sections { flex-direction: row; overflow-x: auto; gap: var(--sp-1); }
      .sec { flex: none; }
      .sec-key { display: none; }
      .inner { padding: var(--sp-5) var(--sp-4) 20vh; }
      .row { gap: var(--sp-3); }
      .map-form { grid-template-columns: 1fr 1fr; }
      .range input { width: 110px; }
    }
  }
</style>
