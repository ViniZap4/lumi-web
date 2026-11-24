<script lang="ts" module>
  import type { Entry, FolderEntry, NoteEntry } from '../lib/notetree.ts';
  import type { CreatePlan, RenamePlan, FolderRenamePlan } from '../lib/fileops.ts';
  import type { MillerNav } from '../lib/miller.svelte.ts';
  import type { ShellAction } from '../lib/shell-keymap.ts';

  export type FxPrompt = { kind: 'create'; text: string } | { kind: 'rename'; text: string; entry: Entry };
  export type FxPlan = CreatePlan | RenamePlan | FolderRenamePlan;
  export type FxLevel = 'files' | 'books';
  /** What the overlay does right after it opens (reader `a`, `r`, the
   *  context menu's Delete, the palette's "Filter…"). */
  export type FxInitial = 'create' | 'createCanvas' | 'newFolder' | 'rename' | 'delete' | 'filter' | 'paste' | null;

  /** File operations, run by the view. */
  export interface FxOps {
    offline(): boolean;
    run(p: FxPrompt, plan: FxPlan, nav: MillerNav): Promise<void>;
    remove(entry: Entry): Promise<void>;
    paste(src: Entry, nav: MillerNav): Promise<void>;
    /** Drag a note onto a folder: move it there. Returns a status line. */
    move?(noteKey: string, folder: FolderEntry): Promise<string | null>;
    /** Copy a markdown link to the note. */
    copyLink?(entry: NoteEntry): void;
    refresh?(): void;
  }

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
  // and dragging a note onto a folder all work in here.
  import { onMount, onDestroy, tick, untrack } from 'svelte';
  import { MillerNav as Nav } from '../lib/miller.svelte.ts';
  import { ShellKeymap } from '../lib/shell-keymap.ts';
  import { notes } from '../lib/notes.svelte.ts';
  import { books } from '../lib/books.svelte.ts';
  import { sync } from '../lib/sync.svelte.ts';
  import { serverLabel } from '../lib/serverurl.ts';
  import { dirOf, breadcrumb, parentDir } from '../lib/notetree.ts';
  import { planCreate, planRename, planFolderRename } from '../lib/fileops.ts';
  import { loadNote, peekNote } from '../lib/note-content.ts';
  import { previewExcerpt, updatedLabel } from '../lib/hover-preview.ts';
  import { renderBlocks } from '../lib/markdown.ts';
  import { captureFocus } from '../lib/list-keys.ts';
  import { menuFor, type MenuItem } from '../lib/context-actions.ts';
  import { accountGroups, cursorAt, booksStep, bookAt, type BooksCursor, type BooksKey } from '../lib/books-nav.ts';
  import { selectorOrder } from '../lib/books-model.ts';
  import { STATE_LABEL } from '../lib/bookstatus.ts';
  import { editorSettings } from '../lib/editor-settings.svelte.ts';
  import { stagger, animate, SPRING } from '../lib/motion.ts';
  import type { OpenWhere } from '../lib/link-open.ts';
  import MillerColumn from './MillerColumn.svelte';
  import MarkdownView from './MarkdownView.svelte';
  import CanvasMini from './CanvasMini.svelte';
  import KanbanMini from './KanbanMini.svelte';
  import NoteIcon from './NoteIcon.svelte';
  import { previewKindFor } from '../lib/preview/structured-preview.ts';
  import type { NoteContent } from '../lib/types.ts';
  import ContextMenu from './ContextMenu.svelte';
  import HintOverlay from './HintOverlay.svelte';
  import SyncDot from './SyncDot.svelte';
  import CommandLegend from './CommandLegend.svelte';
  import { explorerLegend, type LegendItem } from '../lib/legend.ts';

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

  const nav = new Nav(() => notes.list);
  const keymap = new ShellKeymap();
  const restoreFocus = captureFocus();
  nav.showHidden = rememberedHidden;

  let level = $state<FxLevel>(untrack(() => startLevel));
  let rootEl = $state<HTMLElement | null>(null);
  let colEl = $state<HTMLElement | null>(null);
  let col = $state<{ pageRows(): number } | null>(null);
  let booksEl = $state<HTMLElement | null>(null);
  let filterOpen = $state(false);
  let filterInput = $state<HTMLInputElement | null>(null);
  let prompt = $state<FxPrompt | null>(null);
  let promptInput = $state<HTMLInputElement | null>(null);
  let promptErr = $state<string | null>(null);
  let pendingDelete = $state<Entry | null>(null);
  let busy = $state(false);
  let pending = $state<string | null>(null);
  let flashMsg = $state<string | null>(null);
  let flashTimer: ReturnType<typeof setTimeout> | null = null;
  let showPreview = $state(true);
  let menu = $state<{ x: number; y: number; items: MenuItem[]; entry: Entry | null; title: string } | null>(null);
  let hintsOpen = $state(false);

  // Narrow screens: a full-height sheet with touch-sized rows.
  let mqNarrow = $state(false);
  const sheet = $derived(narrowProp ?? mqNarrow);
  const rowH = $derived(sheet ? 44 : 30);

  // Start at the current note's folder, cursor on the note.
  untrack(() => {
    const n = startNote ? notes.list.find((x) => x.id === startNote) : null;
    if (n) nav.reveal(n.id);
    else nav.goTo(startDir);
  });

  const crumbs = $derived(breadcrumb(nav.dir));
  const cur = $derived(nav.current);
  const curNote = $derived(cur?.kind === 'note' ? cur.note : null);
  const liveMsg = $derived(
    level === 'books'
      ? `Books, ${books.list.length} books`
      : `${nav.dir === '' ? bookName + ' root' : nav.dir}, ${nav.entries.length} items` + (nav.filter ? `, filtered by “${nav.filter}”` : ''),
  );

  // ---- books level -------------------------------------------------------------
  const groups = $derived(accountGroups(books.list));
  const order = $derived(selectorOrder(books.list));
  let bc = $state<BooksCursor>(untrack(() => cursorAt(accountGroups(books.list), books.activeID)));
  const bookUnder = $derived(bookAt(groups, bc));
  const accountUnder = $derived(groups[bc.account] ?? null);

  // Note preview (excerpt, shared renderer).
  let previewBody = $state<string | null>(null);
  /** Full content: canvases / boards preview as a mini canvas / board. */
  let previewContent = $state<NoteContent | null>(null);
  let previewErr = $state<string | null>(null);
  let previewTimer: ReturnType<typeof setTimeout> | null = null;
  $effect(() => {
    const n = curNote;
    untrack(() => {
      if (previewTimer) clearTimeout(previewTimer);
      previewErr = null;
      if (!n) {
        previewBody = null;
        previewContent = null;
        return;
      }
      const hit = peekNote(vaultID, n.id);
      previewBody = hit ? previewExcerpt(hit.content.body, 120).text : null;
      previewContent = hit ? hit.content : null;
      // Holding j/k must not fire one request per row.
      previewTimer = setTimeout(() => {
        loadNote(vaultID, n.id).then(
          (r) => {
            if (curNote?.id !== n.id) return;
            previewContent = r.content;
            previewBody = previewExcerpt(r.content.body, 120).text;
          },
          (e) => { if (curNote?.id === n.id) previewErr = (e as Error).message; },
        );
      }, hit ? 0 : 90);
    });
  });
  const previewKind = $derived(curNote ? previewKindFor(curNote, previewContent?.id === curNote.id ? previewContent : null) : 'markdown');
  // Only markdown previews render the excerpt as blocks.
  const previewBlocks = $derived(previewBody != null && previewKind === 'markdown' ? renderBlocks(previewBody) : []);
  function openPreviewed(): void {
    const n = curNote;
    if (n) onopen(n.id, 'current', rowNameEl());
  }

  const promptPlan: FxPlan | null = $derived.by(() => {
    const p = prompt;
    if (!p || !p.text.trim()) return null;
    if (p.kind === 'create') return planCreate(nav.dir, p.text);
    if (p.entry.kind === 'folder') return planFolderRename(p.entry.path, p.text);
    return planRename(p.entry.path, p.entry.note.title ?? p.entry.name, p.text);
  });
  const promptPreview = $derived.by(() => {
    const pl = promptPlan;
    if (!pl) return prompt?.kind === 'create' ? 'name · a/b/name · dir/' : 'new name · dir/name · dir/';
    switch (pl.kind) {
      case 'error': return pl.message;
      case 'none': return 'unchanged';
      case 'folder': return 'path' in pl ? `folder ${pl.path}/` : `move folder → ${pl.to}/`;
      case 'note':
        if ('folder' in pl) return `note “${pl.title}” in ${pl.folder ? pl.folder + '/' : 'book root'}`;
        return [pl.title ? `title “${pl.title}”` : '', pl.path ? `→ ${pl.path}` : ''].filter(Boolean).join(' · ');
    }
    return '';
  });

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
    void tick().then(() => {
      focusCurrent();
      entrance();
      runInitial();
    });
    return () => mq?.removeEventListener?.('change', onmq);
  });
  onDestroy(() => {
    if (previewTimer) clearTimeout(previewTimer);
    if (flashTimer) clearTimeout(flashTimer);
    rememberedHidden = nav.showHidden;
    restoreFocus();
  });

  /** Rows stagger in when the overlay opens (and on a level change). */
  function entrance(): void {
    const host = level === 'books' ? booksEl : colEl;
    if (host) stagger(Array.from(host.querySelectorAll<HTMLElement>('[role="option"]')).slice(0, 14));
  }

  // Folder travel (l / h): the columns shift like a camera moving one
  // step deeper or back — the new current column slides in from the
  // side you are heading to, its rows ripple in, the preview fades up.
  // Fire-and-forget; keys typed mid-animation apply at once.
  let lastDir: string | null = null;
  $effect(() => {
    const d = nav.dir;
    const prev = untrack(() => lastDir);
    lastDir = d;
    if (prev == null || prev === d || level !== 'files') return;
    const deeper = d.length > prev.length && d.startsWith(prev);
    const s = SPRING.gentle;
    void tick().then(() => {
      const cols = rootEl?.querySelectorAll<HTMLElement>('.fx-col');
      if (!cols || cols.length < 3) return;
      const dx = deeper ? 14 : -14;
      animate(cols[0], [{ opacity: 0.5, transform: `translateX(${dx * 0.6}px)` }, { opacity: 1, transform: 'none' }], s.ms, s.easing);
      animate(cols[1], [{ opacity: 0.35, transform: `translateX(${dx}px)` }, { opacity: 1, transform: 'none' }], s.ms, s.easing);
      animate(cols[2], [{ opacity: 0 }, { opacity: 1 }], s.ms, s.easing, 40);
      if (colEl) stagger(Array.from(colEl.querySelectorAll<HTMLElement>('[role="option"]')).slice(0, 12), { step: 14, max: 120, y: 0 });
    });
  });

  function runInitial(): void {
    switch (initial) {
      case 'create': return run({ kind: 'create' });
      case 'createCanvas':
        if (ops.offline()) return flash('creating needs the server');
        void openPrompt({ kind: 'create', text: '.canvas' }, true);
        return;
      case 'newFolder':
        if (ops.offline()) return flash('creating needs the server');
        void openPrompt({ kind: 'create', text: '/' }, true);
        return;
      case 'rename': return run({ kind: 'rename' });
      case 'delete': return run({ kind: 'delete' });
      case 'filter': return void openFilter();
      case 'paste': return run({ kind: 'paste' });
    }
  }

  function flash(t: string): void {
    flashMsg = t;
    if (flashTimer) clearTimeout(flashTimer);
    flashTimer = setTimeout(() => (flashMsg = null), 3000);
  }

  function close(): void {
    onclose(nav.dir);
  }

  function rowNameEl(): HTMLElement | null {
    return colEl?.querySelector<HTMLElement>('.row.cursor .name') ?? null;
  }

  function open(where: OpenWhere): void {
    const c = nav.current;
    if (c?.kind === 'note') onopen(c.note.id, where, rowNameEl());
    else if (c?.kind === 'folder' && where === 'current') nav.right();
  }

  function focusCurrent(): void {
    (level === 'books' ? booksEl : colEl)?.focus({ preventScroll: true });
  }

  async function focusCol(): Promise<void> {
    await tick();
    focusCurrent();
  }

  async function setLevel(l: FxLevel): Promise<void> {
    if (level === l) return;
    level = l;
    onlevel?.(l);
    filterOpen = false;
    if (l === 'books') bc = cursorAt(groups, books.activeID);
    await focusCol();
    entrance();
  }

  function onKey(e: KeyboardEvent): void {
    // Text fields (filter, prompt) handle their own keys.
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    // Buttons inside keep Enter / Space (Tab to them, then activate).
    if (t && t.tagName === 'BUTTON' && (e.key === 'Enter' || e.key === ' ')) return;
    e.stopPropagation();
    if (pendingDelete) {
      e.preventDefault();
      if (e.key === 'y' || e.key === 'Y' || e.key === 'Enter') void confirmDelete();
      else if (e.key === 'n' || e.key === 'N' || e.key === 'Escape' || e.key === 'q') pendingDelete = null;
      return;
    }
    if (level === 'files' && e.ctrlKey && !e.metaKey && !e.altKey && (e.key === 'v' || e.key === 's')) {
      e.preventDefault();
      open(e.key === 'v' ? 'vsplit' : 'hsplit');
      return;
    }
    if (e.key === 'Tab') return;
    if (e.key === 'Enter') {
      e.preventDefault();
      keymap.reset();
      pending = null;
      if (level === 'books') booksKey({ kind: 'open' });
      else open('current');
      return;
    }
    const a = keymap.feed(e, 'explorer');
    pending = keymap.pending;
    if (!a) {
      // Keep the page from reacting (Cmd-keys stay the browser's).
      if (!e.metaKey && e.key.length === 1) e.preventDefault();
      return;
    }
    e.preventDefault();
    if (a.kind === 'pending') return;
    if (level === 'books') runBooks(a);
    else run(a);
  }

  /** Keys that belong to the app, not the overlay. */
  function appKey(a: ShellAction): boolean {
    switch (a.kind) {
      case 'palette':
      case 'command':
      case 'help':
      case 'settings':
      case 'book':
      case 'prevBook':
      case 'nextBook':
        onapp?.(a);
        return true;
    }
    return false;
  }

  function run(a: ShellAction): void {
    if (appKey(a)) return;
    const page = col?.pageRows() ?? 10;
    switch (a.kind) {
      case 'move': nav.move(a.n); return;
      case 'halfPage': nav.move(a.dir * Math.ceil(page / 2)); return;
      case 'page': nav.move(a.dir * page); return;
      case 'top': nav.top(); return;
      case 'bottom': nav.bottom(); return;
      case 'parent':
        // Above the book root: the books (accounts → books).
        if (!nav.left()) void setLevel('books');
        return;
      case 'open': {
        const n = nav.current;
        if (n?.kind === 'note') onopen(n.note.id, 'current', rowNameEl());
        else nav.right();
        return;
      }
      case 'edit': {
        const n = nav.current;
        if (n?.kind === 'note') onedit?.(n.note.id);
        return;
      }
      case 'picker': void setLevel('books'); return;
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
        else close();
        return;
      case 'close': close(); return;
      case 'toggleHidden':
        nav.toggleHidden();
        flash(nav.showHidden ? 'showing hidden files' : 'hiding dot-files');
        return;
      case 'togglePreview': showPreview = !showPreview; return;
      case 'refresh':
        ops.refresh?.();
        flash('refreshing…');
        return;
      case 'hints': hintsOpen = true; return;
      case 'menu': openMenuAtCursor(); return;
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
          if (c.virtual) {
            nav.removeFolder(c.path);
            flash(`removed empty folder ${c.name}/`);
          } else flash('delete the notes inside to remove a folder');
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
      case 'paste': {
        const y = yanked;
        if (!y) return flash('nothing yanked — y on a note first');
        if (ops.offline()) return flash('pasting needs the server');
        void guarded(() => ops.paste(y, nav), `pasted a copy of ${y.name}`);
        return;
      }
      default:
        return;
    }
  }

  // ---- books level ---------------------------------------------------------------

  function booksKey(k: BooksKey): void {
    const step = booksStep(groups, bc, k);
    bc = step.cursor;
    if (!step.open) return;
    if (step.open.id === books.activeID) void setLevel('files');
    else onbook?.(step.open.id);
  }

  function runBooks(a: ShellAction): void {
    if (a.kind === 'book') {
      const b = order[a.n - 1];
      if (b) {
        if (b.id === books.activeID) void setLevel('files');
        else onbook?.(b.id);
      }
      return;
    }
    if (appKey(a)) return;
    switch (a.kind) {
      case 'move': return booksKey({ kind: 'move', n: a.n });
      case 'halfPage':
      case 'page': return booksKey({ kind: 'move', n: a.dir * 5 });
      case 'top': return booksKey({ kind: 'top' });
      case 'bottom': return booksKey({ kind: 'bottom' });
      case 'parent': return booksKey({ kind: 'parent' });
      case 'open': return booksKey({ kind: 'open' });
      case 'home': return void setLevel('files');
      case 'clearOrBack':
      case 'close': return close();
      case 'create': return newBook();
      case 'hints': hintsOpen = true; return;
      case 'refresh':
        void books.refreshAll();
        flash('refreshing books…');
        return;
    }
  }

  function chooseBook(accountIdx: number, bookIdx: number): void {
    bc = { level: 'books', account: accountIdx, book: bookIdx };
    booksKey({ kind: 'open' });
  }

  function pickAccount(i: number): void {
    bc = { level: 'books', account: i, book: 0 };
    void focusCol();
  }

  function newBook(): void {
    close();
    onnewbook?.();
  }

  // ---- file ops ----------------------------------------------------------------------

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

  async function openPrompt(p: FxPrompt, caretAtStart = false): Promise<void> {
    prompt = p;
    promptErr = null;
    await tick();
    promptInput?.focus();
    if (caretAtStart) promptInput?.setSelectionRange(0, 0);
    else promptInput?.select();
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
    void focusCol();
  }

  async function dropNote(key: string, target: Entry): Promise<void> {
    if (target.kind !== 'folder' || !ops.move) return;
    if (ops.offline()) return flash('moving needs the server');
    try {
      const msg = await ops.move(key, target);
      if (msg) flash(msg);
      nav.removeFolder(target.path);
    } catch (e) {
      flash((e as Error).message);
    }
  }

  // ---- context menu ------------------------------------------------------------------

  function openMenu(x: number, y: number, entry: Entry | null): void {
    const items = menuFor(entry, { offline: ops.offline(), canPaste: !!yanked });
    const title = entry ? (entry.kind === 'note' ? (entry.note.title ?? entry.name) : entry.name + '/') : (nav.dir || bookName);
    menu = { x, y, items, entry, title };
  }
  function openMenuAtCursor(): void {
    const row = colEl?.querySelector<HTMLElement>('.row.cursor');
    const r = row?.getBoundingClientRect() ?? colEl?.getBoundingClientRect();
    openMenu((r?.left ?? 0) + 24, (r?.bottom ?? 0) + 2, nav.current ?? null);
  }
  function onRowContext(i: number, e: Entry, ev: MouseEvent): void {
    nav.setCursor(i);
    openMenu(ev.clientX, ev.clientY, e);
  }
  function onColumnContext(ev: MouseEvent): void {
    if ((ev.target as HTMLElement | null)?.closest('[role="option"]')) return;
    ev.preventDefault();
    openMenu(ev.clientX, ev.clientY, null);
  }
  function runMenu(it: MenuItem): void {
    const e = menu?.entry ?? null;
    menu = null;
    if (it.action === 'openRight' || it.action === 'openBelow') {
      if (e?.kind === 'note') onopen(e.note.id, it.action === 'openRight' ? 'vsplit' : 'hsplit', rowNameEl());
      return;
    }
    if (it.action === 'copyLink') {
      if (e?.kind === 'note') ops.copyLink?.(e);
      return;
    }
    if (it.action === 'newFolder') {
      if (ops.offline()) return flash('creating needs the server');
      void openPrompt({ kind: 'create', text: '/' }, true);
      return;
    }
    run({ kind: it.action } as ShellAction);
  }

  // ---- mouse ---------------------------------------------------------------------------

  // Click selects (a folder enters), double-click opens.
  function pickCurrent(i: number, e: Entry): void {
    nav.setCursor(i);
    if (e.kind === 'folder') nav.right();
    else if (sheet) onopen(e.note.id, 'current', rowNameEl());
    void focusCol();
  }
  // ---- footer legend ---------------------------------------------------------------
  let filterFocused = $state(false);
  const legendState = $derived(
    level === 'books' ? 'books' : pendingDelete ? 'confirm' : prompt ? 'prompt' : filterFocused ? 'filter' : 'files',
  );
  const legendItems = $derived(explorerLegend(legendState));

  /** A legend item was clicked: the same action its keys run. */
  function legendAction(it: LegendItem): void {
    const d = it.do;
    if (!d) return;
    const [ns, arg] = [d.slice(0, d.indexOf(':')), d.slice(d.indexOf(':') + 1)];
    if (ns === 'shell') {
      const a = { kind: arg } as ShellAction;
      if (level === 'books') runBooks(a);
      else run(a);
    } else if (ns === 'fx') {
      switch (arg) {
        case 'down': if (level === 'books') runBooks({ kind: 'move', n: 1 }); else run({ kind: 'move', n: 1 }); break;
        case 'vsplit': open('vsplit'); return;
        case 'hsplit': open('hsplit'); return;
        case 'filterKeep': filterOpen = nav.filter !== ''; break;
        case 'filterClear': nav.setFilter(''); filterOpen = false; break;
        case 'promptSubmit': void submitPrompt(); return;
        case 'promptCancel': prompt = null; break;
        case 'confirmYes': void confirmDelete(); return;
        case 'confirmNo': pendingDelete = null; break;
      }
    }
    if (!prompt) void focusCol();
  }

  function rowAction(i: number, e: Entry, where: OpenWhere): void {
    nav.setCursor(i);
    if (e.kind === 'note') onopen(e.note.id, where, rowNameEl());
  }
  let draggingOut = $state(false);
  function dragNote(on: boolean): void {
    draggingOut = on;
    ondragnote?.(on);
  }
  function openCurrent(i: number, e: Entry): void {
    nav.setCursor(i);
    if (e.kind === 'note') onopen(e.note.id, 'current', rowNameEl());
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
  function up(): void {
    if (level === 'books') booksKey({ kind: 'parent' });
    else if (!nav.left()) void setLevel('books');
    void focusCol();
  }

  const statusOf = (b: (typeof books.list)[number]) => sync.statusOf(b);
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<div class="fx-scrim" class:sheet class:dragging-out={draggingOut} role="presentation" onclick={close} data-testid="floating-explorer-scrim">
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    class="fx"
    class:sheet
    class:no-preview={!showPreview}
    role="dialog"
    aria-modal="true"
    aria-label={level === 'books' ? 'Books' : 'Explorer'}
    tabindex="-1"
    bind:this={rootEl}
    onclick={(e) => e.stopPropagation()}
    onkeydown={onKey}
    data-testid="floating-explorer"
    data-level={level}
  >
    {#if sheet}<div class="fx-grab" aria-hidden="true"></div>{/if}
    <header class="fx-head">
      {#if sheet && !(level === 'books' && bc.level === 'accounts')}
        <button type="button" class="fx-up" onclick={up} aria-label={level === 'books' ? 'Accounts' : nav.dir ? 'Up a folder' : 'Books'}>
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M10 3.5 5.5 8l4.5 4.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      {/if}
      <svg class="fx-glyph" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        {#if level === 'books'}
          <path d="M3 2.75h7.5a1.5 1.5 0 0 1 1.5 1.5v9H4.5A1.5 1.5 0 0 1 3 11.75z M3 11.75a1.5 1.5 0 0 1 1.5-1.5H12" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>
        {:else}
          <path d="M1.75 4.25a1.5 1.5 0 0 1 1.5-1.5h3l1.5 1.75h5a1.5 1.5 0 0 1 1.5 1.5v6.25a1.5 1.5 0 0 1-1.5 1.5h-9.5a1.5 1.5 0 0 1-1.5-1.5z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>
        {/if}
      </svg>
      <nav class="fx-crumbs" aria-label={level === 'books' ? 'Books path' : 'Folder path'}>
        <button type="button" class="fx-crumb" aria-current={level === 'books' && bc.level === 'accounts' ? 'location' : undefined} onclick={() => { void setLevel('books').then(() => booksKey({ kind: 'parent' })); }}>Books</button>
        {#if level === 'books'}
          {#if bc.level === 'books' && accountUnder}
            <span class="fx-sep" aria-hidden="true">/</span>
            <span class="fx-crumb static" aria-current="location">{accountUnder.account}@{serverLabel(accountUnder.server_url)}</span>
          {/if}
        {:else}
          {#each crumbs as c, i (c.path)}
            <span class="fx-sep" aria-hidden="true">/</span>
            <button type="button" class="fx-crumb" aria-current={i === crumbs.length - 1 ? 'location' : undefined} onclick={() => { nav.goTo(c.path); void focusCol(); }}>{i === 0 ? bookName : c.name}</button>
          {/each}
        {/if}
      </nav>
      {#if pending}<span class="fx-pending mono">{pending}</span>{/if}
      <button class="ui-btn ghost sm icon" type="button" onclick={close} aria-label="Close explorer">
        <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
      </button>
    </header>

    {#if level === 'books'}
      <div class="fx-cols" data-testid="fx-books">
        <section class="fx-col fx-parent" aria-label="Accounts">
          {#if bc.level === 'books'}
            <div class="fx-list" role="listbox" aria-label="Accounts" tabindex="-1">
              {#each groups as g, i (g.key)}
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <div class="fx-row" class:cursor={i === bc.account} role="option" tabindex="-1" aria-selected={i === bc.account} data-hint-target style="height: {rowH}px" onclick={() => pickAccount(i)}>
                  <span class="fx-row-name">{g.account}</span><span class="fx-row-meta">{serverLabel(g.server_url)}</span>
                </div>
              {/each}
            </div>
          {:else}
            <div class="fx-book"><span class="ui-eyebrow">accounts</span><span class="fx-book-name">{groups.length}</span><span class="fx-book-meta">{books.list.length} books on this device</span></div>
          {/if}
        </section>
        <section class="fx-col fx-current" aria-label={bc.level === 'accounts' ? 'Accounts' : 'Books'}>
          <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
          <div
            class="fx-list active"
            role="listbox"
            tabindex="0"
            aria-label={bc.level === 'accounts' ? 'Accounts' : 'Books'}
            aria-activedescendant={bc.level === 'accounts' ? `fxa-${bc.account}` : `fxb-${bc.book}`}
            bind:this={booksEl}
            data-testid="fx-books-list"
          >
            {#if bc.level === 'accounts'}
              {#each groups as g, i (g.key)}
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <div id="fxa-{i}" class="fx-row" class:cursor={i === bc.account} role="option" tabindex="-1" aria-selected={i === bc.account} data-hint-target style="height: {rowH}px" onclick={() => pickAccount(i)}>
                  <span class="fx-row-name">{g.account}</span><span class="fx-row-meta">{serverLabel(g.server_url)} · {g.books.length}</span><span class="chev" aria-hidden="true">›</span>
                </div>
              {/each}
            {:else if accountUnder}
              {#each accountUnder.books as b, i (b.id)}
                {@const st = statusOf(b)}
                {@const n = order.findIndex((x) => x.id === b.id) + 1}
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <div
                  id="fxb-{i}"
                  class="fx-row"
                  class:cursor={i === bc.book}
                  class:current={b.id === books.activeID}
                  role="option"
                  tabindex="-1"
                  aria-selected={i === bc.book}
                  aria-current={b.id === books.activeID ? 'true' : undefined}
                  data-hint-target
                  style="height: {rowH}px"
                  onclick={() => (sheet ? chooseBook(bc.account, i) : (bc = { ...bc, book: i }))}
                  ondblclick={() => chooseBook(bc.account, i)}
                >
                  <SyncDot state={st.state} pending={st.pending} vaultID={b.vault_id} />
                  <span class="fx-row-name">{b.name}</span>
                  {#if n > 0 && n <= 9}<span class="fx-row-meta mono">g{n}</span>{/if}
                </div>
              {/each}
            {/if}
            {#if groups.length === 0}<div class="fx-empty">No books yet — a to create one</div>{/if}
          </div>
        </section>
        <section class="fx-col fx-preview" aria-label="Book">
          {#if bookUnder}
            {@const st = statusOf(bookUnder)}
            <div class="fx-note fx-bookcard">
              <div class="fx-note-head">
                <span class="fx-note-title">{bookUnder.name}</span>
                <span class="fx-note-meta">{bookUnder.account}@{serverLabel(bookUnder.server_url)}</span>
              </div>
              <p class="fx-bookline"><SyncDot state={st.state} pending={st.pending} label vaultID={bookUnder.vault_id} /></p>
              <p class="fx-bookline dim">{bookUnder.id === books.activeID ? 'Open now — ⏎ or l goes back to its files' : '⏎ or l opens this book'}</p>
              <p class="fx-bookline dim">{STATE_LABEL[st.state].en}{bookUnder.last_opened_at ? ` · opened ${updatedLabel(bookUnder.last_opened_at)}` : ''}</p>
            </div>
          {:else if accountUnder}
            <div class="fx-note"><div class="fx-note-head"><span class="fx-note-title">{accountUnder.account}</span><span class="fx-note-meta">{serverLabel(accountUnder.server_url)}</span></div>
              <ul class="fx-mini">{#each accountUnder.books as b (b.id)}<li>{b.name}</li>{/each}</ul>
            </div>
          {/if}
        </section>
      </div>
      <footer class="fx-status" data-testid="fx-footer">
        <CommandLegend embedded items={legendItems} onaction={legendAction} onmore={() => appKey({ kind: 'help' })} />
        {#if flashMsg}<span class="fx-flash" role="status">{flashMsg}</span>{/if}
        <button type="button" class="fx-link" onclick={newBook}>New book…</button>
        <button type="button" class="fx-link" onclick={() => { close(); onmanage?.(); }}>Manage…</button>
        <span class="fx-stat mono" data-testid="fx-stat">{books.list.length} books · {groups.length} {groups.length === 1 ? 'account' : 'accounts'}</span>
      </footer>
    {:else}
      <div class="fx-cols">
        <section class="fx-col fx-parent" aria-label="Parent folder">
          {#if nav.parent != null}
            <MillerColumn entries={nav.parentEntries} cursor={nav.parentCursor} label="Parent folder" idPrefix="fx-parent" rowHeight={rowH} onpick={pickParent} ondropnote={(k, t) => void dropNote(k, t)} />
          {:else}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <div class="fx-book" role="button" tabindex="-1" onclick={() => void setLevel('books')} data-hint-target>
              <span class="ui-eyebrow">book</span><span class="fx-book-name">{bookName}</span><span class="fx-book-meta">{notes.list.length} notes · h for books</span>
            </div>
          {/if}
        </section>
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
        <section class="fx-col fx-current" aria-label="Current folder" oncontextmenu={onColumnContext}>
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
                onfocus={() => (filterFocused = true)}
                onblur={() => (filterFocused = false)}
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
            rowHeight={rowH}
            openKey={startNote ? 'n:' + startNote : null}
            yankedKey={yanked?.key ?? null}
            emptyText={nav.filter ? 'No matches' : 'Empty folder — a to create'}
            onpick={pickCurrent}
            onopen={openCurrent}
            onrowaction={sheet ? undefined : rowAction}
            ondragnote={sheet ? undefined : dragNote}
            oncontext={onRowContext}
            ondropnote={(k, t) => void dropNote(k, t)}
          />
        </section>
        <section class="fx-col fx-preview" aria-label="Preview">
          {#if cur?.kind === 'folder' && nav.previewEntries}
            <MillerColumn entries={nav.previewEntries} cursor={nav.previewCursor} label="Contents of {cur.path}" idPrefix="fx-preview" emptyText={cur.virtual ? 'New folder — a to create a note in it' : 'Empty folder'} onpick={pickPreview} ondropnote={(k, t) => void dropNote(k, t)} />
          {:else if curNote}
            <div class="fx-note">
              <div class="fx-note-head">
                <span class="fx-note-title"><NoteIcon kind={previewKind} size={15} /> {curNote.title}</span>
                <span class="fx-note-meta">{dirOf(curNote.path) || '/'} · {updatedLabel(curNote.updated_at)}</span>
              </div>
              {#if previewKind === 'canvas' && previewContent?.id === curNote.id}
                <CanvasMini text={previewContent.body ?? ''} onopen={openPreviewed} />
              {:else if previewKind === 'kanban' && previewContent?.id === curNote.id}
                <KanbanMini text={previewContent.body ?? ''} onopen={openPreviewed} />
              {:else if previewBody != null && previewKind === 'markdown'}
                <div class="lumi-prose compact" data-prose={editorSettings.value.proseFont}><MarkdownView blocks={previewBlocks} /></div>
              {:else if previewErr}
                <div class="fx-empty err">{previewErr}</div>
              {:else}
                <div class="fx-skel" aria-hidden="true"><span class="skeleton"></span><span class="skeleton short"></span><span class="skeleton"></span><span class="skeleton mid"></span></div>
              {/if}
            </div>
          {:else}
            <div class="fx-empty">Nothing here</div>
          {/if}
        </section>
      </div>

      {#if prompt}
        <form class="fx-bar" onsubmit={(e) => { e.preventDefault(); void submitPrompt(); }} data-testid="prompt">
          <span class="fx-tag">{prompt.kind === 'create' ? 'new' : 'rename'}</span>
          <span class="fx-dir mono">{prompt.kind === 'create' ? (nav.dir ? nav.dir + '/' : '/') : ''}</span>
          <input class="fx-input mono" bind:this={promptInput} bind:value={prompt.text} onkeydown={onPromptKey} disabled={busy} autocomplete="off" spellcheck="false" aria-label={prompt.kind === 'create' ? 'New note or folder (end with /)' : 'New name or path'} />
          <span class="fx-hint" class:err={promptPlan?.kind === 'error' || !!promptErr}>{promptErr ?? promptPreview}</span>
        </form>
      {:else if pendingDelete}
        <div class="fx-bar danger" role="alertdialog" aria-label="Confirm delete" data-testid="delete-confirm">
          <span>Delete <strong>{pendingDelete.name}</strong>? The markdown file is removed from the book.</span>
          <span class="fx-spacer"></span>
          <button class="ui-btn sm ghost" type="button" onclick={() => (pendingDelete = null)}>Cancel <kbd>n</kbd></button>
          <button class="ui-btn sm danger solid" type="button" onclick={() => void confirmDelete()}>Delete <kbd>y</kbd></button>
        </div>
      {/if}
      <!-- The footer is the explorer's command legend (context-aware,
           fitted to the width, clickable) plus a small item count. -->
      <footer class="fx-status" data-testid="fx-footer">
        <CommandLegend embedded items={legendItems} onaction={legendAction} onmore={() => appKey({ kind: 'help' })} />
        {#if flashMsg}<span class="fx-flash" role="status">{flashMsg}</span>{/if}
        <span class="fx-stat mono" data-testid="fx-stat">{nav.entries.length} {nav.entries.length === 1 ? 'item' : 'items'}{nav.filter ? ` · “${nav.filter}”` : ''}{nav.showHidden ? ' · hidden shown' : ''}{yanked ? ` · yanked ${yanked.name}` : ''}</span>
      </footer>
    {/if}
    <div class="ui-sr-only" aria-live="polite" data-testid="nav-live">{liveMsg}</div>
  </div>
</div>

{#if menu}
  <ContextMenu x={menu.x} y={menu.y} items={menu.items} title={menu.title} onrun={runMenu} onclose={() => { menu = null; void focusCol(); }} />
{/if}

{#if hintsOpen}
  <HintOverlay root={() => rootEl} onclose={() => { hintsOpen = false; }} />
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
    animation: ui-fade var(--dur-fade) var(--ease);
    transition: background-color var(--dur-fade) var(--ease), opacity var(--dur-fade) var(--ease);
  }
  .fx {
    position: relative;
    width: min(1200px, 80vw);
    height: min(820px, 80vh);
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
    /* Settles with a slight spring. */
    animation: fx-in var(--spring-bouncy-ms) var(--spring-bouncy) both;
    transform-origin: 50% 35%;
    transition: opacity var(--dur-fade) var(--ease), transform var(--spring-gentle-ms) var(--spring-gentle);
  }
  @keyframes fx-in { from { opacity: 0; transform: translateY(10px) scale(0.965); } 30% { opacity: 1; } }
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
  .fx-scrim.dragging-out .fx { opacity: 0.22; transform: scale(0.94); }
  .fx-head {
    position: relative;
    flex: none;
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    height: 44px;
    padding: 0 var(--sp-2) 0 var(--sp-4);
    border-bottom: 1px solid var(--hairline-soft);
  }
  .fx-glyph { flex: none; color: var(--accent); filter: drop-shadow(0 0 6px var(--accent-glow)); }
  .fx-up { flex: none; display: grid; place-items: center; width: 36px; height: 36px; margin-left: -6px; border: none; border-radius: var(--radius); background: transparent; color: var(--color-text); cursor: pointer; }
  .fx-up:active { background: var(--tint-active); }
  .fx-crumbs { flex: 1; min-width: 0; display: flex; align-items: center; gap: 2px; overflow-x: auto; white-space: nowrap; scrollbar-width: none; font-size: var(--text-sm); }
  .fx-crumb { border: none; background: transparent; color: var(--ink-3); padding: 3px 6px; border-radius: var(--radius-sm); cursor: pointer; font-size: inherit; transition: background var(--dur-tap) var(--ease), color var(--dur-fade) var(--ease); }
  .fx-crumb.static { cursor: default; }
  .fx-crumb:not(.static):hover { background: var(--tint-hover); color: var(--color-text); }
  .fx-crumb[aria-current='location'] { color: var(--color-text); font-weight: 600; animation: crumb-in var(--spring-gentle-ms) var(--spring-gentle) both; }
  @keyframes crumb-in { from { opacity: 0; transform: translateX(-4px); } }
  .fx-sep { color: var(--ink-4); }
  .fx-pending { color: var(--color-warning); font-size: var(--text-xs); }
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
  .fx-list { flex: 1; min-height: 0; overflow-y: auto; padding: 6px; outline: none; }
  .fx-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 10px;
    border-radius: var(--radius-sm);
    font-size: var(--text-sm);
    cursor: pointer;
    user-select: none;
    transition: background var(--dur-tap) var(--ease);
  }
  .fx-row:hover { background: var(--tint-hover); }
  .fx-row.cursor { background: var(--tint-hover); }
  .fx-list.active .fx-row.cursor {
    background: linear-gradient(90deg, var(--accent-soft), var(--accent-wash));
    box-shadow: inset 2px 0 0 var(--accent), 0 0 0 1px var(--accent-wash), 0 6px 18px -10px var(--accent-glow);
  }
  .fx-list.active:focus-visible .fx-row.cursor { box-shadow: inset 2px 0 0 var(--accent), inset 0 0 0 1px var(--ring); }
  .fx-row.current .fx-row-name { color: var(--accent-ink); font-weight: 600; }
  .fx-row-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .fx-row-meta { flex: none; font-size: var(--text-2xs); color: var(--ink-3); }
  .chev { flex: none; color: var(--ink-3); }
  .fx-bookline { margin: 0 0 var(--sp-2); font-size: var(--text-sm); }
  .fx-bookline.dim { color: var(--ink-3); font-size: var(--text-xs); }
  .fx-mini { margin: 0; padding-left: 1.1em; font-size: var(--text-sm); color: var(--ink-3); }
  .fx-filter { display: flex; align-items: center; gap: var(--sp-2); height: 34px; padding: 0 var(--sp-3); border-bottom: 1px solid var(--accent-soft); background: var(--accent-wash); animation: ui-rise var(--spring-snappy-ms) var(--spring-snappy); }
  .fx-slash { font-family: var(--font-mono); color: var(--accent); font-weight: 700; }
  .fx-filter-input { flex: 1; min-width: 0; border: none; outline: none; background: transparent; color: var(--color-text); font-family: var(--font-mono); font-size: var(--text-sm); }
  .fx-count { font-size: var(--text-2xs); color: var(--ink-3); }
  /* The preview: a note card that resolves out of its skeleton. */
  .fx-note { padding: var(--sp-5) var(--sp-5) var(--sp-6); animation: resolve-in var(--spring-gentle-ms) var(--spring-gentle) both; }
  .fx-note-head { display: flex; flex-direction: column; gap: 3px; padding-bottom: var(--sp-3); margin-bottom: var(--sp-4); border-bottom: 1px solid var(--hairline-soft); }
  .fx-note-title { font-weight: 700; font-size: var(--text-xl); letter-spacing: var(--tracking-tight); line-height: 1.2; }
  .fx-note-meta { font-family: var(--font-mono); font-size: var(--text-2xs); color: var(--ink-3); }
  .fx-empty { padding: var(--sp-6); text-align: center; color: var(--ink-3); font-size: var(--text-sm); }
  .fx-empty.err { color: var(--color-error); }
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
  .fx-tag { padding: 2px 8px; border-radius: var(--radius-xs); font-family: var(--font-mono); font-size: var(--text-2xs); font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; background: var(--color-primary); color: var(--color-background); box-shadow: 0 0 12px -2px var(--accent-glow); }
  .fx-dir { color: var(--ink-3); }
  .fx-input { flex: 1; min-width: 60px; border: none; outline: none; background: transparent; color: var(--color-text); font-size: var(--text-sm); }
  .fx-hint { flex: none; max-width: 45%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--ink-3); }
  .fx-hint.err { color: var(--color-error); }
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
  .fx.sheet .fx-head { height: 48px; background: transparent; }
  .fx.sheet .fx-cols { grid-template-columns: minmax(0, 1fr); }
  .fx.sheet .fx-parent, .fx.sheet .fx-preview { display: none; }
  .fx.sheet .fx-current { border-right: none; }
  .fx.sheet .fx-row { font-size: var(--text-md); }
  .fx.sheet .fx-current :global(.row) { font-size: var(--text-md); }
</style>
