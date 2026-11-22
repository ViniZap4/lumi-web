<script lang="ts" module>
  import { Vim } from '@replit/codemirror-vim';

  // Vim ex commands are registered globally on the Vim singleton, so
  // they dispatch to whichever editor is currently mounted.
  let activeExit: (() => void) | null = null;
  let vimExRegistered = false;
  function registerVimExit(): void {
    if (vimExRegistered) return;
    vimExRegistered = true;
    const exit = () => activeExit?.();
    // Edits are already persisted live; :w / :wq / :x just exit or no-op.
    Vim.defineEx('quit', 'q', exit);
    Vim.defineEx('wq', 'wq', exit);
    Vim.defineEx('xit', 'x', exit);
    Vim.defineEx('write', 'w', () => {});
  }
</script>

<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view';
  import { EditorState } from '@codemirror/state';
  import { history, defaultKeymap, historyKeymap } from '@codemirror/commands';
  import { searchKeymap } from '@codemirror/search';
  import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
  import { languages } from '@codemirror/language-data';
  import { syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language';
  import { vim } from '@replit/codemirror-vim';
  import { yCollab } from 'y-codemirror.next';
  import type { EditorSession } from '../lib/editor-session.svelte.ts';

  type Props = {
    session: EditorSession;
    vimEnabled?: boolean;
    /** Explicit "leave the editor" command (vim `:q`, Mod-Enter). Esc
     *  is NOT an exit: in vim it leaves insert mode. */
    onexit?: () => void;
  };

  const { session, vimEnabled = true, onexit }: Props = $props();

  let container: HTMLDivElement | null = $state(null);
  let view: EditorView | null = null;

  onMount(() => {
    if (!container) return;
    mountEditor();
    return () => destroyEditor();
  });

  onDestroy(() => destroyEditor());

  function mountEditor(): void {
    if (!container || view) return;
    // Only ever mount on a synced session (the view gates on
    // session.synced). The CodeMirror doc MUST start equal to the
    // Y.Text: y-codemirror.next's ySync only forwards *deltas*, so an
    // empty CM doc over a non-empty Y.Text would apply every later
    // remote delta at the wrong offsets.
    const initialDoc = session.ytext.toString();
    registerVimExit();
    activeExit = () => onexit?.();

    // Order matters: vim() MUST precede yCollab() so vim's keymap
    // doesn't shadow the Yjs undo. (Documented in the stack
    // research; tested in the wild by every y-codemirror.next +
    // vim user.)
    const extensions = [
      vimEnabled ? vim() : [],
      lineNumbers(),
      highlightActiveLine(),
      // We do NOT call history() — yCollab supplies a Yjs-aware
      // UndoManager that integrates with collaborative undo.
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      keymap.of([{ key: 'Mod-Enter', run: () => { onexit?.(); return true; } }]),
      keymap.of([...defaultKeymap.filter((b) => b.key !== 'Mod-z' && b.key !== 'Mod-y' && b.key !== 'Mod-Shift-z'), ...historyKeymap.filter((b) => false), ...searchKeymap]),
      markdown({ base: markdownLanguage, codeLanguages: languages }),
      yCollab(session.ytext, session.provider?.awareness ?? null, {
        undoManager: session.undoManager,
      }),
      EditorView.theme({
        '&': {
          height: '100%',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: '14px',
          background: 'var(--color-overlay-bg, var(--color-background))',
          color: 'var(--color-text)',
        },
        '.cm-content': { padding: '10px 0' },
        '.cm-gutters': {
          background: 'var(--color-overlay-bg, var(--color-background))',
          color: 'var(--color-text-dim, var(--color-muted))',
          border: 'none',
        },
        '.cm-activeLine': { backgroundColor: 'var(--color-selected-bg, transparent)' },
        '.cm-activeLineGutter': { backgroundColor: 'var(--color-selected-bg, transparent)' },
        '.cm-cursor': { borderLeftColor: 'var(--color-primary)' },
        '.cm-selectionBackground': { backgroundColor: 'var(--color-selected-bg) !important' },
        '.cm-ySelectionCaret': { borderLeftWidth: '2px' },
      }, { dark: true }),
    ];

    view = new EditorView({
      state: EditorState.create({ doc: initialDoc, extensions }),
      parent: container,
    });
  }

  function destroyEditor(): void {
    activeExit = null;
    if (view) {
      try { view.destroy(); } catch {}
      view = null;
    }
  }
</script>

<div class="note-editor-host" data-testid="note-editor" bind:this={container}></div>

<style>
  .note-editor-host {
    flex: 1;
    min-height: 60vh;
    display: flex;
    border: 1px solid var(--color-border, var(--color-muted));
    border-radius: 4px;
    overflow: hidden;
  }
  :global(.note-editor-host .cm-editor) {
    flex: 1;
    outline: none;
  }
</style>
