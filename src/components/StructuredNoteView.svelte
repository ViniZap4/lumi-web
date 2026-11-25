<script lang="ts">
  // Host for the structured note views (kanban board, canvas). A note
  // pane renders this instead of the markdown reader when
  // `noteViewKind(note) !== 'markdown'` (lib/note-kind.ts).
  //
  // Joins the note's live session (same join rules as the editor: empty
  // doc, read-only REST preview until the first SyncStep2, offline
  // replica + lineage gate via editor-boot) and hands the board/canvas a
  // LiveText. In a pane the session comes from the shared pool
  // (`acquireSession` / `releaseSession`, lib/editor-boot.ts), so a board
  // and its Source editor in another pane edit one Y.Doc; standalone it
  // owns one. The Yjs and view chunks are lazy-loaded.
  import { untrack, type Component, type Snippet } from 'svelte';
  import type { NoteViewKind } from '../lib/note-kind.ts';
  import { memoryLiveText, type LiveText } from '../lib/live-text.ts';
  import { planSession, startSession, loadEditorSession } from '../lib/editor-boot.ts';
  import type { EditorSession } from '../lib/editor-session.svelte.ts';
  import { sync } from '../lib/sync.svelte.ts';
  import { notes } from '../lib/notes.svelte.ts';
  import { getNoteContent } from '../lib/api.ts';
  import { normalizePath } from '../lib/notetree.ts';
  import type { CanvasNoteRef } from '../lib/canvas/canvas.ts';
  import { editorSettings } from '../lib/editor-settings.svelte.ts';
  import { initialStructuredMode, structuredFocus, type StructuredMode } from '../lib/structured-mode.svelte.ts';

  interface Props {
    vaultID: string;
    noteID: string;
    kind: Exclude<NoteViewKind, 'markdown'>;
    /** REST body (read-only preview until live). */
    body: string;
    title?: string;
    /** No live session (e.g. viewer role): render read-only. */
    readonly?: boolean;
    /** Board ↔ Source / Canvas ↔ Source: open the markdown/JSON editor. */
    onsource?: (o?: { line?: number }) => void;
    /** Open a vault file (canvas file node). `split` asks for a split pane. */
    onopenfile?: (path: string, opts: { split: boolean }) => void;
    onlink?: (href: string, e: MouseEvent) => void;
    /** Shared session pool (panes). Absent → this view owns a session. */
    acquireSession?: () => Promise<EditorSession | string>;
    releaseSession?: (s: EditorSession) => void;
    /** Pane controls rendered at the end of the view's header bar. */
    paneControls?: Snippet;
  }
  let { vaultID, noteID, kind, body, title = '', readonly = false, onsource, onopenfile, onlink, acquireSession, releaseSession, paneControls }: Props = $props();

  // svelte-ignore state_referenced_locally
  const preview = memoryLiveText(body, false);

  // Reading | Edit | Source (SPEC-PARTE2 §5a): opens in Reading unless
  // "open notes in" is set to editing. Source is `onsource`.
  let mode = $state<StructuredMode>(initialStructuredMode(editorSettings.value.openIn));
  const focusOwner = {};
  function setMode(m: StructuredMode): void {
    mode = m;
    if (hasFocus) claim();
  }
  let hasFocus = false;
  function claim(): void {
    hasFocus = true;
    structuredFocus.claim(focusOwner, { kind, mode, set: setMode, source: onsource });
  }
  function onfocusout(e: FocusEvent): void {
    const next = e.relatedTarget as Node | null;
    if (next && (e.currentTarget as HTMLElement).contains(next)) return;
    hasFocus = false;
    structuredFocus.blur(focusOwner);
  }
  $effect(() => () => structuredFocus.release(focusOwner));
  let live = $state<LiveText | null>(null);
  let session = $state<EditorSession | null>(null);
  let error = $state<string | null>(null);
  let View = $state<Component<any> | null>(null);

  // Keep the read-only preview in step with REST refreshes until live.
  $effect(() => {
    const b = body;
    untrack(() => {
      if (!live && b !== preview.read()) preview.remote([{ from: 0, to: preview.read().length, insert: b }]);
    });
  });

  $effect(() => {
    const v = vaultID;
    const n = noteID;
    const k = kind;
    let cancelled = false;
    let pooled = false;
    let mine: EditorSession | null = null;
    void (async () => {
      try {
        const viewP = k === 'kanban' ? import('./kanban/KanbanBoard.svelte') : import('./canvas/CanvasView.svelte');
        const [mod] = await Promise.all([viewP]);
        if (cancelled) return;
        View = mod.default as Component<any>;
        if (readonly) return;
        const ymod = await import('../lib/live-text-y.ts');
        if (acquireSession) {
          const got = await acquireSession();
          if (cancelled) {
            if (typeof got !== 'string') releaseSession?.(got);
            return;
          }
          if (typeof got === 'string') {
            error = got;
            return;
          }
          pooled = true;
          mine = got;
          session = mine;
        } else {
          const Ctor = await loadEditorSession();
          const plan = await planSession(v, n);
          if (cancelled) return;
          if (typeof plan === 'string') {
            error = plan;
            return;
          }
          mine = startSession(Ctor, plan);
          session = mine;
          sync.setEditor(v, mine);
        }
        const s = mine;
        live = ymod.yLiveText(s.ytext, { undoManager: s.undoManager, editable: () => s.editable && !s.stopped && !s.lineageConflict });
      } catch (e) {
        if (!cancelled) error = `Failed to load the ${k === 'kanban' ? 'board' : 'canvas'}: ${(e as Error).message}`;
      }
    })();
    return () => {
      cancelled = true;
      if (mine) {
        const s = mine;
        // No notes.applyLocalBody here: teardown also runs while the
        // shell is switching notes, and the next select refetches.
        if (pooled) releaseSession?.(s);
        else {
          s.destroy();
          // Only clear the shell's editor slot if it is still ours.
          if (sync.editor?.session === s) sync.setEditor(v, null);
        }
      }
      live = null;
      session = null;
    };
  });

  const editableLive = $derived(!!session && session.editable && !(session.emptyAtSync && body !== ''));
  const doc = $derived(live && editableLive ? live : preview);
  const status = $derived.by(() => {
    if (readonly) return 'read-only';
    if (error) return null;
    const s = session;
    if (!s) return 'loading…';
    if (s.lineageConflict) return 'conflict copy saved';
    if (s.stopped) return 'live editing unavailable';
    if (!s.editable) return 'connecting… (read-only)';
    if (s.status !== 'connected') return 'offline';
    return s.peers.length ? `${s.peers.length + 1} editing` : null;
  });

  // Canvas: notes for the picker and file previews.
  const noteRefs = $derived<CanvasNoteRef[]>(
    notes.vaultID === vaultID ? notes.list.filter((n) => !/\.canvas$/i.test(n.path)).map((n) => ({ path: normalizePath(n.path || n.id + '.md'), title: n.title })) : [],
  );
  function findByPath(path: string) {
    if (notes.vaultID !== vaultID) return null;
    const want = normalizePath(path);
    const norm = (p: string) => normalizePath(p);
    return notes.list.find((n) => norm(n.path) === want) ?? notes.list.find((n) => norm(n.path).toLowerCase() === want.toLowerCase()) ?? null;
  }
  async function loadNote(path: string): Promise<string | null> {
    const n = findByPath(path);
    if (!n) return null;
    try {
      return (await getNoteContent(vaultID, n.id)).body ?? '';
    } catch {
      return null;
    }
  }
  function openFile(path: string, opts: { split: boolean }): void {
    if (onopenfile) return onopenfile(path, opts);
    const n = findByPath(path);
    if (n) void notes.select(n.id);
  }
