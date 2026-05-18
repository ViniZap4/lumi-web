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
  };

  const { session, vimEnabled = true }: Props = $props();

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
      state: EditorState.create({ extensions }),
      parent: container,
    });
  }

  function destroyEditor(): void {
    if (view) {
      try { view.destroy(); } catch {}
      view = null;
    }
  }
</script>

<div class="note-editor-host" bind:this={container}></div>

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
