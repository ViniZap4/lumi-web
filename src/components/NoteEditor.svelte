<script lang="ts" module>
  import { Vim } from '@replit/codemirror-vim';

  // Vim ex commands are registered globally on the Vim singleton, so
  // they dispatch to whichever editor is currently mounted.
  let activeExit: (() => void) | null = null;
  let activeSettings: (() => void) | null = null;
  let activeToggleMode: (() => void) | null = null;
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
    Vim.defineEx('preview', 'preview', () => activeToggleMode?.());
  }
</script>

<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import {
    EditorView,
    keymap,
    lineNumbers,
    highlightActiveLine,
    type ViewUpdate,
  } from '@codemirror/view';
  import { EditorState, Compartment, Prec, type Extension } from '@codemirror/state';
  import { defaultKeymap } from '@codemirror/commands';
  import { searchKeymap } from '@codemirror/search';
  import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
  import { languages } from '@codemirror/language-data';
  import { syntaxHighlighting, indentUnit } from '@codemirror/language';
  import { vim } from '@replit/codemirror-vim';
  import { yCollab } from 'y-codemirror.next';
  import type { EditorSession } from '../lib/editor-session.svelte.ts';
  import type { EditorSettings } from '../lib/editor-settings.ts';
  import { applyVimConfig } from '../lib/vim-config.ts';
  import { livePreview } from '../lib/live-preview.ts';
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
    onstats?: (s: EditorStats) => void;
  };

  const { session, settings, onexit, onopensettings, ontogglemode, onstats }: Props = $props();

  let container: HTMLDivElement | null = $state(null);
  let view: EditorView | null = null;

  const vimC = new Compartment();
  const gutterC = new Compartment();
  const wrapC = new Compartment();
  const previewC = new Compartment();
  const tabC = new Compartment();
  const fontC = new Compartment();
  const activeLineC = new Compartment();

  function vimExt(s: EditorSettings): Extension {
    return s.vim ? vim({ status: true }) : [];
  }
  function gutterExt(s: EditorSettings): Extension {
    if (s.relativeLineNumbers) return relativeLineNumbers();
    return s.lineNumbers ? lineNumbers() : [];
  }
  function wrapExt(s: EditorSettings): Extension {
    return s.lineWrapping ? EditorView.lineWrapping : [];
  }
  function previewExt(s: EditorSettings): Extension {
    return s.editMode === 'live' ? livePreview() : [];
  }
  function tabExt(s: EditorSettings): Extension {
    return [EditorState.tabSize.of(s.tabSize), indentUnit.of(' '.repeat(s.tabSize))];
  }
  function fontExt(s: EditorSettings): Extension {
    return EditorView.theme({ '&': { fontSize: `${s.fontSize}px` } });
  }
  function activeLineExt(s: EditorSettings): Extension {
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
    const s = settings;
    // Touch every field so the effect tracks them all.
    void [s.vim, s.lineNumbers, s.relativeLineNumbers, s.lineWrapping, s.editMode, s.tabSize, s.fontSize];
    void [s.escapeSequences.length, s.mappings.length, s.escapeTimeout];
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
    applyVimConfig(Vim, settings);
    activeExit = () => onexit?.();
    activeSettings = () => onopensettings?.();
    activeToggleMode = () => ontogglemode?.();

    const s = settings;
    // Order matters: our highest-precedence keymap runs before vim (so
    // Mod-E works even where vim binds Ctrl-E); vim() MUST precede
    // yCollab() so vim's keymap doesn't shadow the Yjs undo.
    const extensions = [
      Prec.highest(keymap.of([
        { key: 'Mod-e', run: () => { onexit?.(); return true; } },
        { key: 'Mod-Shift-e', run: () => { ontogglemode?.(); return true; } },
        { key: 'Mod-Enter', run: () => { onexit?.(); return true; } },
      ])),
      vimC.of(vimExt(s)),
      gutterC.of(gutterExt(s)),
      activeLineC.of(activeLineExt(s)),
      wrapC.of(wrapExt(s)),
      tabC.of(tabExt(s)),
      fontC.of(fontExt(s)),
      // We do NOT call history() — yCollab supplies a Yjs-aware
      // UndoManager that integrates with collaborative undo.
      syntaxHighlighting(lumiHighlightStyle),
      keymap.of([...defaultKeymap.filter((b) => b.key !== 'Mod-z' && b.key !== 'Mod-y' && b.key !== 'Mod-Shift-z'), ...searchKeymap]),
      markdown({ base: markdownLanguage, codeLanguages: languages }),
      previewC.of(previewExt(s)),
      yCollab(session.ytext, session.provider?.awareness ?? null, {
        undoManager: session.undoManager,
      }),
      EditorView.updateListener.of(scheduleStats),
      EditorView.contentAttributes.of({ spellcheck: 'true', autocorrect: 'off', 'aria-label': 'Note editor' }),
      EditorView.theme({
        '&': {
          height: '100%',
          fontFamily: 'var(--editor-font, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif)',
          background: 'transparent',
          color: 'var(--color-text)',
        },
        '&.cm-focused': { outline: 'none' },
        '.cm-scroller': { lineHeight: '1.6' },
        '.cm-content': { padding: '1.25rem 0 40vh', caretColor: 'var(--color-primary)' },
        '.cm-line': { padding: '0 1.25rem' },
        '.cm-gutters': {
          background: 'transparent',
          color: 'var(--color-text-dim, var(--color-muted))',
          border: 'none',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: '0.8em',
        },
        '.cm-activeLine': { backgroundColor: 'var(--color-selected-bg, transparent)' },
        '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--color-text)' },
        '.cm-cursor': { borderLeftColor: 'var(--color-primary)' },
        '.cm-fat-cursor': { background: 'var(--color-primary) !important', color: 'var(--color-background) !important' },
        '&:not(.cm-focused) .cm-fat-cursor': { background: 'none !important', outline: '1px solid var(--color-primary) !important' },
        '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: 'var(--color-selected-bg) !important' },
        '.cm-ySelectionCaret': { borderLeftWidth: '2px' },
        '.cm-panels': {
          background: 'var(--color-overlay-bg, var(--color-background))',
          color: 'var(--color-text)',
          borderTop: '1px solid var(--color-border, var(--color-muted))',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: '12px',
        },
        '.cm-vim-panel': { padding: '2px 8px' },
        '.cm-vim-panel input': { color: 'var(--color-text)', background: 'transparent' },
      }),
    ];

    view = new EditorView({
      state: EditorState.create({ doc: initialDoc, extensions }),
      parent: container,
    });
    emitStats();
    view.focus();
  }

  function destroyEditor(): void {
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
  bind:this={container}
></div>

<style>
  .note-editor-host {
    flex: 1;
    min-height: 60vh;
    display: flex;
    width: 100%;
  }
  .note-editor-host.readable {
    max-width: 48rem;
    margin: 0 auto;
  }
  :global(.note-editor-host .cm-editor) {
    flex: 1;
    outline: none;
    min-width: 0;
  }
  :global(.note-editor-host[data-mode='source'] .cm-editor) {
    --editor-font: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
</style>
