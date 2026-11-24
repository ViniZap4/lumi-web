<script lang="ts" module>
  import type { Entry } from '../lib/notetree.ts';
  import type { CreatePlan, RenamePlan, FolderRenamePlan } from '../lib/fileops.ts';
  import type { MillerNav } from '../lib/miller.svelte.ts';

  export type FxPrompt = { kind: 'create'; text: string } | { kind: 'rename'; text: string; entry: Entry };
  export type FxPlan = CreatePlan | RenamePlan | FolderRenamePlan;

  /** File operations, run by the view (same code as the explorer). */
  export interface FxOps {
    offline(): boolean;
    run(p: FxPrompt, plan: FxPlan, nav: MillerNav): Promise<void>;
    remove(entry: Entry): Promise<void>;
    paste(src: Entry, nav: MillerNav): Promise<void>;
  }
</script>

<script lang="ts">
  // Floating explorer (SPEC-PARTE2 §2, "yazi in nvim"): a centred
  // overlay with Miller columns + preview that starts at the current
  // note's folder. The usual explorer keymap (lib/shell-keymap.ts)
  // drives it; Enter opens in the current pane, Ctrl-v in a vertical
  // split, Ctrl-s in a horizontal one; Esc / q close. Click selects,
  // double-click opens, a click outside closes.
  import { onMount, onDestroy, tick, untrack } from 'svelte';
  import { MillerNav as Nav } from '../lib/miller.svelte.ts';
  import { ShellKeymap, type ShellAction } from '../lib/shell-keymap.ts';
  import { notes } from '../lib/notes.svelte.ts';
  import { dirOf, breadcrumb, parentDir } from '../lib/notetree.ts';
  import { planCreate, planRename, planFolderRename } from '../lib/fileops.ts';
  import { loadNote, peekNote } from '../lib/note-content.ts';
  import { previewExcerpt, updatedLabel } from '../lib/hover-preview.ts';
  import { renderBlocks } from '../lib/markdown.ts';
  import { captureFocus } from '../lib/list-keys.ts';
  import { editorSettings } from '../lib/editor-settings.svelte.ts';
  import type { OpenWhere } from '../lib/link-open.ts';
  import MillerColumn from './MillerColumn.svelte';
  import MarkdownView from './MarkdownView.svelte';

  interface Props {
    vaultID: string;
    bookName: string;
    /** The note the explorer starts at (its folder, cursor on it). */
    startNote: string | null;
    /** Start folder when there is no note. */
    startDir?: string;
    ops: FxOps;
    onopen: (noteID: string, where: OpenWhere) => void;
    onclose: () => void;
  }
  const { vaultID, bookName, startNote, startDir = '', ops, onopen, onclose }: Props = $props();

  const nav = new Nav(() => notes.list);
  const keymap = new ShellKeymap();
  const restoreFocus = captureFocus();

  let colEl = $state<HTMLElement | null>(null);
  let col = $state<{ pageRows(): number } | null>(null);
  let filterOpen = $state(false);
  let filterInput = $state<HTMLInputElement | null>(null);
  let prompt = $state<FxPrompt | null>(null);
  let promptInput = $state<HTMLInputElement | null>(null);
  let promptErr = $state<string | null>(null);
  let pendingDelete = $state<Entry | null>(null);
  let yanked = $state<Entry | null>(null);
  let busy = $state(false);
  let pending = $state<string | null>(null);
  let flashMsg = $state<string | null>(null);
  let flashTimer: ReturnType<typeof setTimeout> | null = null;

  // Start at the current note's folder, cursor on the note.
  untrack(() => {
    const n = startNote ? notes.list.find((x) => x.id === startNote) : null;
    if (n) nav.reveal(n.id);
    else nav.goTo(startDir);
  });

  const crumbs = $derived(breadcrumb(nav.dir));
  const cur = $derived(nav.current);
  const curNote = $derived(cur?.kind === 'note' ? cur.note : null);

  // Note preview (excerpt, shared renderer).
  let previewBody = $state<string | null>(null);
  let previewErr = $state<string | null>(null);
  let previewTimer: ReturnType<typeof setTimeout> | null = null;
  $effect(() => {
    const n = curNote;
    untrack(() => {
      if (previewTimer) clearTimeout(previewTimer);
      previewErr = null;
      if (!n) {
        previewBody = null;
        return;
      }
      const hit = peekNote(vaultID, n.id);
      previewBody = hit ? previewExcerpt(hit.content.body, 120).text : null;
      // Holding j/k must not fire one request per row.
      previewTimer = setTimeout(() => {
        loadNote(vaultID, n.id).then(
          (r) => { if (curNote?.id === n.id) previewBody = previewExcerpt(r.content.body, 120).text; },
          (e) => { if (curNote?.id === n.id) previewErr = (e as Error).message; },
        );
      }, hit ? 0 : 90);
    });
  });
  const previewBlocks = $derived(previewBody != null ? renderBlocks(previewBody) : []);

  const promptPlan: FxPlan | null = $derived.by(() => {
    const p = prompt;
    if (!p || !p.text.trim()) return null;
    if (p.kind === 'create') return planCreate(nav.dir, p.text);
    if (p.entry.kind === 'folder') return planFolderRename(p.entry.path, p.text);
    return planRename(p.entry.path, p.entry.note.title ?? p.entry.name, p.text);
  });

  onMount(() => {
    void tick().then(() => colEl?.focus({ preventScroll: true }));
  });
  onDestroy(() => {
    if (previewTimer) clearTimeout(previewTimer);
    if (flashTimer) clearTimeout(flashTimer);
    restoreFocus();
  });

  function flash(t: string): void {
    flashMsg = t;
    if (flashTimer) clearTimeout(flashTimer);
    flashTimer = setTimeout(() => (flashMsg = null), 3000);
  }

  function open(where: OpenWhere): void {
    const c = nav.current;
    if (c?.kind === 'note') onopen(c.note.id, where);
    else if (c?.kind === 'folder' && where === 'current') nav.right();
  }

  async function focusCol(): Promise<void> {
    await tick();
    colEl?.focus({ preventScroll: true });
  }

  function onKey(e: KeyboardEvent): void {
    // Text fields (filter, prompt) handle their own keys.
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    e.stopPropagation();
    if (pendingDelete) {
      e.preventDefault();
      if (e.key === 'y' || e.key === 'Y' || e.key === 'Enter') void confirmDelete();
      else if (e.key === 'n' || e.key === 'N' || e.key === 'Escape' || e.key === 'q') pendingDelete = null;
      return;
    }
    if (e.ctrlKey && !e.metaKey && !e.altKey && (e.key === 'v' || e.key === 's')) {
      e.preventDefault();
      open(e.key === 'v' ? 'vsplit' : 'hsplit');
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      keymap.reset();
      open('current');
      return;
    }
    if (e.key === 'Tab') return;
    const a = keymap.feed(e, 'explorer');
    pending = keymap.pending;
    if (!a) {
      // Keep the page from reacting (Cmd-keys stay the browser's).
      if (!e.metaKey && e.key.length === 1) e.preventDefault();
      return;
    }
    e.preventDefault();
    if (a.kind !== 'pending') run(a);
  }

  function run(a: ShellAction): void {
    const page = col?.pageRows() ?? 10;
    switch (a.kind) {
      case 'move': nav.move(a.n); return;
      case 'halfPage': nav.move(a.dir * Math.ceil(page / 2)); return;
      case 'page': nav.move(a.dir * page); return;
      case 'top': nav.top(); return;
      case 'bottom': nav.bottom(); return;
      case 'parent': nav.left(); return;
      case 'open': {
        const n = nav.right();
        if (n) onopen(n.note.id, 'current');
        return;
      }
      case 'historyBack': nav.historyBack(); return;
      case 'historyForward': nav.historyForward(); return;
      case 'home': nav.home(); return;
      case 'filter': void openFilter(); return;
      case 'nextMatch':
      case 'prevMatch':
        if (!nav.findNext(a.kind === 'nextMatch' ? 1 : -1)) flash('no filter yet — / to filter');
        return;
      case 'clearOrBack':
        if (nav.filter) { nav.setFilter(''); filterOpen = false; }
        else onclose();
        return;
      case 'close': onclose(); return;
      case 'toggleHidden': nav.toggleHidden(); return;
      case 'create':
        if (ops.offline()) return flash('creating notes needs the server');
        void openPrompt({ kind: 'create', text: '' });
        return;
      case 'rename': {
        const c = nav.current;
        if (!c) return;
        if (ops.offline() && !(c.kind === 'folder' && c.virtual)) return flash('renaming needs the server');
        void openPrompt({ kind: 'rename', entry: c, text: c.kind === 'folder' ? c.name : (c.note.title ?? c.name) });
        return;
      }
      case 'delete': {
        const c = nav.current;
        if (!c) return;
        if (c.kind === 'folder') {
          if (c.virtual) nav.removeFolder(c.path);
          else flash('delete the notes inside to remove a folder');
          return;
        }
        if (ops.offline()) return flash('deleting needs the server');
        pendingDelete = c;
        return;
      }
      case 'yank': {
        const c = nav.current;
        if (c?.kind !== 'note') return flash('y works on notes');
        yanked = c;
        flash(`yanked ${c.name} — p to paste a copy`);
        return;
      }
      case 'paste':
        if (!yanked) return flash('nothing yanked — y on a note first');
        void guarded(() => ops.paste(yanked!, nav), `pasted a copy of ${yanked.name}`);
        return;
      default:
        return;
    }
  }

  async function guarded(f: () => Promise<void>, ok?: string): Promise<void> {
    busy = true;
    try {
      await f();
      if (ok) flash(ok);
    } catch (e) {
      flash((e as Error).message);
    } finally {
      busy = false;
    }
  }

  async function openFilter(): Promise<void> {
    filterOpen = true;
    await tick();
    filterInput?.focus();
    filterInput?.select();
  }
  function onFilterKey(e: KeyboardEvent): void {
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      nav.setFilter('');
      filterOpen = false;
      void focusCol();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      filterOpen = nav.filter !== '';
      void focusCol();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      nav.move(e.key === 'ArrowDown' ? 1 : -1);
    }
  }

  async function openPrompt(p: FxPrompt): Promise<void> {
    prompt = p;
    promptErr = null;
    await tick();
    promptInput?.focus();
    promptInput?.select();
  }
  function onPromptKey(e: KeyboardEvent): void {
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      prompt = null;
      void focusCol();
    }
  }
  async function submitPrompt(): Promise<void> {
    const p = prompt;
    const plan = promptPlan;
    if (!p || !plan || busy) return;
    if (plan.kind === 'error') {
      promptErr = plan.message;
      return;
    }
    if (plan.kind === 'none') {
      prompt = null;
      return void focusCol();
    }
    busy = true;
    try {
      await ops.run(p, plan, nav);
      prompt = null;
      void focusCol();
    } catch (e) {
      promptErr = (e as Error).message;
    } finally {
      busy = false;
    }
  }

  async function confirmDelete(): Promise<void> {
    const e = pendingDelete;
    pendingDelete = null;
    if (!e) return;
    await guarded(() => ops.remove(e), `deleted ${e.name}`);
  }

  // Mouse: click selects (a folder enters), double-click opens.
  function pickCurrent(i: number, e: Entry): void {
    nav.setCursor(i);
    if (e.kind === 'folder') nav.right();
    void focusCol();
  }
  function openCurrent(i: number, e: Entry): void {
    nav.setCursor(i);
    if (e.kind === 'note') onopen(e.note.id, 'current');
  }
  function pickParent(_i: number, e: Entry): void {
    if (e.kind === 'folder') nav.goTo(e.path);
    else nav.goTo(parentDir(nav.dir) ?? '', e.key);
    void focusCol();
  }
  function pickPreview(_i: number, e: Entry): void {
    const c = nav.current;
    if (c?.kind !== 'folder') return;
    nav.goTo(c.path, e.key);
    void focusCol();
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<div class="fx-scrim" role="presentation" onclick={onclose} data-testid="floating-explorer-scrim">
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    class="fx"
    role="dialog"
    aria-modal="true"
    aria-label="Explorer"
    tabindex="-1"
    onclick={(e) => e.stopPropagation()}
    onkeydown={onKey}
    data-testid="floating-explorer"
  >
    <header class="fx-head">
      <svg class="fx-glyph" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M1.75 4.25a1.5 1.5 0 0 1 1.5-1.5h3l1.5 1.75h5a1.5 1.5 0 0 1 1.5 1.5v6.25a1.5 1.5 0 0 1-1.5 1.5h-9.5a1.5 1.5 0 0 1-1.5-1.5z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>
      <nav class="fx-crumbs" aria-label="Folder path">
        {#each crumbs as c, i (c.path)}
          {#if i > 0}<span class="fx-sep" aria-hidden="true">/</span>{/if}
          <button type="button" class="fx-crumb" aria-current={i === crumbs.length - 1 ? 'location' : undefined} onclick={() => { nav.goTo(c.path); void focusCol(); }}>{i === 0 ? bookName : c.name}</button>
        {/each}
      </nav>
      {#if pending}<span class="fx-pending mono">{pending}</span>{/if}
      <span class="fx-keys" aria-hidden="true"><kbd>⏎</kbd> open <kbd>⌃v</kbd> vsplit <kbd>⌃s</kbd> split <kbd>Esc</kbd></span>
      <button class="ui-btn ghost sm icon" type="button" onclick={onclose} aria-label="Close explorer">
        <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
      </button>
    </header>

    <div class="fx-cols">
      <section class="fx-col fx-parent" aria-label="Parent folder">
        {#if nav.parent != null}
          <MillerColumn entries={nav.parentEntries} cursor={nav.parentCursor} label="Parent folder" idPrefix="fx-parent" onpick={pickParent} />
        {:else}
          <div class="fx-book"><span class="ui-eyebrow">book</span><span class="fx-book-name">{bookName}</span><span class="fx-book-meta">{notes.list.length} notes</span></div>
        {/if}
      </section>
      <section class="fx-col fx-current" aria-label="Current folder">
        {#if filterOpen || nav.filter}
          <div class="fx-filter">
            <span class="fx-slash" aria-hidden="true">/</span>
            <input
              class="fx-filter-input"
              type="search"
              placeholder="filter"
              aria-label="Filter folder"
              value={nav.filter}
              bind:this={filterInput}
              oninput={(e) => nav.setFilter(e.currentTarget.value)}
              onkeydown={onFilterKey}
            />
            <span class="fx-count mono">{nav.entries.length}</span>
          </div>
        {/if}
        <MillerColumn
          bind:this={col}
          bind:element={colEl}
          entries={nav.entries}
          cursor={nav.cursor}
          label="Folder {nav.dir || bookName}"
          idPrefix="fx-cur"
          active
          openKey={startNote ? 'n:' + startNote : null}
          yankedKey={yanked?.key ?? null}
          emptyText={nav.filter ? 'No matches' : 'Empty folder — a to create'}
          onpick={pickCurrent}
          onopen={openCurrent}
        />
      </section>
      <section class="fx-col fx-preview" aria-label="Preview">
        {#if cur?.kind === 'folder' && nav.previewEntries}
          <MillerColumn entries={nav.previewEntries} cursor={nav.previewCursor} label="Contents of {cur.path}" idPrefix="fx-preview" emptyText="Empty folder" onpick={pickPreview} />
        {:else if curNote}
          <div class="fx-note">
            <div class="fx-note-head">
              <span class="fx-note-title">{curNote.title}</span>
              <span class="fx-note-meta">{dirOf(curNote.path) || '/'} · {updatedLabel(curNote.updated_at)}</span>
            </div>
            {#if previewBody != null}
              <div class="lumi-prose compact" data-prose={editorSettings.value.proseFont}><MarkdownView blocks={previewBlocks} /></div>
            {:else if previewErr}
              <div class="fx-empty err">{previewErr}</div>
            {:else}
              <div class="fx-skel"><span></span><span class="short"></span><span></span></div>
            {/if}
          </div>
        {:else}
          <div class="fx-empty">Nothing here</div>
        {/if}
      </section>
    </div>

    {#if prompt}
      <form class="fx-bar" onsubmit={(e) => { e.preventDefault(); void submitPrompt(); }}>
        <span class="fx-tag">{prompt.kind === 'create' ? 'new' : 'rename'}</span>
        <span class="fx-dir mono">{prompt.kind === 'create' ? (nav.dir ? nav.dir + '/' : '/') : ''}</span>
        <input class="fx-input mono" bind:this={promptInput} bind:value={prompt.text} onkeydown={onPromptKey} disabled={busy} autocomplete="off" spellcheck="false" aria-label={prompt.kind === 'create' ? 'New note or folder (end with /)' : 'New name or path'} />
        {#if promptErr || promptPlan?.kind === 'error'}<span class="fx-err">{promptErr ?? (promptPlan?.kind === 'error' ? promptPlan.message : '')}</span>{/if}
      </form>
    {:else if pendingDelete}
      <div class="fx-bar danger" role="alertdialog" aria-label="Confirm delete">
        <span>Delete <strong>{pendingDelete.name}</strong>?</span>
        <span class="fx-spacer"></span>
        <button class="ui-btn sm ghost" type="button" onclick={() => (pendingDelete = null)}>Cancel <kbd>n</kbd></button>
        <button class="ui-btn sm danger solid" type="button" onclick={() => void confirmDelete()}>Delete <kbd>y</kbd></button>
      </div>
    {:else}
      <footer class="fx-status mono">
        <span>{nav.entries.length} items{nav.filter ? ` · “${nav.filter}”` : ''}</span>
        {#if yanked}<span>yanked {yanked.name}</span>{/if}
        <span class="fx-spacer"></span>
        {#if flashMsg}<span class="fx-flash" role="status">{flashMsg}</span>{/if}
      </footer>
    {/if}
  </div>
</div>

<style>
  .fx-scrim {
    position: fixed;
    inset: 0;
    z-index: 280;
    display: grid;
    place-items: center;
    padding: var(--sp-4);
    background: color-mix(in srgb, var(--color-overlay-bg) 45%, rgba(0, 0, 0, 0.4));
    backdrop-filter: blur(3px) saturate(1.1);
    animation: ui-fade 140ms var(--ease);
  }
  .fx {
    width: min(1200px, 80vw);
    height: min(820px, 80vh);
    display: flex;
    flex-direction: column;
    background: var(--color-background);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-pop), 0 0 0 1px color-mix(in srgb, var(--color-text) 4%, transparent);
    overflow: hidden;
    outline: none;
    animation: fx-in 180ms var(--ease);
  }
  @keyframes fx-in { from { opacity: 0; transform: scale(0.965); } }
  .fx-head {
    flex: none;
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    height: 40px;
    padding: 0 var(--sp-2) 0 var(--sp-3);
    border-bottom: 1px solid var(--hairline);
    background: color-mix(in srgb, var(--color-overlay-bg) 35%, var(--color-background));
  }
  .fx-glyph { flex: none; color: var(--color-primary); }
  .fx-crumbs { flex: 1; min-width: 0; display: flex; align-items: center; gap: 2px; overflow-x: auto; white-space: nowrap; scrollbar-width: none; font-size: var(--text-sm); }
  .fx-crumb { border: none; background: transparent; color: var(--color-text-dim); padding: 3px 6px; border-radius: var(--radius-sm); cursor: pointer; font-size: inherit; }
  .fx-crumb:hover { background: var(--tint-hover); color: var(--color-text); }
  .fx-crumb[aria-current='location'] { color: var(--color-text); font-weight: 600; }
  .fx-sep { color: var(--color-text-dim); opacity: 0.5; }
  .fx-pending { color: var(--color-warning); font-size: var(--text-xs); }
  .fx-keys { display: inline-flex; align-items: center; gap: 4px; font-size: var(--text-2xs); color: var(--color-text-dim); white-space: nowrap; }
  .fx-keys kbd { margin-left: 6px; }
  .fx-cols {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(140px, 0.85fr) minmax(200px, 1.25fr) minmax(0, 2.4fr);
  }
  .fx-col { min-width: 0; min-height: 0; display: flex; flex-direction: column; border-right: 1px solid var(--hairline); }
  .fx-parent { background: color-mix(in srgb, var(--color-overlay-bg) 30%, var(--color-background)); }
  .fx-preview { border-right: none; overflow-y: auto; }
  .fx-book { display: flex; flex-direction: column; gap: 2px; padding: var(--sp-4) var(--sp-3); }
  .fx-book-name { font-weight: 600; }
  .fx-book-meta { font-size: var(--text-xs); color: var(--color-text-dim); }
  .fx-filter { display: flex; align-items: center; gap: var(--sp-2); height: 32px; padding: 0 var(--sp-3); border-bottom: 1px solid var(--hairline); background: var(--tint-primary); }
  .fx-slash { font-family: var(--font-mono); color: var(--color-primary); font-weight: 700; }
  .fx-filter-input { flex: 1; min-width: 0; border: none; outline: none; background: transparent; color: var(--color-text); font-family: var(--font-mono); font-size: var(--text-sm); }
  .fx-count { font-size: var(--text-2xs); color: var(--color-text-dim); }
  .fx-note { padding: var(--sp-4) var(--sp-5) var(--sp-6); }
  .fx-note-head { display: flex; flex-direction: column; gap: 2px; padding-bottom: var(--sp-3); margin-bottom: var(--sp-3); border-bottom: 1px solid color-mix(in srgb, var(--hairline) 60%, transparent); }
  .fx-note-title { font-weight: 650; font-size: var(--text-lg); letter-spacing: -0.01em; }
  .fx-note-meta { font-family: var(--font-mono); font-size: var(--text-2xs); color: var(--color-text-dim); }
  .fx-empty { padding: var(--sp-6); text-align: center; color: var(--color-text-dim); font-size: var(--text-sm); }
  .fx-empty.err { color: var(--color-error); }
  .fx-skel { display: flex; flex-direction: column; gap: 10px; }
  .fx-skel span { height: 10px; border-radius: 5px; background: var(--tint-hover); }
  .fx-skel .short { width: 55%; }
  .fx-bar, .fx-status {
    flex: none;
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    min-height: 34px;
    padding: 0 var(--sp-3);
    border-top: 1px solid var(--hairline);
    font-size: var(--text-xs);
  }
  .fx-bar { background: color-mix(in srgb, var(--color-overlay-bg) 55%, var(--color-background)); animation: ui-rise 120ms var(--ease); }
  .fx-bar.danger { background: color-mix(in srgb, var(--color-error) 8%, var(--color-background)); font-size: var(--text-sm); }
  .fx-tag { padding: 2px 8px; border-radius: 4px; font-family: var(--font-mono); font-size: var(--text-2xs); font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; background: var(--color-primary); color: var(--color-background); }
  .fx-dir { color: var(--color-text-dim); }
  .fx-input { flex: 1; min-width: 60px; border: none; outline: none; background: transparent; color: var(--color-text); font-size: var(--text-sm); }
  .fx-err { color: var(--color-error); }
  .fx-status { color: var(--color-text-dim); font-size: var(--text-2xs); }
  .fx-flash { color: var(--color-text); background: var(--tint-active); padding: 1px 8px; border-radius: 4px; }
  .fx-spacer { flex: 1; }
  .mono { font-family: var(--font-mono); }

  @media (max-width: 720px) {
    .fx { width: 100%; height: min(86vh, 100%); }
    .fx-cols { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1.2fr) minmax(0, 1fr); }
    .fx-parent { display: none; }
    .fx-current { border-right: none; border-bottom: 1px solid var(--hairline); }
    .fx-keys { display: none; }
  }
</style>
