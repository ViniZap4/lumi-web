// The primary pane's live editor (Yjs + CodeMirror). The editor module
// and the Yjs runtime are an async chunk loaded on the first edit; the
// session itself comes from lib/editor-boot's pool, so another pane on
// the same note shares one Y.Doc.

import { tick, untrack } from 'svelte';
import { vaults } from '../../lib/vaults.svelte.ts';
import { notes } from '../../lib/notes.svelte.ts';
import { sync } from '../../lib/sync.svelte.ts';
import { acquireEditorSession, editorPool } from '../../lib/editor-boot.ts';
import { editorSettings } from '../../lib/editor-settings.svelte.ts';
import { withViewTransition } from '../../lib/motion.ts';
import type { EditorStats } from '../../lib/textstats.ts';
import type { PreviewAction } from '../../lib/preview-keys.ts';
import type { EditorSession } from '../../lib/editor-session.svelte.ts';
import type { Workspace } from './workspace.svelte.ts';

export type NoteEditorComp = typeof import('../../components/NoteEditor.svelte').default;

/** What the shell calls on the mounted NoteEditor. */
export type NoteEditorHandle = {
  editorView(): import('@codemirror/view').EditorView | null;
  run(a: string): boolean;
  gotoLine(n: number): void;
  focus(): void;
};

/** What the shell calls on the mounted SourceSplit. */
export type SourceSplitHandle = {
  focusPreview(): Promise<boolean>;
  revealSource(): void;
  previewElement(): HTMLElement | null;
  topLine(): number | null;
  run(a: PreviewAction): boolean;
  clearFind(): boolean;
};

export type VimState = { mode: string; pending: string | null; sub?: string | null };

/** Server-side mirror debounce (wsync.DefaultMirrorDebounce) + margin. */
export const MIRROR_SETTLE_MS = 800;

export class EditingController {
  mode = $state(false);
  session = $state<EditorSession | null>(null);
  error = $state<string | null>(null);
  saving = $state(false);
  loading = $state(false);
  NoteEditor = $state<NoteEditorComp | null>(null);
  stats = $state<EditorStats | null>(null);
  /** Cursor line for the Source editor's mount (canvas "Abrir Source"). */
  sourceLine = $state<number | null>(null);
  vimState = $state<VimState>({ mode: 'normal', pending: null });
  editorRef = $state<NoteEditorHandle | null>(null);
  splitRef = $state<SourceSplitHandle | null>(null);

  readonly splitOn = $derived(editorSettings.value.editMode === 'source' && editorSettings.value.previewSplit);

  constructor(private readonly ws: Workspace) {}

  install(): void {
    // Lineage mismatch: the session refused to merge its replica (now a
    // conflict copy) and stopped. Rebuild a fresh session — the replica
    // is gone, so it joins empty and adopts the server's history. Also
    // a read-only view whose note the server rebuilt (1012
    // mirror_rebuild): rejoin with a NEW empty doc, never the old one.
    $effect(() => {
      const c = this.session?.lineageConflict || this.session?.rejoin;
      if (!c) return;
      untrack(() => {
        this.exit();
        void this.enter();
      });
    });
  }

  async enter(): Promise<void> {
    const vaultID = vaults.selectedID;
    const noteID = notes.selectedID;
    if (!notes.content || !vaultID || !noteID) return;
    if (this.loading || this.session) return;

    this.loading = true;
    this.error = null;
    try {
      // First edit per session pulls the CM6 + vim + y-codemirror.next
      // + yjs + y-websocket chunks, in parallel. The session uses the
      // ACTIVE BOOK's account (server, token, identity) and this note's
      // offline replica; another pane on the same note shares it.
      //
      // Join rule (CRDT client protocol §2): the session starts from an
      // EMPTY doc and the server's SyncStep2 delivers the text — never a
      // seed from the REST body (that duplicated the note). Until the
      // session is `editable` the template shows a read-only preview.
      const [editorMod, sess] = await Promise.all([
        this.NoteEditor ? Promise.resolve(null) : import('../../components/NoteEditor.svelte'),
        acquireEditorSession(vaultID, noteID),
      ]);
      if (editorMod) this.NoteEditor = editorMod.default;
      if (typeof sess === 'string') {
        this.error = sess;
        return;
      }
      // The user may have moved on while the chunks loaded.
      if (notes.selectedID !== noteID || vaults.selectedID !== vaultID || this.session) {
        editorPool.release(sess);
        return;
      }
      this.session = sess;
      sync.setEditor(vaultID, sess);
      this.mode = true;
      this.vimState = { mode: 'normal', pending: null };
      this.ws.pane = 'note';
    } catch (e) {
      this.error = `Failed to load editor: ${(e as Error).message}`;
    } finally {
      this.loading = false;
    }
  }

  /** Leave edit mode and release the single-note session. */
  exit(): void {
    this.sourceLine = null;
    const sess = this.session;
    if (sess) {
      // Show the latest collaborative text in the preview right away;
      // the server mirrors it to disk ~500 ms later.
      if (sess.editable && !sess.isDestroyed && !sess.lineageConflict) {
        notes.applyLocalBody(sess.noteID, sess.ytext.toString());
      }
      sync.setEditor(sess.vaultID, null);
      this.session = null;
      // Shared with other panes on this note: the last one closes it.
      editorPool.release(sess);
    }
    this.mode = false;
    this.error = null;
    this.stats = null;
  }

  exitAnimated = (): void => {
    void withViewTransition(async () => {
      this.exit();
      await tick();
    });
  };

  async editNote(id: string): Promise<void> {
    if (notes.selectedID !== id) {
      this.ws.noteHistory.visit(id);
      await notes.select(id);
    }
    if (notes.selectedID !== id) return;
    this.ws.pane = 'note';
    await this.enter();
  }

  /**
   * Cmd/Ctrl+S. Every Yjs update is already persisted by the server
   * on receipt and mirrored to the markdown file after a 500 ms
   * debounce, so there is nothing to push. In particular we must NOT
   * POST the full text to /diff: the server diffs it against its
   * current state, which silently reverts concurrent remote edits we
   * have not received yet (last-writer-wins). Save just waits for the
   * mirror to settle and refreshes the list metadata.
   */
  async save(): Promise<void> {
    const sess = this.session;
    if (this.saving || !sess) return;
    if (!sess.editable || !sess.liveSynced) {
      this.error = 'Offline — your edits are kept locally and will sync when the connection returns.';
      return;
    }
    this.saving = true;
    this.error = null;
    try {
      await new Promise((r) => setTimeout(r, MIRROR_SETTLE_MS));
      await notes.refresh();
    } finally {
      this.saving = false;
    }
  }

  initialiseFromFile = (): void => {
    if (!this.session || !notes.content) return;
    this.session.initialiseFromFile(notes.content.body ?? '');
  };

  toggleSplit = (): void => {
    const s = editorSettings.value;
    if (s.editMode !== 'source') {
      editorSettings.update({ editMode: 'source', previewSplit: true });
      this.ws.flash('Source mode + preview');
      return;
    }
    editorSettings.update({ previewSplit: !s.previewSplit });
  };

  setEditMode(m: 'live' | 'source'): void {
    editorSettings.update({ editMode: m });
  }
}

/** The status line's vim mode name. */
export function vimModeLabel(m: string, sub?: string | null): string {
  if (m === 'visual') return sub === 'linewise' ? 'V-Line' : sub === 'blockwise' ? 'V-Block' : 'Visual';
  return m === 'insert' ? 'Insert' : m === 'replace' ? 'Replace' : 'Normal';
}
