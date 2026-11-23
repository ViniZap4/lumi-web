<script lang="ts" module>
  import { Vim } from '@replit/codemirror-vim';
  import { installYankFlash } from '../lib/yank-flash.ts';
  import { motionAllowed } from '../lib/motion.ts';

  // Vim ex commands are registered globally on the Vim singleton, so
  // they dispatch to whichever editor is currently mounted.
  let activeExit: (() => void) | null = null;
  let activeSettings: (() => void) | null = null;
  let activeToggleMode: (() => void) | null = null;
  let activeLink: (() => void) | null = null;
  let activeSplit: (() => void) | null = null;
  let vimExRegistered = false;
  function registerVimEx(): void {
    if (vimExRegistered) return;
    vimExRegistered = true;
    const exit = () => activeExit?.();
    // Edits are already persisted live; :w / :wq / :x just exit or no-op.
    Vim.defineEx('quit', 'q', exit);
    Vim.defineEx('wq', 'wq', exit);
    Vim.defineEx('xit', 'x', exit);
    Vim.defineEx('write', 'w', () => {});
    // :settings opens the editor settings; :preview flips live/source.
    Vim.defineEx('settings', 'settings', () => activeSettings?.());
    // `:preview split` toggles the side-by-side preview (Source mode).
    Vim.defineEx('preview', 'preview', (_cm: unknown, params: { args?: string[] }) => {
      if (params?.args?.[0] === 'split') activeSplit?.();
      else activeToggleMode?.();
    });
    // :link (and the default <leader>l) opens the markdown link helper.
    Vim.defineEx('link', 'link', () => activeLink?.());
    // Neovim-style yank highlight (purely visual).
    installYankFlash(Vim as never, () => !motionAllowed());
  }
</script>