</script>

<div class="snv" data-kind={kind} data-mode={mode} data-testid="structured-note" onfocusin={claim} {onfocusout}>
  {#if error}<div class="error snv-error" data-testid="structured-error">{error}</div>{/if}
  {#if session?.lastError}<div class="error snv-error">{session.lastError}</div>{/if}
  {#if session?.editable && session.emptyAtSync && body !== ''}
    <div class="error snv-error" data-testid="structured-uninitialised">
      The server has no live-editing state for this {kind === 'kanban' ? 'board' : 'canvas'} yet.
      <button class="ui-btn sm" type="button" onclick={() => session?.initialiseFromFile(body)}>Load file contents</button>
    </div>
  {/if}
  {#if View}
    {#if kind === 'kanban'}
      <View {doc} {title} {onsource} {onlink} {status} {mode} onmode={setMode} {paneControls} />
    {:else}
      <View {doc} {title} {onsource} {onlink} {status} {mode} onmode={setMode} {paneControls} memoKey={`${vaultID}/${noteID}`} notes={noteRefs} {loadNote} onopenfile={openFile} />
    {/if}
  {:else}
    <div class="placeholder"><span class="spinner" aria-hidden="true"></span>Loading…</div>
  {/if}
</div>

<style>
  .snv { display: flex; flex-direction: column; height: 100%; min-height: 0; flex: 1; }
  .snv > :global(:last-child) { flex: 1; min-height: 0; }
  .snv-error { margin: 8px 16px; }
</style>
