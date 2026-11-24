<script lang="ts">
  // A secondary pane of the split note area (SPEC-PARTE2 §3): one note,
  // its own reader / editor, independent of the main pane. The live
  // session comes from the shared pool, so two panes on one note edit
  // one Y.Doc. The main pane (the note the explorer previews) is still
  // rendered by the view; this component is every other leaf.
  import { onDestroy, tick, untrack } from 'svelte';
  import type { PaneLeaf, SplitDir } from '../lib/pane-tree.ts';
  import { notes } from '../lib/notes.svelte.ts';
  import { loadNote, peekNote } from '../lib/note-content.ts';
  import { renderBlocks, startsWithTitle, taskToggle } from '../lib/markdown.ts';
  import { dirOf } from '../lib/notetree.ts';
  import { editorSettings } from '../lib/editor-settings.svelte.ts';
  import { acquireEditorSession, editorPool, toggleTaskHeadless } from '../lib/editor-boot.ts';
  import { motionAllowed } from '../lib/motion.ts';
  import { focusPane } from '../lib/view-focus.ts';
  import { keyLabel } from '../lib/platform.ts';
  import { resolveView, viewsFor, MARKDOWN_VIEW } from '../lib/note-views.ts';
  import type { EditorSession } from '../lib/editor-session.svelte.ts';
  import type { PaneDir, WinCmd } from '../lib/pane-nav.ts';
  import type { LinkAt, OpenWhere } from '../lib/link-open.ts';
  import type { NoteContent } from '../lib/types.ts';
  import MarkdownView from './MarkdownView.svelte';
  import NoteViewHost from './NoteViewHost.svelte';
  import NoteIcon from './NoteIcon.svelte';
  import { noteIconKind } from '../lib/note-icons.ts';

  type NoteEditorComp = typeof import('./NoteEditor.svelte').default;

  interface Props {
    leaf: PaneLeaf;
    vaultID: string;
    active: boolean;
    /** Several panes on screen (closing returns to the others). */
    onfocus: () => void;
    onclose: () => void;
    /** Follow a link found in this note. */
    onfollow: (href: string, where: OpenWhere, fromPath: string, wiki?: boolean) => void;
    /** Link clicked in the rendered note (routing by modifiers). */
    onlink: (href: string, e: MouseEvent, fromPath: string) => void;
    onhover: (link: LinkAt, rect: { left: number; top: number; bottom: number }, fromPath: string) => void;
    onexplore: () => void;
    onwin: (cmd: WinCmd, o: { link: LinkAt | null; arg?: string }) => void;
    onpane: (dir: PaneDir) => boolean;
    onpanepending: (p: boolean) => void;
    onvimstate: (s: { mode: string; pending: string | null; sub?: string | null }) => void;
    /** Reader / editor state for the legend and status bar. */
    onstate: (s: { editing: boolean; title: string }) => void;
    onview: (view: string | null) => void;
    onsplit?: (dir: SplitDir) => void;
  }
  const p: Props = $props();

  let content = $state<NoteContent | null>(null);
  let stale = $state(false);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let scroller = $state<HTMLElement | null>(null);
  let root = $state<HTMLElement | null>(null);

  let session = $state<EditorSession | null>(null);
  let editing = $state(false);
  let editError = $state<string | null>(null);
  let NoteEditor = $state<NoteEditorComp | null>(null);
  let editorRef = $state<{ focus(): void; linkUnderCursor(): LinkAt | null } | null>(null);

  const meta = $derived(notes.list.find((n) => n.id === p.leaf.note) ?? null);
  const path = $derived(meta?.path ?? content?.path ?? '');
  const title = $derived(meta?.title ?? content?.id ?? p.leaf.note);
  const folder = $derived(path ? dirOf(path) : '');
  const body = $derived(content?.body ?? '');
  const blocks = $derived(content ? renderBlocks(body) : []);
  const titleInBody = $derived(!!content && startsWithTitle(body, title));
  const match = $derived({ path, kind: content?.kind ?? meta?.kind ?? null, frontmatter: content?.frontmatter ?? null, body });
  const views = $derived(viewsFor(match));
  const view = $derived(resolveView(match, p.leaf.view));

  // Load (and reload when the note changes on the server).
  let seq = 0;
  $effect(() => {
    const id = p.leaf.note;
    const vid = p.vaultID;
    void meta?.updated_at;
    untrack(() => void load(vid, id));
  });

  async function load(vid: string, id: string): Promise<void> {
    const my = ++seq;
    const hit = peekNote(vid, id);
    if (hit) {
      content = hit.content;
      stale = hit.stale;
    } else if (content?.id !== id) {
      content = null;
    }
    loading = !content;
    error = null;
    try {
      const r = await loadNote(vid, id);
      if (my !== seq) return;
      content = r.content;
      stale = r.stale;
    } catch (e) {
      if (my !== seq) return;
      error = (e as Error).message;
    } finally {
      if (my === seq) loading = false;
    }
  }

  // Switching the pane's note leaves the editor of the old one.
  let lastNote = untrack(() => p.leaf.note);
  $effect(() => {
    const id = p.leaf.note;
    untrack(() => {
      if (id === lastNote) return;
      lastNote = id;
      if (session) exitEdit();
      scroller?.scrollTo?.({ top: 0 });
    });
  });

  $effect(() => {
    const st = { editing: editing && !!session, title };
    untrack(() => p.onstate(st));
  });

  onDestroy(() => {
    if (session) editorPool.release(session, { defer: true });
    session = null;
  });

  export async function enterEdit(): Promise<void> {
    if (session || editing) return;
    editing = true;
    editError = null;
    try {
      const [mod, s] = await Promise.all([
        NoteEditor ? Promise.resolve(null) : import('./NoteEditor.svelte'),
        acquireEditorSession(p.vaultID, p.leaf.note),
      ]);
      if (mod) NoteEditor = mod.default;
      if (typeof s === 'string') {
        editError = s;
        editing = false;
        return;
      }
      if (!editing || s.noteID !== p.leaf.note) {
        editorPool.release(s);
        return;
      }
      session = s;
      await tick();
      editorRef?.focus();
    } catch (e) {
      editError = `Failed to load editor: ${(e as Error).message}`;
      editing = false;
    }
  }

  export function exitEdit(): void {
    const s = session;
    if (s && s.editable && !s.isDestroyed && content && content.id === s.noteID) {
      content = { ...content, body: s.ytext.toString() };
    }
    session = null;
    editing = false;
    editError = null;
    if (s) editorPool.release(s);
    void tick().then(() => scroller?.focus({ preventScroll: true }));
  }

  /** The live session this pane edits (promotion hand-off). */
  export function liveSession(): EditorSession | null {
    return session;
  }

  export function isEditing(): boolean {
    return editing;
  }

  export function element(): HTMLElement | null {
    return root;
  }

  export function focus(): void {
    if (editing && session && editorRef) editorRef.focus();
    else if (view !== MARKDOWN_VIEW) focusPane(root);
    else scroller?.focus({ preventScroll: true });
  }

  /** Scroll the reader (shell reader keys). */
  export function scroll(by: number | 'top' | 'bottom' | 'half' | '-half' | 'page' | '-page'): void {
    const el = scroller;
    if (!el) return;
    const h = el.clientHeight;
    const to = (top: number) => {
      if (typeof el.scrollTo === 'function') el.scrollTo({ top, behavior: motionAllowed() ? 'smooth' : 'auto' });
      else el.scrollTop = top;
    };
    if (by === 'top') to(0);
    else if (by === 'bottom') to(el.scrollHeight);
    else if (by === 'half') to(el.scrollTop + h / 2);
    else if (by === '-half') to(el.scrollTop - h / 2);
    else if (by === 'page') to(el.scrollTop + h * 0.9);
    else if (by === '-page') to(el.scrollTop - h * 0.9);
    else el.scrollTop += by;
  }

  export function notePath(): string {
    return path;
  }

  async function toggleTask(i: number): Promise<void> {
    if (!content) return;
    const before = content.body;
    const ch = taskToggle(before, i);
    if (!ch) return;
    content = { ...content, body: before.slice(0, ch.from) + ch.insert + before.slice(ch.to) };
    const r = await toggleTaskHeadless(p.vaultID, p.leaf.note, i);
    if (!content || content.id !== p.leaf.note) return;
    content = { ...content, body: 'error' in r ? before : r.text };
  }

  function setMode(m: 'live' | 'source'): void {
    editorSettings.update({ editMode: m });
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<section
  class="note-pane settle-soft"
  class:active={p.active}
  data-leaf={p.leaf.id}
  data-note-path={path}
  data-testid="note-pane"
  bind:this={root}
  onfocusin={p.onfocus}
  onpointerdown={p.onfocus}
  aria-label="Pane: {title}"
>
  <header class="pane-bar">
    {#if editing && session}
      <span class="conn-dot conn-{session.status}" title="Live sync: {session.status}"></span>
    {/if}
    <span class="pane-title" title={path}>
      {#if folder}<span class="pane-folder">{folder} /</span>{/if}
      <span class="pane-kind"><NoteIcon kind={noteIconKind({ path, kind: meta?.kind }, content)} size={12} /></span>
      <span class="pane-name">{title}</span>
    </span>
    {#if stale}<span class="pane-stale">offline copy</span>{/if}
    <span class="pane-actions">
      {#if views.length > 1 && view === MARKDOWN_VIEW}
        <span class="ui-seg pane-seg" role="group" aria-label="View">
          {#each views as v (v.id)}
            <button type="button" class:active={view === v.id} aria-pressed={view === v.id} onclick={() => { if (v.id !== MARKDOWN_VIEW && editing) exitEdit(); p.onview(v.id === views[0].id ? null : v.id); }}>{v.label}</button>
          {/each}
        </span>
      {/if}
      {#if view === MARKDOWN_VIEW}
        {#if editing && session}
          <span class="ui-seg pane-seg" role="group" aria-label="Edit mode">
            <button type="button" class:active={editorSettings.value.editMode === 'live'} aria-pressed={editorSettings.value.editMode === 'live'} onclick={() => setMode('live')}>Live</button>
            <button type="button" class:active={editorSettings.value.editMode === 'source'} aria-pressed={editorSettings.value.editMode === 'source'} onclick={() => setMode('source')}>Source</button>
          </span>
          <button class="ui-btn sm pane-btn" type="button" onclick={exitEdit} title="Reading view ({keyLabel('⌘E')}, :q closes the pane)">Done</button>
        {:else}
          <button class="ui-btn sm pane-btn" type="button" onclick={() => void enterEdit()} disabled={!content} title="Edit (e)">Edit</button>
        {/if}
      {/if}
      <button class="ui-btn ghost sm icon pane-close" type="button" onclick={p.onclose} aria-label="Close pane" title="Close pane (⌃w q)">
        <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
      </button>
    </span>
  </header>

  {#if editError}<div class="pane-error" role="alert">{editError}</div>{/if}

  {#if view !== MARKDOWN_VIEW && content}
    <div class="pane-view">
      <NoteViewHost
        {view}
        vaultID={p.vaultID}
        noteID={p.leaf.note}
        notePath={path}
        {body}
        active={p.active}
        openLink={(href, where) => p.onfollow(href, where, path)}
        acquireSession={() => acquireEditorSession(p.vaultID, p.leaf.note)}
        releaseSession={(s) => editorPool.release(s)}
        {title}
        onsource={() => { p.onview(MARKDOWN_VIEW); void enterEdit(); }}
        onlink={(href, e) => p.onlink(href, e, path)}
      />
    </div>
  {:else if editing && session && NoteEditor && session.editable && !(session.emptyAtSync && body !== '')}
    <div class="pane-editor">
      <NoteEditor
        bind:this={editorRef}
        {session}
        settings={editorSettings.value}
        onexit={exitEdit}
        onquit={p.onclose}
        onopensettings={() => {}}
        ontogglemode={() => editorSettings.toggleEditMode()}
        notes={() => notes.list}
        notePath={() => path}
        onfollow={(l, where) => p.onfollow(l.href, where, path, l.wiki)}
        onhover={(l, r) => p.onhover(l, r, path)}
        onexplore={p.onexplore}
        onwin={p.onwin}
        onvimstate={p.onvimstate}
        onpane={p.onpane}
        onpanepending={p.onpanepending}
        onfocus={p.onfocus}
      />
    </div>
  {:else}
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <div class="pane-scroll" bind:this={scroller} tabindex="0" data-pane-reader>
      {#if editing}
        <div class="pane-note">{session?.stopped ? 'Live editing unavailable.' : 'Connecting to live editor… (read-only until synced)'}</div>
      {/if}
      {#if loading && !content}
        <div class="pane-skel" aria-busy="true" aria-label="Loading…"><span class="skeleton t"></span><span class="skeleton"></span><span class="skeleton"></span><span class="skeleton short"></span></div>
      {:else if error}
        <div class="pane-error" role="alert">{error}</div>
      {:else if content}
        <article class="rendered lumi-prose" data-prose={editorSettings.value.proseFont}>
          {#if !titleInBody}<h1 class="rendered-title">{title}</h1>{/if}
          <MarkdownView {blocks} onlink={(href, e) => p.onlink(href, e, path)} ontoggletask={editing ? undefined : (i) => void toggleTask(i)} />
        </article>
      {/if}
    </div>
  {/if}
</section>

<style>
  .note-pane {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    height: 100%;
    position: relative;
    background: var(--color-background);
  }
  .pane-bar {
    flex: none;
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    height: 36px;
    padding: 0 var(--sp-2) 0 var(--sp-3);
    border-bottom: 1px solid color-mix(in srgb, var(--hairline) 60%, transparent);
    font-size: var(--text-xs);
    color: var(--color-text-dim);
  }
  .note-pane.active .pane-bar { box-shadow: inset 0 2px 0 color-mix(in srgb, var(--color-primary) 55%, transparent); }
  .pane-title { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pane-folder { margin-right: 4px; opacity: 0.8; }
  .pane-name { color: var(--color-text); font-weight: 600; font-size: var(--text-sm); }
  .note-pane:not(.active) .pane-name { font-weight: 550; color: var(--color-text-dim); }
  .pane-stale { color: var(--color-warning); }
  .pane-actions { flex: none; display: inline-flex; align-items: center; gap: 4px; }
  .pane-seg button { height: 20px; padding: 0 8px; }
  .pane-btn { height: 22px; }
  .pane-close { color: var(--color-text-dim); }
  .pane-close:hover { color: var(--color-text); }
  .pane-scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: var(--sp-5) clamp(16px, 4%, 40px) var(--sp-7);
    outline: none;
  }
  .pane-editor, .pane-view { flex: 1; min-height: 0; display: flex; overflow: hidden; }
  .pane-view > :global(*) { flex: 1; min-width: 0; }
  .rendered { max-width: calc(var(--md-measure) + 2px); margin: 0 auto; padding-bottom: 12vh; }
  .rendered-title {
    margin: 0 0 0.6em;
    font-size: 1.75em;
    line-height: 1.18;
    font-weight: 700;
    letter-spacing: -0.022em;
    color: var(--md-heading);
    text-wrap: balance;
  }
  .pane-skel { display: flex; flex-direction: column; gap: 12px; max-width: var(--md-measure); margin: var(--sp-6) auto; padding: 0 var(--sp-4); }
  .pane-skel .skeleton { height: 11px; }
  .pane-skel .skeleton.t { height: 22px; width: 55%; margin-bottom: 8px; }
  .pane-skel .skeleton.short { width: 62%; }
  .pane-note, .pane-error {
    display: flex;
    gap: var(--sp-2);
    align-items: center;
    justify-content: center;
    padding: var(--sp-3) var(--sp-4);
    font-size: var(--text-sm);
    color: var(--color-text-dim);
  }
  .pane-error { color: var(--color-error); }
  .conn-dot { flex: none; width: 7px; height: 7px; border-radius: 50%; background: var(--color-text-dim); }
  .conn-connected { background: var(--color-accent); }
  .conn-connecting { background: var(--color-warning); }
  .conn-disconnected { background: var(--color-error); }
  .spinner {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    border: 2px solid var(--hairline);
    border-top-color: var(--color-primary);
    animation: np-spin 0.7s linear infinite;
  }
  @keyframes np-spin { to { transform: rotate(360deg); } }
</style>