<script lang="ts">
  import { onMount, onDestroy, untrack } from 'svelte';
  import {
    EditorView,
    keymap,
    lineNumbers,
    highlightActiveLine,
    highlightActiveLineGutter,
    drawSelection,
    type ViewUpdate,
  } from '@codemirror/view';
  import { EditorState, Compartment, Prec, type Extension } from '@codemirror/state';
  import { defaultKeymap } from '@codemirror/commands';
  import { searchKeymap } from '@codemirror/search';
  import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
  import { languages } from '@codemirror/language-data';
  import { syntaxHighlighting, indentUnit, codeFolding, foldGutter } from '@codemirror/language';
  import { yankFlash } from '../lib/yank-flash.ts';
  import { editorKeymap, vimInsertKeys } from '../lib/editor-keys.ts';
  import { vim, getCM } from '@replit/codemirror-vim';
  import { yCollab } from 'y-codemirror.next';
  import type { EditorSession } from '../lib/editor-session.svelte.ts';
  import type { EditorSettings } from '../lib/editor-settings.ts';
  import type { NoteSummary } from '../lib/types.ts';
  import { applyVimConfig, appliedMappings, effectiveSettings, feedLeader, leaderKeyName, type EffectiveSettings } from '../lib/vim-config.ts';
  import { PaneKeys, editorPaneRoute, fallsThroughWithoutTarget, vimMidCommand, type PaneDir, type VimModeName } from '../lib/pane-nav.ts';
  import { livePreview, noteLinkHandler } from '../lib/live-preview.ts';
  import { linkHelper, insertLink } from '../lib/link-helper.ts';
  import { relativeLineNumbers } from '../lib/editor-gutter.ts';
  import { countWords, type EditorStats } from '../lib/textstats.ts';
  import { lumiHighlightStyle } from '../lib/editor-highlight.ts';

  type Props = {
    session: EditorSession;
    settings: EditorSettings;
    /** Explicit "leave the editor" command (vim `:q`, Mod-Enter,
     *  Mod-E → reading view). Esc is NOT an exit: in vim it leaves
     *  insert mode. */
    onexit?: () => void;
    onopensettings?: () => void;
    ontogglemode?: () => void;
    /** Toggle the split preview (`:preview split`, `<leader>p`). */
    ontogglesplit?: () => void;
    onstats?: (s: EditorStats) => void;
    /** Notes of the book (link helper candidates). */
    notes?: () => readonly NoteSummary[];
    /** Path of this note (links are relative to it). */
    notePath?: () => string;
    /** Open a relative note link (Ctrl/Cmd+click in Live Preview). */
    onopennote?: (href: string) => void;
    /** Vim mode + pending keys, for the command legend. */
    onvimstate?: (s: { mode: string; pending: string | null; sub?: string | null }) => void;
    /** Pane navigation (Ctrl-h/j/k/l, Ctrl-w …) in NORMAL/VISUAL.
     *  Returns false when no pane lies that way. */
    onpane?: (dir: PaneDir) => boolean;
    /** A `Ctrl-w` prefix is armed / done (legend). */
    onpanepending?: (pending: boolean) => void;
  };

  const { session, settings, onexit, onopensettings, ontogglemode, ontogglesplit, onstats, notes, notePath, onopennote, onvimstate, onpane, onpanepending }: Props = $props();
  const paneKeys = new PaneKeys();

  // The vimrc's `set` options override the device settings while vim
  // is on; leader + maps come from the same parse.
  const eff: EffectiveSettings = $derived(effectiveSettings(settings));

  let container: HTMLDivElement | null = $state(null);

  // Editor chrome. Colours are theme tokens (see app.css for the Live
  // Preview prose styles); layout keeps the text in a centred writing
  // column with the gutter hugging it, while the scrollbar stays at
  // the pane edge.
  const mono = 'var(--font-mono)';
  const EDITOR_THEME = {
    '&': {
      height: '100%',
      fontFamily: 'var(--editor-font, var(--prose-font))',
      background: 'transparent',
      color: 'var(--color-text)',
    },
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': {
      fontFamily: 'inherit',
      lineHeight: 'var(--editor-leading, var(--prose-leading))',
      padding: '0 var(--editor-pad-x, 24px)',
      overscrollBehavior: 'contain',
    },
    // Centre content (and the gutter beside it): the free space goes
    // to the gutter's left margin and the content's right margin.
    '.cm-content': {
      maxWidth: 'var(--editor-measure, none)',
      marginInline: 'auto',
      padding: 'var(--editor-pad-top, 40px) 0 40vh',
      caretColor: 'var(--color-primary)',
    },
    '.cm-gutters ~ .cm-content': { marginLeft: '0' },
    '.cm-line': { padding: '0 1px' },
    '.cm-gutters': {
      marginLeft: 'auto',
      paddingTop: 'var(--editor-pad-top, 40px)',
      background: 'transparent',
      color: 'var(--md-marker)',
      border: 'none',
      fontFamily: mono,
      fontSize: '0.74em',
      fontVariantNumeric: 'tabular-nums',
    },
    '.cm-lineNumbers .cm-gutterElement': { padding: '0 10px 0 6px', minWidth: '28px', opacity: '0.75' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--color-text)' },
    '.cm-lineNumbers .cm-activeLineGutter': { opacity: '1' },
    '.cm-foldGutter .cm-gutterElement': { padding: '0 6px 0 2px', display: 'flex', alignItems: 'center', justifyContent: 'center' },
    '.cm-fold-marker': { display: 'inline-flex', color: 'var(--md-marker)', opacity: '0', cursor: 'pointer', transition: 'opacity 120ms, transform 120ms' },
    '.cm-fold-marker[data-open="true"]': { transform: 'rotate(90deg)' },
    '.cm-fold-marker[data-open="false"]': { opacity: '1', color: 'var(--color-primary)' },
    '.cm-gutters:hover .cm-fold-marker': { opacity: '1' },
    '.cm-foldPlaceholder': {
      margin: '0 0.35em',
      padding: '0 0.5em',
      border: '1px solid var(--md-rule)',
      borderRadius: '999px',
      background: 'var(--md-inline-bg)',
      color: 'var(--md-dim)',
      fontFamily: mono,
      fontSize: '0.8em',
      cursor: 'pointer',
    },
    // Translucent bands only, so the selection layer (drawn beneath the
    // text) is never covered.
    '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--color-text) 3.5%, transparent)', borderRadius: '3px' },
    '.cm-cursor, .cm-dropCursor': { borderLeft: '2px solid var(--color-primary)' },
    '.cm-fat-cursor': { background: 'color-mix(in srgb, var(--color-primary) 80%, transparent) !important', color: 'var(--color-background) !important', borderRadius: '1px' },
    '&:not(.cm-focused) .cm-fat-cursor': { background: 'none !important', outline: '1px solid var(--color-primary) !important' },
    '.cm-selectionLayer .cm-selectionBackground': { background: 'var(--editor-selection-blur) !important' },
    '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': { background: 'var(--editor-selection) !important' },
    '.cm-selectionMatch': { backgroundColor: 'color-mix(in srgb, var(--color-primary) 12%, transparent)' },
    '.cm-searchMatch': {
      backgroundColor: 'color-mix(in srgb, var(--color-warning) 26%, transparent)',
      outline: '1px solid color-mix(in srgb, var(--color-warning) 55%, transparent)',
      borderRadius: '2px',
    },
    '.cm-searchMatch.cm-searchMatch-selected, .cm-searchMatch-selected': { backgroundColor: 'color-mix(in srgb, var(--color-primary) 34%, transparent)', outlineColor: 'var(--color-primary)' },
    '&.cm-focused .cm-matchingBracket': { backgroundColor: 'color-mix(in srgb, var(--color-accent) 22%, transparent)', outline: '1px solid color-mix(in srgb, var(--color-accent) 50%, transparent)' },
    '&.cm-focused .cm-nonmatchingBracket': { backgroundColor: 'color-mix(in srgb, var(--color-error) 22%, transparent)' },
    '.cm-yank-flash': {
      backgroundColor: 'color-mix(in srgb, var(--color-accent) 38%, transparent)',
      borderRadius: '2px',
      animation: 'cm-yank-fade 220ms ease-out forwards',
    },
    '@keyframes cm-yank-fade': {
      from: { backgroundColor: 'color-mix(in srgb, var(--color-accent) 45%, transparent)' },
      to: { backgroundColor: 'color-mix(in srgb, var(--color-accent) 0%, transparent)' },
    },
    '.cm-ySelectionCaret': { borderLeftWidth: '2px' },
    '.cm-ySelectionInfo': { fontFamily: 'var(--font-sans)', fontSize: '11px', fontWeight: '600', padding: '1px 5px', borderRadius: '4px 4px 4px 0', top: '-1.4em' },
    '.cm-panels': {
      background: 'color-mix(in srgb, var(--color-overlay-bg) 70%, var(--color-background))',
      color: 'var(--color-text)',
      fontFamily: mono,
      fontSize: '13px',
    },
    '.cm-panels-bottom': { borderTop: '1px solid var(--hairline)' },
    '.cm-vim-panel': { padding: '0 var(--editor-pad-x, 24px)', minHeight: '30px', alignItems: 'center' },
    '.cm-vim-panel input': { color: 'var(--color-text)', background: 'transparent', font: 'inherit' },
    '.cm-tooltip': {
      background: 'var(--color-background)',
      border: '1px solid var(--hairline)',
      borderRadius: 'var(--radius)',
      boxShadow: 'var(--shadow-pop)',
      overflow: 'hidden',
    },
  };
  let view: EditorView | null = null;

  const vimC = new Compartment();
  const gutterC = new Compartment();
  const wrapC = new Compartment();
  const previewC = new Compartment();
  const tabC = new Compartment();
  const fontC = new Compartment();
  const activeLineC = new Compartment();
  const keysC = new Compartment();

  function baseKeys(s: EffectiveSettings): Extension {
    const insert = s.vim ? vimInsertKeys((v) => !!(getCM(v)?.state.vim as { insertMode?: boolean } | undefined)?.insertMode) : [];
    return keymap.of([...insert, ...editorKeymap(defaultKeymap, s.vim), ...searchKeymap]);
  }

  function vimExt(s: EffectiveSettings): Extension {
    // No vim status panel: the mode pill lives in the status bar and
    // pending keys in the legend. `:` and `/` still open their prompt.
    return s.vim ? vim({ status: false }) : [];
  }
  function foldMarker(open: boolean): HTMLElement {
    const el = document.createElement('span');
    el.className = 'cm-fold-marker';
    el.dataset.open = String(open);
    el.title = open ? 'Fold (za)' : 'Unfold (za)';
    el.innerHTML = '<svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true"><path d="M5.5 3.5 10 8l-4.5 4.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    return el;
  }
  function gutterExt(s: EffectiveSettings): Extension {
    const numbers = s.relativeLineNumbers ? relativeLineNumbers() : s.lineNumbers ? lineNumbers() : [];
    // Fold chevrons in Source (headings, lists, code); they show on hover.
    const folds = s.editMode === 'source' ? foldGutter({ markerDOM: foldMarker }) : [];
    const active = s.lineNumbers || s.relativeLineNumbers ? highlightActiveLineGutter() : [];
    return [numbers, folds, active];
  }
  function wrapExt(s: EffectiveSettings): Extension {
    return s.lineWrapping ? EditorView.lineWrapping : [];
  }
  function previewExt(s: EffectiveSettings): Extension {
    return s.editMode === 'live' ? livePreview() : [];
  }
  function tabExt(s: EffectiveSettings): Extension {
    return [EditorState.tabSize.of(s.tabSize), indentUnit.of(s.indentWithSpaces ? ' '.repeat(s.indentWidth) : '\t')];
  }
  function fontExt(s: EffectiveSettings): Extension {
    // Live Preview = the reader's prose size, scaled by the setting
    // (15 is the default, so defaults match the reader exactly).
    // Source is monospace, optically ~7% smaller for the same size.
    const size = s.editMode === 'live'
      ? `calc(var(--prose-size) * ${s.fontSize / 15})`
      : `${Math.round(s.fontSize * 0.93 * 10) / 10}px`;
    return EditorView.theme({ '&': { fontSize: size } });
  }
  function activeLineExt(s: EffectiveSettings): Extension {
    // The active-line band fights Live Preview's line styling (code
    // blocks, quotes); keep it for Source mode only.
    return s.editMode === 'source' ? highlightActiveLine() : [];
  }

  let statsTimer: ReturnType<typeof setTimeout> | null = null;
  function emitStats(): void {
    if (!view || !onstats) return;
    const st = view.state;
    const head = st.selection.main.head;
    const line = st.doc.lineAt(head);
    onstats({
      words: countWords(st.doc.toString()),
      chars: st.doc.length,
      line: line.number,
      col: head - line.from + 1,
    });
  }
  function scheduleStats(u: ViewUpdate): void {
    if (!u.docChanged && !u.selectionSet) return;
    if (statsTimer) clearTimeout(statsTimer);
    statsTimer = setTimeout(emitStats, u.docChanged ? 250 : 60);
  }

  onMount(() => {
    if (!container) return;
    mountEditor();
    return () => destroyEditor();
  });

  onDestroy(() => destroyEditor());

  // Live-apply settings changes to the mounted editor.
  $effect(() => {
    const s = eff;
    // Touch every field so the effect tracks them all.
    void [s.vim, s.lineNumbers, s.relativeLineNumbers, s.lineWrapping, s.editMode, s.tabSize, s.fontSize, s.indentWidth, s.indentWithSpaces];
    void [s.escapeSequences.length, s.mappings.length, s.escapeTimeout, s.vimrc];
    applyVimConfig(Vim, s);
    if (!view) return;
    view.dispatch({
      effects: [
        vimC.reconfigure(vimExt(s)),
        gutterC.reconfigure(gutterExt(s)),
        wrapC.reconfigure(wrapExt(s)),
        previewC.reconfigure(previewExt(s)),
        tabC.reconfigure(tabExt(s)),
        fontC.reconfigure(fontExt(s)),
        activeLineC.reconfigure(activeLineExt(s)),
        keysC.reconfigure(baseKeys(s)),
      ],
    });
  });

  function mountEditor(): void {
    if (!container || view) return;
    // Only ever mount on a synced session (the view gates on
    // session.synced). The CodeMirror doc MUST start equal to the
    // Y.Text: y-codemirror.next's ySync only forwards *deltas*, so an
    // empty CM doc over a non-empty Y.Text would apply every later
    // remote delta at the wrong offsets.
    const initialDoc = session.ytext.toString();
    registerVimEx();
    applyVimConfig(Vim, eff);
    activeExit = () => onexit?.();
    activeSettings = () => onopensettings?.();
    activeToggleMode = () => ontogglemode?.();
    activeLink = () => {
      if (view) insertLink(view, linkDeps);
    };
    activeSplit = () => ontogglesplit?.();

    const s = eff;
    // Order matters: our highest-precedence keymap runs before vim (so
    // Mod-E works even where vim binds Ctrl-E); vim() MUST precede
    // yCollab() so vim's keymap doesn't shadow the Yjs undo.
    const extensions = [
      Prec.highest(keymap.of([
        { key: 'Mod-e', run: () => { onexit?.(); return true; } },
        { key: 'Mod-Shift-e', run: () => { ontogglemode?.(); return true; } },
        { key: 'Mod-Enter', run: () => { onexit?.(); return true; } },
        { key: 'Mod-k', run: (v) => insertLink(v, linkDeps) },
        { key: 'Mod-Alt-p', run: () => { ontogglesplit?.(); return true; } },
      ])),
      // The vim leader (normal/visual) is fed to the engine as a private
      // token so a leader that is also a command still reaches maps.
      Prec.highest(EditorView.domEventHandlers({
        keydown: (e, v) => {
          if (!eff.vim) return false;
          const cm = getCM(v);
          if (!cm) return false;
          if (onpane && routePaneKey(e, cm)) return true;
          const handled = feedLeader((t) => Vim.handleKey(cm, t, 'user'), cm.state.vim as never, leaderKeyName(e), eff.leader);
          if (!handled) return false;
          e.preventDefault();
          e.stopPropagation();
          onvimstate?.({ mode: vimMode, pending: eff.leader });
          return true;
        },
      })),
      vimC.of(vimExt(s)),
      // The selection layer: vim hides the native ::selection, so
      // without it visual mode would draw nothing.
      drawSelection({ cursorBlinkRate: 1100 }),
      // Blockwise visual (<C-v>) is one range per line.
      EditorState.allowMultipleSelections.of(true),
      yankFlash(),
      gutterC.of(gutterExt(s)),
      activeLineC.of(activeLineExt(s)),
      wrapC.of(wrapExt(s)),
      tabC.of(tabExt(s)),
      fontC.of(fontExt(s)),
      // We do NOT call history() — yCollab supplies a Yjs-aware
      // UndoManager that integrates with collaborative undo.
      syntaxHighlighting(lumiHighlightStyle),
      // Fold placeholders for vim zc/zo/za (headings, lists, code).
      codeFolding({ placeholderText: '⋯' }),
      keysC.of(baseKeys(s)),
      markdown({ base: markdownLanguage, codeLanguages: languages }),
      previewC.of(previewExt(s)),
      yCollab(session.ytext, session.provider?.awareness ?? null, {
        undoManager: session.undoManager,
      }),
      EditorView.updateListener.of(scheduleStats),
      linkHelper(linkDeps),
      noteLinkHandler.of((href) => onopennote?.(href)),
      EditorView.contentAttributes.of({ spellcheck: 'true', autocorrect: 'off', 'aria-label': 'Note editor' }),
      EditorView.theme(EDITOR_THEME),
    ];

    view = new EditorView({
      state: EditorState.create({ doc: initialDoc, extensions }),
      parent: container,
    });
    watchVim();
    emitStats();
    view.focus();
  }

  // ---- pane navigation ---------------------------------------------------

  /** Ctrl-h/j/k/l and Ctrl-w chords in NORMAL/VISUAL move between
   *  panes; INSERT keeps vim's Ctrl-h (backspace) / Ctrl-j (newline). */
  function routePaneKey(e: KeyboardEvent, cm: NonNullable<ReturnType<typeof getCM>>): boolean {
    const st = cm.state.vim as { insertMode?: boolean; visualMode?: boolean; inputState?: Parameters<typeof vimMidCommand>[0] } | undefined;
    const mode: VimModeName = st?.insertMode ? 'insert' : st?.visualMode ? 'visual' : 'normal';
    const wasPending = paneKeys.pending;
    const r = editorPaneRoute(paneKeys, e, {
      vim: eff.vim,
      mode,
      vimPending: vimMidCommand(st?.inputState),
      ctrlHjkl: settings.paneNav,
      maps: appliedMappings(),
    });
    if (wasPending !== paneKeys.pending) onpanepending?.(paneKeys.pending);
    if (!r) return false;
    if (r.kind === 'nav') {
      const moved = onpane?.(r.dir) ?? false;
      if (!moved && fallsThroughWithoutTarget(r)) return false;
      // Leaving the window ends visual mode, as in vim.
      if (moved && mode === 'visual') Vim.handleKey(cm, '<Esc>', 'user');
    }
    e.preventDefault();
    e.stopPropagation();
    return true;
  }

  /** Put the cursor at the start of a 1-based line (split preview →
   *  editor with "move cursor" on). */
  export function gotoLine(n: number): void {
    if (!view) return;
    const doc = view.state.doc;
    const line = doc.line(Math.min(doc.lines, Math.max(1, Math.round(n))));
    view.dispatch({ selection: { anchor: line.from } });
  }

  /** Focus the editor (pane navigation, click). */
  export function focus(): void {
    view?.focus();
  }

  // ---- external control (split preview, clickable legend) ----------------

  /** The mounted CodeMirror view (split preview scroll sync). */
  export function editorView(): EditorView | null {
    return view;
  }

  /**
   * Run a legend action: `vim:<keys>` feeds keys to the vim engine
   * (`<C-r>`, `<Esc>` notation allowed), `ex:<cmd>` runs an ex command.
   * Returns false when it could not run (vim off, not mounted).
   */
  export function run(action: string): boolean {
    if (!view) return false;
    view.focus();
    const cm = eff.vim ? getCM(view) : null;
    if (action.startsWith('ex:')) {
      if (!cm) return false;
      Vim.handleEx(cm as never, action.slice(3));
      emitVim();
      return true;
    }
    if (action.startsWith('vim:')) {
      if (!cm) return false;
      for (const k of action.slice(4).match(/<[^>]+>|./g) ?? []) Vim.handleKey(cm, k, 'user');
      emitVim();
      return true;
    }
    return false;
  }

  // ---- link helper + vim state -------------------------------------------

  const linkDeps = {
    notes: () => notes?.() ?? [],
    fromPath: () => notePath?.() ?? '',
    selfID: () => session.noteID,
    /** Leave visual/normal so typing filters the picker. */
    ensureInsert: (v: EditorView, pos: number) => {
      const cm = eff.vim ? getCM(v) : null;
      const st = cm?.state.vim;
      if (!cm || !st || st.insertMode) return;
      if (st.visualMode) Vim.handleKey(cm, '<Esc>', 'user');
      v.dispatch({ selection: { anchor: pos } });
      Vim.handleKey(cm, 'i', 'user');
    },
  };

  let vimMode = 'normal';
  let vimSub: string | null = null;
  function emitVim(): void {
    const cm = view ? getCM(view) : null;
    const st = cm?.state.vim as { status?: string; insertMode?: boolean } | undefined;
    const pending = st && !st.insertMode && st.status ? st.status : null;
    onvimstate?.({ mode: vimMode, pending, sub: vimSub });
  }
  function watchVim(): void {
    if (!view || !onvimstate) return;
    const cm = getCM(view);
    if (!cm) {
      onvimstate({ mode: 'plain', pending: null });
      return;
    }
    vimMode = cm.state.vim?.insertMode ? 'insert' : 'normal';
    cm.on('vim-mode-change', (e: { mode: string; subMode?: string }) => {
      vimMode = e.mode;
      vimSub = e.mode === 'visual' ? (e.subMode ?? null) : null;
      emitVim();
    });
    cm.on('vim-keypress', emitVim);
    cm.on('vim-command-done', emitVim);
    emitVim();
  }

  // Re-wire when vim is toggled on a mounted editor.
  $effect(() => {
    void eff.vim;
    if (view) untrack(() => watchVim());
  });

  function destroyEditor(): void {
    activeLink = null;
    activeSplit = null;
    activeExit = null;
    activeSettings = null;
    activeToggleMode = null;
    if (statsTimer) {
      clearTimeout(statsTimer);
      statsTimer = null;
    }
    if (view) {
      try { view.destroy(); } catch {}
      view = null;
    }
  }
