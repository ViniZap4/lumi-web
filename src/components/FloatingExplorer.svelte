<script lang="ts" module>
  import type { Entry } from '../lib/notetree.ts';
  import type { ShellAction } from '../lib/shell-keymap.ts';
  import type { FxPrompt, FxPlan, FxLevel, FxInitial, FxOps } from './explorer/fx-types.ts';
  export type { FxPrompt, FxPlan, FxLevel, FxInitial, FxOps };

  // Survives closing and reopening the overlay (yazi keeps it too).
  let rememberedHidden = false;
</script>

<script lang="ts">
  // Floating explorer (SPEC-PARTE2 §2) — the only navigation. A centred
  // overlay (a full-height sheet on narrow screens) with Miller columns
  // and a preview. Files level: the book's folders and notes, starting
  // at the current note's folder. Books level (`gb`, `h` at the book
  // root): accounts → books, so switching books floats too.
  //
  // The usual explorer keymap (lib/shell-keymap.ts) drives it; Enter
  // opens in the current pane, Ctrl-v in a vertical split, Ctrl-s in a
  // horizontal one; Esc / q close. Click selects, double-click opens,
  // a click outside closes. a/r/d/y/p, /, ., f (hints), ⇧F10 (menu)
  // and dragging a note onto a folder all work in here. State and keys
  // live in explorer/fx-controller.svelte.ts.
  import { onMount, onDestroy, untrack } from 'svelte';
  import { notes } from '../lib/notes.svelte.ts';
  import { books } from '../lib/books.svelte.ts';
  import { breadcrumb } from '../lib/notetree.ts';
  import { captureFocus } from '../lib/list-keys.ts';
  import { plural } from '../lib/books-nav.ts';
  import { editorSettings } from '../lib/editor-settings.svelte.ts';
  import type { OpenWhere } from '../lib/link-open.ts';
  import MillerColumn from './MillerColumn.svelte';
  import ContextMenu from './ContextMenu.svelte';
  import HintOverlay from './HintOverlay.svelte';
  import CommandLegend from './CommandLegend.svelte';
  import FxHead from './explorer/FxHead.svelte';
  import FxBookList from './explorer/FxBookList.svelte';
  import FxBookCard from './explorer/FxBookCard.svelte';
  import FxPromptBar from './explorer/FxPromptBar.svelte';
  import { FxController } from './explorer/fx-controller.svelte.ts';
  import { lazyComponent } from '../views/vault/lazy.svelte.ts';
  import { loadFxNotePreview } from '../views/vault/chunks.ts';

  // The note preview renders markdown / mini canvases: a lazy chunk.
  const FxNotePreview = lazyComponent(loadFxNotePreview);

  interface Props {
    vaultID: string;
    bookName: string;
    /** The note the explorer starts at (its folder, cursor on it). */
    startNote: string | null;
    /** Start folder when there is no note. */
    startDir?: string;
    /** Start at the books level (`gb`, "Switch book"). */
    level?: FxLevel;
    initial?: FxInitial;
    /** Force the narrow sheet (tests); else it follows ≤720px. */
    narrow?: boolean;
    ops: FxOps;
    /** Yanked note, kept by the view across openings. */
    yanked?: Entry | null;
    /** Open a note. `from` is the row's name (shared-element morph). */
    onopen: (noteID: string, where: OpenWhere, from?: HTMLElement | null) => void;
    /** A note row is being dragged (true) / the drag ended (false):
     *  the overlay steps aside so it can be dropped on a pane edge. */
    ondragnote?: (on: boolean) => void;
    /** Open a note straight in the editor (`e`). */
    onedit?: (noteID: string) => void;
    /** Switch to another book (books level). */
    onbook?: (bookID: string) => void;
    /** App keys that leave the overlay (palette, help, settings…). */
    onapp?: (a: ShellAction) => void;
    /** Books level footer / `a`: new book; manage books (full list). */
    onnewbook?: () => void;
    onmanage?: () => void;
    /** The level changed (h at the book root → books). */
    onlevel?: (l: FxLevel) => void;
    /** Closed; `dir` is the folder it was showing. */
    onclose: (dir?: string) => void;
  }
  let {
    vaultID,
    bookName,
    startNote,
    startDir = '',
    level: startLevel = 'files',
    initial = null,
    narrow: narrowProp,
    ops,
    yanked = $bindable(null),
    onopen,
    ondragnote,
    onedit,
    onbook,
    onapp,
    onnewbook,
    onmanage,
    onlevel,
    onclose,
  }: Props = $props();

  // Narrow screens: a full-height sheet with touch-sized rows.
  let mqNarrow = $state(false);
  const sheet = $derived(narrowProp ?? mqNarrow);
  // Settings → Densidade: compact rows (24 px) fit ~25% more per column.
  const rowH = $derived(sheet ? 44 : editorSettings.value.density === 'compact' ? 24 : 30);

  const restoreFocus = captureFocus();
  const c = new FxController(
    () => ({ bookName, initial, ops, yanked, sheet, onopen, ondragnote, onedit, onbook, onapp, onnewbook, onmanage, onlevel, onclose }),
    (e) => (yanked = e),
    untrack(() => ({ level: startLevel, note: startNote, dir: startDir, showHidden: rememberedHidden })),
  );
  c.install();
  const nav = c.nav;

  const crumbs = $derived(breadcrumb(nav.dir));
  const cur = $derived(nav.current);
  const curNote = $derived(cur?.kind === 'note' ? cur.note : null);
  const liveMsg = $derived(
    c.level === 'books'
      ? `Livros, ${plural(books.list.length, 'livro', 'livros')}`
      : `${nav.dir === '' ? bookName + ' root' : nav.dir}, ${nav.entries.length} items` + (nav.filter ? `, filtered by “${nav.filter}”` : ''),
  );

  onMount(() => {
    let mq: MediaQueryList | null = null;
    const onmq = () => (mqNarrow = !!mq?.matches);
    try {
      mq = window.matchMedia('(max-width: 720px)');
      onmq();
      mq.addEventListener?.('change', onmq);
    } catch {
      /* jsdom */
    }
    c.mounted();
    return () => mq?.removeEventListener?.('change', onmq);
  });
  onDestroy(() => {
    c.destroy();
    rememberedHidden = nav.showHidden;
    restoreFocus();
  });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<div class="fx-scrim" class:sheet class:dragging-out={c.draggingOut} role="presentation" onclick={c.close} data-testid="floating-explorer-scrim">
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    class="fx"
    class:sheet
    class:no-preview={!c.showPreview}
    role="dialog"
    aria-modal="true"
    aria-label={c.level === 'books' ? 'Livros' : 'Explorer'}
    tabindex="-1"
    bind:this={c.rootEl}
    onclick={(e) => e.stopPropagation()}
    onkeydown={c.onKey}
    data-testid="floating-explorer"
    data-level={c.level}
  >
    {#if sheet}<div class="fx-grab" aria-hidden="true"></div>{/if}
    <FxHead
      level={c.level}
      {sheet}
      atAccounts={c.atAccounts}
      accountsLayer={c.accountsLayer}
      account={c.accountUnder}
      {crumbs}
      dir={nav.dir}
      {bookName}
      pending={c.pending}
      onup={c.up}
      onaccounts={() => c.booksKey({ kind: 'parent' })}
      onshelf={() => void c.setLevel('books')}
      oncrumb={c.crumb}
      onclose={c.close}
    />

    {#if c.level === 'books'}
      <div class="fx-cols shelf" data-testid="fx-books" data-layer={c.atAccounts ? 'accounts' : 'books'}>
        <section class="fx-col fx-current" aria-label={c.atAccounts ? 'Contas e servidores' : 'Livros'}>
          <FxBookList groups={c.groups} bind:bc={c.bc} atAccounts={c.atAccounts} {sheet} bind:listEl={c.booksEl} onchoose={c.chooseBook} onpickaccount={c.pickAccount} />
        </section>
        <section class="fx-col fx-preview" aria-label={c.atAccounts ? 'Conta' : 'Livro'}>
          <FxBookCard book={c.bookUnder} account={c.accountUnder} />
        </section>
      </div>
      <footer class="fx-status" data-testid="fx-footer">
        <CommandLegend embedded items={c.legendItems} onaction={c.legendAction} onmore={() => c.appKey({ kind: 'help' })} />
        {#if c.flashMsg}<span class="fx-flash" role="status">{c.flashMsg}</span>{/if}
        <button type="button" class="fx-link" onclick={c.newBook}>Novo livro…</button>
        <button type="button" class="fx-link" onclick={c.manageBooks}>Gerenciar…</button>
        <span class="fx-stat mono" data-testid="fx-stat">{plural(books.list.length, 'livro', 'livros')} · {plural(c.groups.length, 'conta', 'contas')}</span>
      </footer>
    {:else}
      <div class="fx-cols">
        <section class="fx-col fx-parent" aria-label="Parent folder">
          {#if nav.parent != null}
            <MillerColumn entries={nav.parentEntries} cursor={nav.parentCursor} label="Parent folder" idPrefix="fx-parent" rowHeight={rowH} onpick={c.pickParent} ondropnote={(k, t) => void c.dropNote(k, t)} />
          {:else}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <div class="fx-book" role="button" tabindex="-1" onclick={() => void c.setLevel('books')} data-hint-target>
              <span class="ui-eyebrow">livro</span><span class="fx-book-name">{bookName}</span><span class="fx-book-meta">{plural(notes.list.length, 'nota', 'notas')} · h: livros</span>
            </div>
          {/if}
        </section>
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
        <section class="fx-col fx-current" aria-label="Current folder" oncontextmenu={c.onColumnContext}>
          {#if c.filterOpen || nav.filter}
            <div class="fx-filter">
              <span class="fx-slash" aria-hidden="true">/</span>
              <input
                class="fx-filter-input"
                type="search"
                placeholder="filter"
                aria-label="Filter folder"
                value={nav.filter}
                bind:this={c.filterInput}
                oninput={(e) => nav.setFilter(e.currentTarget.value)}
                onfocus={() => (c.filterFocused = true)}
                onblur={() => (c.filterFocused = false)}
                onkeydown={c.onFilterKey}
              />
              <span class="fx-count mono">{nav.entries.length}</span>
            </div>
          {/if}
          <MillerColumn
            bind:this={c.col}
            bind:element={c.colEl}
            entries={nav.entries}
            cursor={nav.cursor}
            label="Folder {nav.dir || bookName}"
            idPrefix="fx-cur"
            active
            rowHeight={rowH}
            openKey={startNote ? 'n:' + startNote : null}
            yankedKey={yanked?.key ?? null}
            emptyText={nav.filter ? 'No matches' : 'Empty folder — a to create'}
            onpick={c.pickCurrent}
            onopen={c.openCurrent}
            onrowaction={sheet ? undefined : c.rowAction}
            ondragnote={sheet ? undefined : c.dragNote}
            oncontext={c.onRowContext}
            ondropnote={(k, t) => void c.dropNote(k, t)}
          />
        </section>
        <section class="fx-col fx-preview" aria-label="Preview">
          {#if cur?.kind === 'folder' && nav.previewEntries}
            <MillerColumn entries={nav.previewEntries} cursor={nav.previewCursor} label="Contents of {cur.path}" idPrefix="fx-preview" emptyText={cur.virtual ? 'New folder — a to create a note in it' : 'Empty folder'} onpick={c.pickPreview} ondropnote={(k, t) => void c.dropNote(k, t)} />
          {:else if curNote}
            {#if FxNotePreview.current}
              <FxNotePreview.current {vaultID} note={curNote} onopen={c.openPreviewed} />
            {:else}
              <div class="fx-skel" aria-hidden="true"><span class="skeleton"></span><span class="skeleton short"></span><span class="skeleton"></span><span class="skeleton mid"></span></div>
            {/if}
          {:else}
            <div class="fx-empty">Nothing here</div>
          {/if}
        </section>
      </div>

      <FxPromptBar bind:this={c.promptBar} bind:prompt={c.prompt} bind:busy={c.busy} dir={nav.dir} run={(p, plan) => ops.run(p, plan, nav)} ondone={() => void c.focusCol()} />
      {#if !c.prompt && c.pendingDelete}
        <div class="fx-bar danger" role="alertdialog" aria-label="Confirm delete" data-testid="delete-confirm">
          <span>Delete <strong>{c.pendingDelete.name}</strong>? The markdown file is removed from the book.</span>
          <span class="fx-spacer"></span>
          <button class="ui-btn sm ghost" type="button" onclick={() => (c.pendingDelete = null)}>Cancel <kbd>n</kbd></button>
          <button class="ui-btn sm danger solid" type="button" onclick={() => void c.confirmDelete()}>Delete <kbd>y</kbd></button>
        </div>
      {/if}
      <!-- The footer is the explorer's command legend (context-aware,
           fitted to the width, clickable) plus a small item count. -->
      <footer class="fx-status" data-testid="fx-footer">
        <CommandLegend embedded items={c.legendItems} onaction={c.legendAction} onmore={() => c.appKey({ kind: 'help' })} />
        {#if c.flashMsg}<span class="fx-flash" role="status">{c.flashMsg}</span>{/if}
        <span class="fx-stat mono" data-testid="fx-stat">{nav.entries.length} {nav.entries.length === 1 ? 'item' : 'items'}{nav.filter ? ` · “${nav.filter}”` : ''}{nav.showHidden ? ' · hidden shown' : ''}{yanked ? ` · yanked ${yanked.name}` : ''}</span>
      </footer>
    {/if}
    <div class="ui-sr-only" aria-live="polite" data-testid="nav-live">{liveMsg}</div>
  </div>
</div>

{#if c.menu}
  <ContextMenu x={c.menu.x} y={c.menu.y} items={c.menu.items} title={c.menu.title} onrun={c.runMenu} onclose={c.closeMenu} />
{/if}

{#if c.hintsOpen}
  <HintOverlay root={() => c.rootEl} onclose={() => { c.hintsOpen = false; }} />
{/if}

<style>
  /* The explorer floats: a dim, slightly vignetted scrim (no blur — the
     panel's own glass does the blurring, one layer only) and a glass
     panel lit from above. */
  .fx-scrim {
    position: fixed;
    inset: 0;
    z-index: 280;
    display: grid;
    place-items: center;
    padding: var(--sp-4);
    background:
      radial-gradient(120% 90% at 50% 40%, transparent 40%, rgb(var(--shadow-rgb) / calc(var(--shadow-a) * 0.55))),
      var(--scrim);
    /* Depth: the scrim eases in (soft, opacity only) and its vignette
       deepens; no backdrop blur here — the panel's own glass is the one
       blurred layer (a second full-viewport blur doubled frame cost). */
    animation: fx-scrim-in var(--spring-soft-ms) var(--spring-soft) both;
    transition: background-color var(--dur-fade) var(--ease), opacity var(--dur-fade) var(--ease);
  }
  @keyframes fx-scrim-in { from { opacity: 0; } }
  .fx {
    position: relative;
    /* Most of the viewport (the note behind is dimmed anyway), capped
       so a 2560 px screen does not get a sprawling panel. */
    width: min(1680px, 90vw);
    height: min(1180px, 86vh);
    display: flex;
    flex-direction: column;
    background: var(--glass-bg);
    -webkit-backdrop-filter: var(--glass-blur);
    backdrop-filter: var(--glass-blur);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-xl);
    box-shadow: var(--elev-4), var(--edge-light);
    overflow: hidden;
    outline: none;
    /* Grows from its trigger on the bouncy spring (flyIn, JS: no CSS
       transform transition here, the engine writes transform). */
    transform-origin: 50% 35%;
  }
  /* A faint wash of the accent along the top edge: the panel's "light". */
  .fx::before {
    content: '';
    position: absolute;
    inset: 0 0 auto;
    height: 120px;
    background: radial-gradient(60% 100% at 30% 0%, var(--accent-wash), transparent 70%);
    pointer-events: none;
  }
  /* Dragging a note out to a pane edge: the overlay steps aside. */
  .fx-scrim.dragging-out { pointer-events: none; background: transparent; }
  .fx-scrim.dragging-out .fx { opacity: 0.22; transform: scale(0.94); transition: opacity var(--dur-fade) var(--ease), transform var(--spring-gentle-ms) var(--spring-gentle); }
  .fx-cols {
    position: relative;
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(140px, 0.85fr) minmax(200px, 1.25fr) minmax(0, 2.4fr);
  }
  .fx.no-preview .fx-cols { grid-template-columns: minmax(140px, 0.85fr) minmax(0, 3fr) 0; }
  .fx.no-preview .fx-preview { display: none; }
  .fx-col { min-width: 0; min-height: 0; display: flex; flex-direction: column; border-right: 1px solid var(--hairline-soft); }
  .fx-parent { background: color-mix(in oklch, var(--surface-sunk) 45%, transparent); }
  .fx-parent :global(.row) { color: var(--ink-2); }
  .fx-preview { border-right: none; overflow-y: auto; background: color-mix(in oklch, var(--surface-0) 55%, transparent); }
  .fx-book { display: flex; flex-direction: column; gap: 2px; padding: var(--sp-4) var(--sp-3); cursor: pointer; border-radius: var(--radius); margin: 6px; transition: background var(--dur-tap) var(--ease); }
  .fx-book:hover { background: var(--tint-hover); }
  .fx-book-name { font-weight: 650; letter-spacing: var(--tracking-ui); }
  .fx-book-meta { font-size: var(--text-xs); color: var(--ink-3); }
  .fx-filter { display: flex; align-items: center; gap: var(--sp-2); height: 34px; padding: 0 var(--sp-3); border-bottom: 1px solid var(--accent-soft); background: var(--accent-wash); animation: ui-rise var(--spring-snappy-ms) var(--spring-snappy); }
  .fx-slash { font-family: var(--font-mono); color: var(--accent); font-weight: 700; }
  .fx-filter-input { flex: 1; min-width: 0; border: none; outline: none; background: transparent; color: var(--color-text); font-family: var(--font-mono); font-size: var(--text-sm); }
  .fx-count { font-size: var(--text-2xs); color: var(--ink-3); }
  .fx-empty { padding: var(--sp-6); text-align: center; color: var(--ink-3); font-size: var(--text-sm); }
  .fx-skel { display: flex; flex-direction: column; gap: 10px; }
  .fx-skel span { display: block; height: 10px; border-radius: 5px; }
  .fx-skel .short { width: 55%; }
  .fx-skel .mid { width: 78%; }
  .fx-bar, .fx-status {
    position: relative;
    flex: none;
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    min-height: 34px;
    padding: 0 var(--sp-3) 0 var(--sp-4);
    border-top: 1px solid var(--hairline-soft);
    font-size: var(--text-xs);
  }
  .fx-bar { background: var(--surface-1); animation: ui-rise var(--spring-snappy-ms) var(--spring-snappy); }
  .fx-bar.danger { background: color-mix(in oklch, var(--color-error) 9%, var(--surface-1)); font-size: var(--text-sm); animation: ui-rise var(--spring-snappy-ms) var(--spring-snappy), shake 360ms var(--ease) 60ms; }
  .fx-status { background: color-mix(in oklch, var(--surface-sunk) 50%, transparent); }
  .fx-stat { flex: none; color: var(--ink-4); font-size: var(--text-2xs); font-variant-numeric: tabular-nums; }
  .fx-flash { flex: none; color: var(--color-text); background: var(--accent-soft); padding: 1px 8px; border-radius: var(--radius-xs); font-size: var(--text-2xs); animation: badge-pop var(--spring-bouncy-ms) var(--spring-bouncy) both; }
  @keyframes badge-pop { from { opacity: 0; transform: scale(0.85) translateY(3px); } }
  .fx-link { flex: none; border: none; background: transparent; color: var(--ink-3); font: inherit; font-size: var(--text-2xs); cursor: pointer; padding: 2px 6px; border-radius: var(--radius-sm); }
  .fx-link:hover { color: var(--color-text); background: var(--tint-hover); }
  .mono { font-family: var(--font-mono); }

  /* ── narrow: a full-height sheet, one column, touch-sized rows ── */
  .fx-scrim.sheet { padding: 0; place-items: end stretch; }
  .fx.sheet {
    width: 100%;
    height: calc(100% - 12px);
    height: calc(100dvh - 12px);
    border-radius: var(--radius-xl) var(--radius-xl) 0 0;
    border-bottom: none;
    animation: sheet-up var(--spring-gentle-ms) var(--spring-gentle) both;
    padding-bottom: env(safe-area-inset-bottom, 0);
  }
  @keyframes sheet-up { from { transform: translateY(100%); } }
  .fx-grab { flex: none; width: 36px; height: 4px; margin: 6px auto 0; border-radius: 2px; background: color-mix(in oklch, var(--color-text) 22%, transparent); }
  .fx.sheet .fx-cols { grid-template-columns: minmax(0, 1fr); }
  .fx.sheet .fx-parent, .fx.sheet .fx-preview { display: none; }
  .fx.sheet .fx-current { border-right: none; }
  .fx.sheet .fx-current :global(.row) { font-size: var(--text-md); }
  .fx-cols.shelf { grid-template-columns: minmax(0, 1.45fr) minmax(0, 1fr); transform-origin: 50% 40%; }
  .fx-cols.shelf .fx-current { background: color-mix(in oklch, var(--surface-sunk) 30%, transparent); }
  .fx.sheet .fx-cols.shelf { grid-template-columns: minmax(0, 1fr); }
</style>
