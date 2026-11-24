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
  import { accountGroups, cursorAt, booksStep, bookAt, hasAccountsLayer, flatIndex, plural, type BooksCursor, type BooksKey } from '../lib/books-nav.ts';
  import { accounts } from '../lib/accounts.svelte.ts';
  import { noteCountOf } from '../lib/book-counts.ts';
  import { motionAllowed } from '../lib/motion.ts';
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
      ? `Livros, ${plural(books.list.length, 'livro', 'livros')}`
      : `${nav.dir === '' ? bookName + ' root' : nav.dir}, ${nav.entries.length} items` + (nav.filter ? `, filtered by “${nav.filter}”` : ''),
  );

  // ---- books level -------------------------------------------------------------
  const groups = $derived(accountGroups(books.list));
  const order = $derived(selectorOrder(books.list));
  let bc = $state<BooksCursor>(untrack(() => cursorAt(accountGroups(books.list), books.activeID)));
  const bookUnder = $derived(bookAt(groups, bc));
  const accountUnder = $derived(groups[bc.account] ?? null);
  /** "Contas e servidores" exists only with many accounts. */
  const accountsLayer = $derived(hasAccountsLayer(groups));
  const atAccounts = $derived(level === 'books' && bc.level === 'accounts');
  const curFlat = $derived(flatIndex(groups, bc));
  /** Notes in a book: live for the open one, last known for the rest. */
  function noteCount(b: { id: string; vault_id: string }): number | null {
    return b.id === books.activeID && notes.list.length ? notes.list.length : noteCountOf(b.vault_id);
  }
  function accountOf(key: string) {
    return accounts.list.find((a) => a.key === key) ?? null;
  }
  /** A stable hue slot per account (avatar tint). */
  function avatarSlot(key: string): number {
    let h = 0;
    for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return h % 4;
  }

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
    if (host) stagger(Array.from(host.querySelectorAll<HTMLElement>('[role="option"], .fx-acct')).slice(0, 14), level === 'books' ? { step: 22, y: 10 } : {});
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
    scopeChange(l === 'books' ? 'out' : 'in');
    entrance();
  }

  /** Books ⇄ files is a change of SCOPE, not a folder step: the camera
   *  pulls back to the shelf (content arrives from 1.04 → 1, the panel
   *  dips to .96 and settles) or dives into a book (0.96 → 1). The DOM
   *  is already final; this only decorates it. */
  function scopeChange(dir: 'out' | 'in'): void {
    if (!motionAllowed() || !rootEl) return;
    const cols = rootEl.querySelector<HTMLElement>('.fx-cols');
    const g = SPRING.gentle;
    const from = dir === 'out' ? 1.04 : 0.96;
    animate(cols, [{ opacity: 0, transform: `scale(${from})`, filter: 'blur(3px)' }, { opacity: 1, transform: 'none', filter: 'none' }], g.ms, g.easing);
    if (!sheet) animate(rootEl, [{ transform: 'scale(1)' }, { transform: `scale(${dir === 'out' ? 0.96 : 1.015})`, offset: 0.35 }, { transform: 'none' }], SPRING.bouncy.ms + 60, 'cubic-bezier(.3,.7,.3,1)');
  }

  /** Account level (only with many accounts) ⇄ Livros: same zoom, smaller. */
  function layerChange(dir: 'out' | 'in'): void {
    if (!motionAllowed() || !booksEl) return;
    const g = SPRING.gentle;
    animate(booksEl, [{ opacity: 0, transform: `scale(${dir === 'out' ? 1.03 : 0.97})` }, { opacity: 1, transform: 'none' }], g.ms, g.easing);
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
    const was = bc.level;
    if (k.kind === 'parent' && was === 'books' && !accountsLayer) flash('Livros é o topo — sem camada de contas');
    bc = step.cursor;
    if (bc.level !== was) void tick().then(() => { layerChange(bc.level === 'accounts' ? 'out' : 'in'); entrance(); });
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
        flash('atualizando livros…');
        return;
    }
  }

  function chooseBook(accountIdx: number, bookIdx: number): void {
    bc = { level: 'books', account: accountIdx, book: bookIdx };
    booksKey({ kind: 'open' });
  }

  function pickAccount(i: number): void {
    bc = { level: 'books', account: i, book: 0 };
    void focusCol().then(() => { layerChange('in'); entrance(); });
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
  const legendItems = $derived(level === 'books' && !accountsLayer ? explorerLegend(legendState).filter((it) => it.keys !== 'h') : explorerLegend(legendState));

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
    aria-label={level === 'books' ? 'Livros' : 'Explorer'}
    tabindex="-1"
    bind:this={rootEl}
    onclick={(e) => e.stopPropagation()}
    onkeydown={onKey}
    data-testid="floating-explorer"
    data-level={level}
  >
    {#if sheet}<div class="fx-grab" aria-hidden="true"></div>{/if}
    {#snippet lvIcon(kind: 'server' | 'account' | 'shelf' | 'book' | 'folder', px?: number)}
      <svg class="lv-ic lv-{kind}" viewBox="0 0 16 16" width={px ?? 13} height={px ?? 13} aria-hidden="true">
        {#if kind === 'server'}
          <rect x="2.5" y="2.5" width="11" height="4.5" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.3"/><rect x="2.5" y="9" width="11" height="4.5" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="5" cy="4.75" r=".8" fill="currentColor"/><circle cx="5" cy="11.25" r=".8" fill="currentColor"/>
        {:else if kind === 'account'}
          <circle cx="8" cy="5.6" r="2.6" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M3 13.5c.6-2.6 2.6-3.9 5-3.9s4.4 1.3 5 3.9" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
        {:else if kind === 'shelf'}
          <path d="M2.5 13.5h11M4 13.5V4h2.2v9.5M6.2 13.5V3h2.2v10.5M9.2 13.4l1.9-9 2.1.45-1.9 9" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round" stroke-linecap="round"/>
        {:else if kind === 'book'}
          <path d="M3 2.75h7.5a1.5 1.5 0 0 1 1.5 1.5v9H4.5A1.5 1.5 0 0 1 3 11.75z M3 11.75a1.5 1.5 0 0 1 1.5-1.5H12" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>
        {:else}
          <path d="M1.75 4.25a1.5 1.5 0 0 1 1.5-1.5h3l1.5 1.75h5a1.5 1.5 0 0 1 1.5 1.5v6.25a1.5 1.5 0 0 1-1.5 1.5h-9.5a1.5 1.5 0 0 1-1.5-1.5z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>
        {/if}
      </svg>
    {/snippet}
    <header class="fx-head">
      {#if sheet && !(level === 'books' && (atAccounts || !accountsLayer))}
        <button type="button" class="fx-up" onclick={up} aria-label={level === 'books' ? 'Contas e servidores' : nav.dir ? 'Up a folder' : 'Livros'}>
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M10 3.5 5.5 8l4.5 4.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      {/if}
      <nav class="fx-crumbs" aria-label={level === 'books' ? 'Onde você está' : 'Folder path'} data-testid="fx-crumbs">
        {#if level === 'books'}
          {#if accountsLayer}
            <button type="button" class="fx-crumb" data-level="accounts" aria-current={atAccounts ? 'location' : undefined} onclick={() => { if (!atAccounts) booksKey({ kind: 'parent' }); }}>{@render lvIcon('server')}{atAccounts ? 'Contas e servidores' : 'Contas'}</button>
            {#if !atAccounts && accountUnder}
              <span class="fx-sep" aria-hidden="true">›</span>
              <span class="fx-crumb static" data-level="account">{@render lvIcon('account')}{accountUnder.account}@{serverLabel(accountUnder.server_url)}</span>
            {/if}
          {/if}
          {#if !atAccounts}
            {#if accountsLayer}<span class="fx-sep" aria-hidden="true">›</span>{/if}
            <span class="fx-crumb static" data-level="shelf" aria-current="location">{@render lvIcon('shelf')}Livros</span>
          {/if}
        {:else}
          <button type="button" class="fx-crumb" data-level="shelf" onclick={() => void setLevel('books')}>{@render lvIcon('shelf')}Livros</button>
          {#each crumbs as c, i (c.path)}
            <span class="fx-sep" aria-hidden="true">›</span>
            <button type="button" class="fx-crumb" data-level={i === 0 ? 'book' : 'folder'} aria-current={i === crumbs.length - 1 ? 'location' : undefined} onclick={() => { nav.goTo(c.path); void focusCol(); }}>{@render lvIcon(i === 0 ? 'book' : 'folder')}{i === 0 ? bookName : c.name}</button>
          {/each}
        {/if}
      </nav>
      {#if pending}<span class="fx-pending mono">{pending}</span>{/if}
      <button class="ui-btn ghost sm icon" type="button" onclick={close} aria-label="Close explorer">
        <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
      </button>
    </header>

    {#if level === 'books'}
      <div class="fx-cols shelf" data-testid="fx-books" data-layer={atAccounts ? 'accounts' : 'books'}>
        <section class="fx-col fx-current" aria-label={atAccounts ? 'Contas e servidores' : 'Livros'}>
          <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
          <div
            class="fx-list active"
            class:accounts-layer={atAccounts}
            role="listbox"
            tabindex="0"
            aria-label={atAccounts ? 'Contas e servidores' : 'Livros'}
            aria-activedescendant={atAccounts ? `fxa-${bc.account}` : `fxb-${curFlat}`}
            bind:this={booksEl}
            data-testid="fx-books-list"
          >
            {#if atAccounts}
              {#each groups as g, i (g.key)}
                {@const acct = accountOf(g.key)}
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <div id="fxa-{i}" class="fx-row fx-acct-row" class:cursor={i === bc.account} role="option" tabindex="-1" aria-selected={i === bc.account} data-hint-target onclick={() => pickAccount(i)}>
                  <span class="fx-avatar" data-slot={avatarSlot(g.key)} aria-hidden="true">{g.account.slice(0, 1).toUpperCase()}</span>
                  <span class="fx-acct-text">
                    <span class="fx-row-name">{g.account}</span>
                    <span class="fx-acct-host">{@render lvIcon('server', 11)}{serverLabel(g.server_url)}</span>
                  </span>
                  <span class="fx-acct-status" data-status={acct?.status ?? 'unknown'}>{acct?.status === 'needs_login' ? 'precisa entrar' : 'conectado'}</span>
                  <span class="fx-row-meta">{plural(g.books.length, 'livro', 'livros')}</span>
                </div>
              {/each}
            {:else}
              {#each groups as g, gi (g.key)}
                {@const acct = accountOf(g.key)}
                {@const base = flatIndex(groups, { account: gi, book: 0 })}
                <div class="fx-group" role="group" aria-label="{g.account}@{serverLabel(g.server_url)}">
                  <div class="fx-acct" aria-hidden="true">
                    <span class="fx-avatar sm" data-slot={avatarSlot(g.key)}>{g.account.slice(0, 1).toUpperCase()}</span>
                    <span class="fx-acct-name">{g.account}</span>
                    <span class="fx-acct-host">{@render lvIcon('server', 11)}{serverLabel(g.server_url)}</span>
                    <span class="fx-acct-dot" data-status={acct?.status ?? 'unknown'} title={acct?.status === 'needs_login' ? 'precisa entrar' : 'conectado'}></span>
                    <span class="fx-acct-count">{plural(g.books.length, 'livro', 'livros')}</span>
                  </div>
                  {#each g.books as b, i (b.id)}
                    {@const st = statusOf(b)}
                    {@const n = order.findIndex((x) => x.id === b.id) + 1}
                    {@const cnt = noteCount(b)}
                    {@const sel = gi === bc.account && i === bc.book}
                    <!-- svelte-ignore a11y_click_events_have_key_events -->
                    <div
                      id="fxb-{base + i}"
                      class="fx-row fx-book-row"
                      class:cursor={sel}
                      class:current={b.id === books.activeID}
                      role="option"
                      tabindex="-1"
                      aria-selected={sel}
                      aria-current={b.id === books.activeID ? 'true' : undefined}
                      data-hint-target
                      style="min-height: {sheet ? 52 : 40}px"
                      onclick={() => (sheet ? chooseBook(gi, i) : (bc = { level: 'books', account: gi, book: i }))}
                      ondblclick={() => chooseBook(gi, i)}
                    >
                      <span class="fx-book-ic">{@render lvIcon('book', 15)}</span>
                      <span class="fx-book-text">
                        <span class="fx-row-name">{b.name}</span>
                        <span class="fx-book-sub">
                          <SyncDot state={st.state} pending={st.pending} vaultID={b.vault_id} />
                          <span>{STATE_LABEL[st.state].pt}</span>
                          {#if cnt != null}<span class="dot-sep" aria-hidden="true">·</span><span>{plural(cnt, 'nota', 'notas')}</span>{/if}
                          {#if b.last_opened_at}<span class="dot-sep" aria-hidden="true">·</span><span>{updatedLabel(b.last_opened_at)}</span>{/if}
                        </span>
                      </span>
                      {#if b.id === books.activeID}<span class="fx-open-tag">aberto</span>{/if}
                      {#if n > 0 && n <= 9}<kbd class="fx-kbd">g{n}</kbd>{/if}
                    </div>
                  {/each}
                </div>
              {/each}
            {/if}
            {#if groups.length === 0}<div class="fx-empty">Nenhum livro ainda — a cria um</div>{/if}
          </div>
        </section>
        <section class="fx-col fx-preview" aria-label={atAccounts ? 'Conta' : 'Livro'}>
          {#if bookUnder}
            {@const st = statusOf(bookUnder)}
            {@const cnt = noteCount(bookUnder)}
            {#key bookUnder.id}
              <div class="fx-note fx-bookcard">
                <div class="fx-cover" aria-hidden="true">{@render lvIcon('book', 26)}</div>
                <div class="fx-note-head">
                  <span class="fx-note-title">{bookUnder.name}</span>
                  <span class="fx-note-meta">{bookUnder.account}@{serverLabel(bookUnder.server_url)}</span>
                </div>
                <dl class="fx-facts">
                  <dt>Estado</dt><dd><SyncDot state={st.state} pending={st.pending} label vaultID={bookUnder.vault_id} /></dd>
                  <dt>Notas</dt><dd>{cnt != null ? plural(cnt, 'nota', 'notas') : '—'}</dd>
                  <dt>Aberto</dt><dd>{bookUnder.last_opened_at ? updatedLabel(bookUnder.last_opened_at) : 'nunca neste aparelho'}</dd>
                </dl>
                <p class="fx-bookline dim">{bookUnder.id === books.activeID ? 'Aberto agora — ⏎ ou l volta às notas' : '⏎ ou l abre este livro'}</p>
              </div>
            {/key}
          {:else if accountUnder}
            {@const acct = accountOf(accountUnder.key)}
            <div class="fx-note">
              <div class="fx-note-head">
                <span class="fx-note-title">{accountUnder.account}</span>
                <span class="fx-note-meta">{serverLabel(accountUnder.server_url)} · {acct?.status === 'needs_login' ? 'precisa entrar' : 'conectado'}</span>
              </div>
              <ul class="fx-mini">{#each accountUnder.books as b (b.id)}<li>{@render lvIcon('book', 11)} {b.name}</li>{/each}</ul>
              <p class="fx-bookline dim">⏎ ou l mostra os livros desta conta</p>
            </div>
          {/if}
        </section>
      </div>
      <footer class="fx-status" data-testid="fx-footer">
        <CommandLegend embedded items={legendItems} onaction={legendAction} onmore={() => appKey({ kind: 'help' })} />
        {#if flashMsg}<span class="fx-flash" role="status">{flashMsg}</span>{/if}
        <button type="button" class="fx-link" onclick={newBook}>Novo livro…</button>
        <button type="button" class="fx-link" onclick={() => { close(); onmanage?.(); }}>Gerenciar…</button>
        <span class="fx-stat mono" data-testid="fx-stat">{plural(books.list.length, 'livro', 'livros')} · {plural(groups.length, 'conta', 'contas')}</span>
      </footer>
    {:else}
      <div class="fx-cols">
        <section class="fx-col fx-parent" aria-label="Parent folder">
          {#if nav.parent != null}
            <MillerColumn entries={nav.parentEntries} cursor={nav.parentCursor} label="Parent folder" idPrefix="fx-parent" rowHeight={rowH} onpick={pickParent} ondropnote={(k, t) => void dropNote(k, t)} />
          {:else}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <div class="fx-book" role="button" tabindex="-1" onclick={() => void setLevel('books')} data-hint-target>
              <span class="ui-eyebrow">livro</span><span class="fx-book-name">{bookName}</span><span class="fx-book-meta">{plural(notes.list.length, 'nota', 'notas')} · h: livros</span>
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

  /* ── Books level: a shelf (scope), never a folder ─────────────────── */
  .lv-ic { flex: none; vertical-align: -2px; }
  .fx-glyph { display: inline-flex; }
  .fx-crumb { display: inline-flex; align-items: center; gap: 5px; }
  .fx-crumb .lv-ic { color: var(--ink-4); }
  .fx-crumb[data-level='shelf'] .lv-ic, .fx-crumb[data-level='book'] .lv-ic { color: var(--accent); }
  .fx-crumb[data-level='folder'] .lv-ic { color: var(--color-secondary); }
  .fx-crumb[data-level='accounts'] .lv-ic, .fx-crumb[data-level='account'] .lv-ic { color: var(--color-info); }
  .fx-cols.shelf { grid-template-columns: minmax(0, 1.45fr) minmax(0, 1fr); transform-origin: 50% 40%; }
  .fx-cols.shelf .fx-current { background: color-mix(in oklch, var(--surface-sunk) 30%, transparent); }
  .fx-group { margin: 0 0 var(--sp-3); }
  .fx-acct {
    display: flex; align-items: center; gap: var(--sp-2);
    padding: var(--sp-3) var(--sp-2) 6px; margin-bottom: 2px;
    font-size: var(--text-xs); color: var(--ink-3);
    border-bottom: 1px solid var(--hairline-soft);
    cursor: default; user-select: none;
  }
  .fx-group:first-child .fx-acct { padding-top: var(--sp-1); }
  .fx-acct-name { font-weight: 650; color: var(--ink-2); letter-spacing: var(--tracking-ui); }
  .fx-acct-host { display: inline-flex; align-items: center; gap: 4px; font-family: var(--font-mono); font-size: var(--text-2xs); color: var(--ink-3); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .fx-acct-dot { flex: none; width: 7px; height: 7px; border-radius: 50%; background: var(--ok); box-shadow: 0 0 0 3px color-mix(in oklch, var(--ok) 18%, transparent); }
  .fx-acct-dot[data-status='needs_login'] { background: var(--color-warning); box-shadow: 0 0 0 3px color-mix(in oklch, var(--color-warning) 18%, transparent); }
  .fx-acct-dot[data-status='unknown'] { background: var(--ink-4); box-shadow: none; }
  .fx-acct-count { margin-left: auto; font-size: var(--text-2xs); color: var(--ink-4); font-variant-numeric: tabular-nums; }
  .fx-avatar {
    flex: none; display: grid; place-items: center; width: 26px; height: 26px; border-radius: 50%;
    font-size: var(--text-xs); font-weight: 700; color: var(--color-background);
    background: var(--av, var(--color-primary));
    box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.25), 0 0 0 2px color-mix(in oklch, var(--av, var(--color-primary)) 30%, transparent);
  }
  .fx-avatar.sm { width: 18px; height: 18px; font-size: 10px; }
  .fx-avatar[data-slot='1'] { --av: var(--color-secondary); }
  .fx-avatar[data-slot='2'] { --av: var(--color-accent); }
  .fx-avatar[data-slot='3'] { --av: var(--color-info); }
  .fx-book-row { gap: var(--sp-3); padding-top: 5px; padding-bottom: 5px; height: auto; }
  .fx-book-ic { flex: none; display: grid; place-items: center; width: 28px; height: 28px; border-radius: var(--radius-sm); color: var(--ink-3); background: var(--surface-2); box-shadow: var(--edge-light); }
  .fx-row.current .fx-book-ic, .fx-row.cursor .fx-book-ic { color: var(--accent); background: var(--accent-wash); }
  .fx-book-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
  .fx-book-sub { display: flex; align-items: center; gap: 5px; font-size: var(--text-2xs); color: var(--ink-3); white-space: nowrap; overflow: hidden; }
  .dot-sep { color: var(--ink-4); }
  .fx-open-tag { flex: none; padding: 1px 7px; border-radius: var(--radius-pill); font-size: var(--text-2xs); color: var(--accent-ink); background: var(--accent-wash); box-shadow: inset 0 0 0 1px var(--accent-soft); }
  .fx-kbd { flex: none; min-width: 22px; padding: 1px 5px; border: 1px solid var(--hairline); border-bottom-width: 2px; border-radius: var(--radius-xs); background: var(--surface-1); font-family: var(--font-mono); font-size: var(--text-2xs); color: var(--ink-3); text-align: center; }
  /* Contas e servidores: cards, not folders (no chevron, no Miller parent). */
  .fx-list.accounts-layer { padding: var(--sp-2); display: flex; flex-direction: column; gap: 6px; }
  .fx-acct-row { height: auto; min-height: 52px; gap: var(--sp-3); padding: var(--sp-2) var(--sp-3); border: 1px solid var(--hairline-soft); border-radius: var(--radius-lg); background: var(--surface-1); box-shadow: var(--edge-light); }
  .fx-acct-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .fx-acct-status { flex: none; font-size: var(--text-2xs); color: var(--ok); }
  .fx-acct-status[data-status='needs_login'] { color: var(--color-warning); }
  .fx-cover { display: grid; place-items: center; width: 52px; height: 64px; margin-bottom: var(--sp-4); border-radius: 4px 8px 8px 4px; color: var(--accent); background: linear-gradient(135deg, var(--accent-soft), var(--accent-wash)); box-shadow: inset 3px 0 0 var(--accent-line), var(--elev-2); }
  .fx-facts { display: grid; grid-template-columns: auto 1fr; gap: 6px var(--sp-4); margin: 0 0 var(--sp-4); font-size: var(--text-sm); }
  .fx-facts dt { color: var(--ink-3); font-size: var(--text-xs); }
  .fx-facts dd { margin: 0; }
  .fx-mini li { list-style: none; display: flex; align-items: center; gap: 6px; margin-left: -1.1em; }
  .fx.sheet .fx-cols.shelf { grid-template-columns: minmax(0, 1fr); }
</style>