</script>

<div
  class="note-editor-host"
  class:readable={settings.readableWidth}
  data-testid="note-editor"
  data-mode={settings.editMode}
  data-prose={settings.proseFont}
  bind:this={container}
></div>

<style>
  .note-editor-host {
    flex: 1;
    min-height: 0;
    height: 100%;
    display: flex;
    width: 100%;
    /* Shared with the editor theme (NoteEditor EDITOR_THEME). */
    --editor-selection: color-mix(in srgb, var(--color-primary) 30%, transparent);
    --editor-selection-blur: color-mix(in srgb, var(--color-text) 14%, transparent);
    --editor-pad-x: clamp(16px, 4vw, 40px);
    --editor-pad-top: clamp(20px, 5vh, 56px);
  }
  /* Live Preview: the reader's typeface, size, leading and measure. */
  .note-editor-host[data-mode='live'] {
    --editor-leading: var(--prose-leading);
    --ed-heading: var(--md-heading);
  }
  .note-editor-host[data-mode='live'].readable { --editor-measure: calc(var(--md-measure) + 2px); }
  /* Source: monospace, markers dimmed, headings tinted and gently sized. */
  .note-editor-host[data-mode='source'] {
    --editor-font: var(--font-mono);
    --editor-leading: 1.7;
    --ed-heading: var(--color-primary);
    --ed-h1: 1.32em;
    --ed-h2: 1.2em;
    --ed-h3: 1.1em;
    --ed-h4: 1.04em;
  }
  .note-editor-host[data-mode='source'].readable { --editor-measure: 76ch; }
  :global(.note-editor-host .cm-editor) {
    flex: 1;
    outline: none;
    min-width: 0;
  }
</style>
