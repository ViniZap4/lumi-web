// The floating explorer's state and behaviour (FloatingExplorer.svelte
// renders it). Files level: Miller navigation over the book's notes,
// prompts, delete confirm, filter, context menu, drag-to-folder. Books
// level: accounts → books. One keymap (lib/shell-keymap) drives both.

import { tick, untrack } from 'svelte';
import { MillerNav } from '../../lib/miller.svelte.ts';
import { ShellKeymap, type ShellAction } from '../../lib/shell-keymap.ts';
import { notes } from '../../lib/notes.svelte.ts';
import { books } from '../../lib/books.svelte.ts';
import { accountGroups, cursorAt, booksStep, bookAt, hasAccountsLayer, type BooksCursor, type BooksKey } from '../../lib/books-nav.ts';
import { selectorOrder } from '../../lib/books-model.ts';
import { menuFor, type MenuItem } from '../../lib/context-actions.ts';
import { explorerLegend, type LegendItem } from '../../lib/legend.ts';
import { parentDir, type Entry } from '../../lib/notetree.ts';
import type { OpenWhere } from '../../lib/link-open.ts';
import { entrance, flyIn, flyOut, scopeChange, layerChange, folderTravel } from './fx-motion.ts';
import type { FxOps, FxPrompt, FxLevel, FxInitial } from './fx-types.ts';

/** What the overlay reads from its props (always the current values). */
export interface FxInputs {
  bookName: string;
  initial: FxInitial;
  ops: FxOps;
  yanked: Entry | null;
  sheet: boolean;
  onopen: (noteID: string, where: OpenWhere, from?: HTMLElement | null) => void;
  ondragnote?: (on: boolean) => void;
  onedit?: (noteID: string) => void;
  onbook?: (bookID: string) => void;
  onapp?: (a: ShellAction) => void;
  onnewbook?: () => void;
  onmanage?: () => void;
  onlevel?: (l: FxLevel) => void;
  onclose: (dir?: string) => void;
}

type PromptBar = { focus(caretAtStart?: boolean): void; submit(): Promise<void> };
type Menu = { x: number; y: number; items: MenuItem[]; entry: Entry | null; title: string };

export class FxController {
  readonly nav = new MillerNav(() => notes.list);
  private readonly keymap = new ShellKeymap();

  level = $state<FxLevel>('files');
  rootEl = $state<HTMLElement | null>(null);
  colEl = $state<HTMLElement | null>(null);
  col = $state<{ pageRows(): number } | null>(null);
  booksEl = $state<HTMLElement | null>(null);
  filterOpen = $state(false);
  filterInput = $state<HTMLInputElement | null>(null);
  filterFocused = $state(false);
  prompt = $state<FxPrompt | null>(null);
  promptBar = $state<PromptBar | null>(null);
  pendingDelete = $state<Entry | null>(null);
  busy = $state(false);
  pending = $state<string | null>(null);
  flashMsg = $state<string | null>(null);
  showPreview = $state(true);
  menu = $state<Menu | null>(null);
  hintsOpen = $state(false);
  draggingOut = $state(false);
  bc = $state<BooksCursor>(untrack(() => cursorAt(accountGroups(books.list), books.activeID)));
  private flashTimer: ReturnType<typeof setTimeout> | null = null;
  private lastDir: string | null = null;

  readonly groups = $derived(accountGroups(books.list));
  readonly order = $derived(selectorOrder(books.list));
  readonly bookUnder = $derived.by(() => bookAt(this.groups, this.bc));
  readonly accountUnder = $derived.by(() => this.groups[this.bc.account] ?? null);
  /** "Contas e servidores" exists only with many accounts. */
  readonly accountsLayer = $derived.by(() => hasAccountsLayer(this.groups));
  readonly atAccounts = $derived.by(() => this.level === 'books' && this.bc.level === 'accounts');
  readonly legendState = $derived.by(() =>
    this.level === 'books' ? 'books' : this.pendingDelete ? 'confirm' : this.prompt ? 'prompt' : this.filterFocused ? 'filter' : 'files',
  );
  readonly legendItems = $derived.by(() =>
    this.level === 'books' && !this.accountsLayer ? explorerLegend(this.legendState).filter((it) => it.keys !== 'h') : explorerLegend(this.legendState),
  );

  constructor(
    private readonly p: () => FxInputs,
    private readonly setYanked: (e: Entry | null) => void,
    start: { level: FxLevel; note: string | null; dir: string; showHidden: boolean },
  ) {
    this.level = start.level;
    this.nav.showHidden = start.showHidden;
    // Start at the current note's folder, cursor on the note.
    untrack(() => {
      const n = start.note ? notes.list.find((x) => x.id === start.note) : null;
      if (n) this.nav.reveal(n.id);
      else this.nav.goTo(start.dir);
    });
  }

  install(): void {
    // Folder travel (l / h): the columns shift like a camera moving one
    // step deeper or back (fx-motion.folderTravel).
    $effect(() => {
      const d = this.nav.dir;
      const prev = untrack(() => this.lastDir);
      this.lastDir = d;
      if (prev == null || prev === d || this.level !== 'files') return;
      const deeper = d.length > prev.length && d.startsWith(prev);
      void tick().then(() => folderTravel(this.rootEl, this.colEl, deeper));
    });
  }

  /** The overlay mounted: focus, fly in, ripple the rows, run `initial`. */
  mounted(): void {
    void tick().then(() => {
      this.focusCurrent();
      this.flyIn();
      this.entrance();
      this.runInitial();
    });
  }

  destroy(): void {
    if (this.flashTimer) clearTimeout(this.flashTimer);
  }

  // ---- motion ---------------------------------------------------------------

  private flyIn(): void {
    flyIn(this.rootEl, this.p().sheet);
  }

  private entrance(): void {
    entrance(this.level === 'books' ? this.booksEl : this.colEl);
  }

  // ---- basics ---------------------------------------------------------------

  flash(t: string): void {
    this.flashMsg = t;
    if (this.flashTimer) clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => (this.flashMsg = null), 3000);
  }

  close = (): void => {
    flyOut(this.rootEl, null);
    this.p().onclose(this.nav.dir);
  };

  private rowNameEl(): HTMLElement | null {
    return this.colEl?.querySelector<HTMLElement>('.row.cursor .name') ?? null;
  }

  private open(where: OpenWhere): void {
    const c = this.nav.current;
    if (c?.kind === 'note') {
      flyOut(this.rootEl, this.rowNameEl());
      this.p().onopen(c.note.id, where, this.rowNameEl());
    } else if (c?.kind === 'folder' && where === 'current') this.nav.right();
  }

  /** The preview's mini canvas / board was clicked: open that note. */
  openPreviewed = (): void => {
    const c = this.nav.current;
    if (c?.kind === 'note') this.p().onopen(c.note.id, 'current', this.rowNameEl());
  };

  private focusCurrent(): void {
    (this.level === 'books' ? this.booksEl : this.colEl)?.focus({ preventScroll: true });
  }

  focusCol = async (): Promise<void> => {
    await tick();
    this.focusCurrent();
  };

  setLevel = async (l: FxLevel): Promise<void> => {
    if (this.level === l) return;
    this.level = l;
    this.p().onlevel?.(l);
    this.filterOpen = false;
    if (l === 'books') this.bc = cursorAt(this.groups, books.activeID);
    await this.focusCol();
    scopeChange(this.rootEl, l === 'books' ? 'out' : 'in', this.p().sheet);
    this.entrance();
  };

  private runInitial(): void {
    switch (this.p().initial) {
      case 'create': return this.run({ kind: 'create' });
      case 'createCanvas':
        if (this.p().ops.offline()) return this.flash('creating needs the server');
        void this.openPrompt({ kind: 'create', text: '.canvas' }, true);
        return;
      case 'newFolder':
        if (this.p().ops.offline()) return this.flash('creating needs the server');
        void this.openPrompt({ kind: 'create', text: '/' }, true);
        return;
      case 'rename': return this.run({ kind: 'rename' });
      case 'delete': return this.run({ kind: 'delete' });
      case 'filter': return void this.openFilter();
      case 'paste': return this.run({ kind: 'paste' });
    }
  }

  // ---- keys -----------------------------------------------------------------

  onKey = (e: KeyboardEvent): void => {
    // Text fields (filter, prompt) handle their own keys.
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    // Buttons inside keep Enter / Space (Tab to them, then activate).
    if (t && t.tagName === 'BUTTON' && (e.key === 'Enter' || e.key === ' ')) return;
    e.stopPropagation();
    if (this.pendingDelete) {
      e.preventDefault();
      if (e.key === 'y' || e.key === 'Y' || e.key === 'Enter') void this.confirmDelete();
      else if (e.key === 'n' || e.key === 'N' || e.key === 'Escape' || e.key === 'q') this.pendingDelete = null;
      return;
    }
    if (this.level === 'files' && e.ctrlKey && !e.metaKey && !e.altKey && (e.key === 'v' || e.key === 's')) {
      e.preventDefault();
      this.open(e.key === 'v' ? 'vsplit' : 'hsplit');
      return;
    }
    if (e.key === 'Tab') return;
    if (e.key === 'Enter') {
      e.preventDefault();
      this.keymap.reset();
      this.pending = null;
      if (this.level === 'books') this.booksKey({ kind: 'open' });
      else this.open('current');
      return;
    }
    const a = this.keymap.feed(e, 'explorer');
    this.pending = this.keymap.pending;
    if (!a) {
      // Keep the page from reacting (Cmd-keys stay the browser's).
      if (!e.metaKey && e.key.length === 1) e.preventDefault();
      return;
    }
    e.preventDefault();
    if (a.kind === 'pending') return;
    if (this.level === 'books') this.runBooks(a);
    else this.run(a);
  };

  /** Keys that belong to the app, not the overlay. */
  appKey = (a: ShellAction): boolean => {
    switch (a.kind) {
      case 'palette':
      case 'command':
      case 'help':
      case 'settings':
      case 'book':
      case 'prevBook':
      case 'nextBook':
        this.p().onapp?.(a);
        return true;
    }
    return false;
  };

  private run(a: ShellAction): void {
    if (this.appKey(a)) return;
    const nav = this.nav;
    const { ops } = this.p();
    const page = this.col?.pageRows() ?? 10;
    switch (a.kind) {
      case 'move': nav.move(a.n); return;
      case 'halfPage': nav.move(a.dir * Math.ceil(page / 2)); return;
      case 'page': nav.move(a.dir * page); return;
      case 'top': nav.top(); return;
      case 'bottom': nav.bottom(); return;
      case 'parent':
        // Above the book root: the books (accounts → books).
        if (!nav.left()) void this.setLevel('books');
        return;
      case 'open': {
        const n = nav.current;
        if (n?.kind === 'note') this.p().onopen(n.note.id, 'current', this.rowNameEl());
        else nav.right();
        return;
      }
      case 'edit': {
        const n = nav.current;
        if (n?.kind === 'note') this.p().onedit?.(n.note.id);
        return;
      }
      case 'picker': void this.setLevel('books'); return;
      case 'historyBack': nav.historyBack(); return;
      case 'historyForward': nav.historyForward(); return;
      case 'home': nav.home(); return;
      case 'filter': void this.openFilter(); return;
      case 'nextMatch':
      case 'prevMatch':
        if (!nav.findNext(a.kind === 'nextMatch' ? 1 : -1)) this.flash('no filter yet — / to filter');
        return;
      case 'clearOrBack':
        if (nav.filter) { nav.setFilter(''); this.filterOpen = false; }
        else this.close();
        return;
      case 'close': this.close(); return;
      case 'toggleHidden':
        nav.toggleHidden();
        this.flash(nav.showHidden ? 'showing hidden files' : 'hiding dot-files');
        return;
      case 'togglePreview': this.showPreview = !this.showPreview; return;
      case 'refresh':
        ops.refresh?.();
        this.flash('refreshing…');
        return;
      case 'hints': this.hintsOpen = true; return;
      case 'menu': this.openMenuAtCursor(); return;
      case 'create':
        if (ops.offline()) return this.flash('creating notes needs the server');
        void this.openPrompt({ kind: 'create', text: '' });
        return;
      case 'rename': {
        const c = nav.current;
        if (!c) return;
        if (ops.offline() && !(c.kind === 'folder' && c.virtual)) return this.flash('renaming needs the server');
        void this.openPrompt({ kind: 'rename', entry: c, text: c.kind === 'folder' ? c.name : (c.note.title ?? c.name) });
        return;
      }
      case 'delete': {
        const c = nav.current;
        if (!c) return;
        if (c.kind === 'folder') {
          if (c.virtual) {
            nav.removeFolder(c.path);
            this.flash(`removed empty folder ${c.name}/`);
          } else this.flash('delete the notes inside to remove a folder');
          return;
        }
        if (ops.offline()) return this.flash('deleting needs the server');
        this.pendingDelete = c;
        return;
      }
      case 'yank': {
        const c = nav.current;
        if (c?.kind !== 'note') return this.flash('y works on notes');
        this.setYanked(c);
        this.flash(`yanked ${c.name} — p to paste a copy`);
        return;
      }
      case 'paste': {
        const y = this.p().yanked;
        if (!y) return this.flash('nothing yanked — y on a note first');
        if (ops.offline()) return this.flash('pasting needs the server');
        void this.guarded(() => ops.paste(y, nav), `pasted a copy of ${y.name}`);
        return;
      }
      default:
        return;
    }
  }

  // ---- books level ----------------------------------------------------------

  booksKey = (k: BooksKey): void => {
    const step = booksStep(this.groups, this.bc, k);
    const was = this.bc.level;
    if (k.kind === 'parent' && was === 'books' && !this.accountsLayer) this.flash('Livros é o topo — sem camada de contas');
    this.bc = step.cursor;
    if (this.bc.level !== was) {
      void tick().then(() => {
        layerChange(this.booksEl, this.bc.level === 'accounts' ? 'out' : 'in');
        this.entrance();
      });
    }
    if (!step.open) return;
    if (step.open.id === books.activeID) void this.setLevel('files');
    else this.p().onbook?.(step.open.id);
  };

  private runBooks(a: ShellAction): void {
    if (a.kind === 'book') {
      const b = this.order[a.n - 1];
      if (b) {
        if (b.id === books.activeID) void this.setLevel('files');
        else this.p().onbook?.(b.id);
      }
      return;
    }
    if (this.appKey(a)) return;
    switch (a.kind) {
      case 'move': return this.booksKey({ kind: 'move', n: a.n });
      case 'halfPage':
      case 'page': return this.booksKey({ kind: 'move', n: a.dir * 5 });
      case 'top': return this.booksKey({ kind: 'top' });
      case 'bottom': return this.booksKey({ kind: 'bottom' });
      case 'parent': return this.booksKey({ kind: 'parent' });
      case 'open': return this.booksKey({ kind: 'open' });
      case 'home': return void this.setLevel('files');
      case 'clearOrBack':
      case 'close': return this.close();
      case 'create': return this.newBook();
      case 'hints': this.hintsOpen = true; return;
      case 'refresh':
        void books.refreshAll();
        this.flash('atualizando livros…');
        return;
    }
  }

  chooseBook = (accountIdx: number, bookIdx: number): void => {
    this.bc = { level: 'books', account: accountIdx, book: bookIdx };
    this.booksKey({ kind: 'open' });
  };

  pickAccount = (i: number): void => {
    this.bc = { level: 'books', account: i, book: 0 };
    void this.focusCol().then(() => {
      layerChange(this.booksEl, 'in');
      this.entrance();
    });
  };

  newBook = (): void => {
    this.close();
    this.p().onnewbook?.();
  };

  manageBooks = (): void => {
    this.close();
    this.p().onmanage?.();
  };

  // ---- file ops -------------------------------------------------------------

  private async guarded(f: () => Promise<void>, ok?: string): Promise<void> {
    this.busy = true;
    try {
      await f();
      if (ok) this.flash(ok);
    } catch (e) {
      this.flash((e as Error).message);
    } finally {
      this.busy = false;
    }
  }

  private async openFilter(): Promise<void> {
    this.filterOpen = true;
    await tick();
    this.filterInput?.focus();
    this.filterInput?.select();
  }

  onFilterKey = (e: KeyboardEvent): void => {
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      this.nav.setFilter('');
      this.filterOpen = false;
      void this.focusCol();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      this.filterOpen = this.nav.filter !== '';
      void this.focusCol();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      this.nav.move(e.key === 'ArrowDown' ? 1 : -1);
    }
  };

  private async openPrompt(p: FxPrompt, caretAtStart = false): Promise<void> {
    this.prompt = p;
    await tick();
    this.promptBar?.focus(caretAtStart);
  }

  confirmDelete = async (): Promise<void> => {
    const e = this.pendingDelete;
    this.pendingDelete = null;
    if (!e) return;
    await this.guarded(() => this.p().ops.remove(e), `deleted ${e.name}`);
    void this.focusCol();
  };

  dropNote = async (key: string, target: Entry): Promise<void> => {
    const { ops } = this.p();
    if (target.kind !== 'folder' || !ops.move) return;
    if (ops.offline()) return this.flash('moving needs the server');
    try {
      const msg = await ops.move(key, target);
      if (msg) this.flash(msg);
      this.nav.removeFolder(target.path);
    } catch (e) {
      this.flash((e as Error).message);
    }
  };

  // ---- context menu ---------------------------------------------------------

  private openMenu(x: number, y: number, entry: Entry | null): void {
    const { ops, yanked, bookName } = this.p();
    const items = menuFor(entry, { offline: ops.offline(), canPaste: !!yanked });
    const title = entry ? (entry.kind === 'note' ? (entry.note.title ?? entry.name) : entry.name + '/') : (this.nav.dir || bookName);
    this.menu = { x, y, items, entry, title };
  }

  private openMenuAtCursor(): void {
    const row = this.colEl?.querySelector<HTMLElement>('.row.cursor');
    const r = row?.getBoundingClientRect() ?? this.colEl?.getBoundingClientRect();
    this.openMenu((r?.left ?? 0) + 24, (r?.bottom ?? 0) + 2, this.nav.current ?? null);
  }

  onRowContext = (i: number, e: Entry, ev: MouseEvent): void => {
    this.nav.setCursor(i);
    this.openMenu(ev.clientX, ev.clientY, e);
  };

  onColumnContext = (ev: MouseEvent): void => {
    if ((ev.target as HTMLElement | null)?.closest('[role="option"]')) return;
    ev.preventDefault();
    this.openMenu(ev.clientX, ev.clientY, null);
  };

  runMenu = (it: MenuItem): void => {
    const e = this.menu?.entry ?? null;
    this.menu = null;
    if (it.action === 'openRight' || it.action === 'openBelow') {
      if (e?.kind === 'note') this.p().onopen(e.note.id, it.action === 'openRight' ? 'vsplit' : 'hsplit', this.rowNameEl());
      return;
    }
    if (it.action === 'copyLink') {
      if (e?.kind === 'note') this.p().ops.copyLink?.(e);
      return;
    }
    if (it.action === 'newFolder') {
      if (this.p().ops.offline()) return this.flash('creating needs the server');
      void this.openPrompt({ kind: 'create', text: '/' }, true);
      return;
    }
    this.run({ kind: it.action } as ShellAction);
  };

  closeMenu = (): void => {
    this.menu = null;
    void this.focusCol();
  };

  // ---- the footer legend ----------------------------------------------------

  /** A legend item was clicked: the same action its keys run. */
  legendAction = (it: LegendItem): void => {
    const d = it.do;
    if (!d) return;
    const [ns, arg] = [d.slice(0, d.indexOf(':')), d.slice(d.indexOf(':') + 1)];
    const onBooks = this.level === 'books';
    if (ns === 'shell') {
      const a = { kind: arg } as ShellAction;
      if (onBooks) this.runBooks(a);
      else this.run(a);
    } else if (ns === 'fx') {
      switch (arg) {
        case 'down': if (onBooks) this.runBooks({ kind: 'move', n: 1 }); else this.run({ kind: 'move', n: 1 }); break;
        case 'vsplit': this.open('vsplit'); return;
        case 'hsplit': this.open('hsplit'); return;
        case 'filterKeep': this.filterOpen = this.nav.filter !== ''; break;
        case 'filterClear': this.nav.setFilter(''); this.filterOpen = false; break;
        case 'promptSubmit': void this.promptBar?.submit(); return;
        case 'promptCancel': this.prompt = null; break;
        case 'confirmYes': void this.confirmDelete(); return;
        case 'confirmNo': this.pendingDelete = null; break;
      }
    }
    if (!this.prompt) void this.focusCol();
  };

  // ---- mouse ----------------------------------------------------------------

  /** Click selects (a folder enters); on a sheet a note opens. */
  pickCurrent = (i: number, e: Entry): void => {
    this.nav.setCursor(i);
    if (e.kind === 'folder') this.nav.right();
    else if (this.p().sheet) this.p().onopen(e.note.id, 'current', this.rowNameEl());
    void this.focusCol();
  };

  rowAction = (i: number, e: Entry, where: OpenWhere): void => {
    this.nav.setCursor(i);
    if (e.kind === 'note') this.p().onopen(e.note.id, where, this.rowNameEl());
  };

  dragNote = (on: boolean): void => {
    this.draggingOut = on;
    this.p().ondragnote?.(on);
  };

  openCurrent = (i: number, e: Entry): void => {
    this.nav.setCursor(i);
    if (e.kind === 'note') this.p().onopen(e.note.id, 'current', this.rowNameEl());
  };

  pickParent = (_i: number, e: Entry): void => {
    if (e.kind === 'folder') this.nav.goTo(e.path);
    else this.nav.goTo(parentDir(this.nav.dir) ?? '', e.key);
    void this.focusCol();
  };

  pickPreview = (_i: number, e: Entry): void => {
    const c = this.nav.current;
    if (c?.kind !== 'folder') return;
    this.nav.goTo(c.path, e.key);
    void this.focusCol();
  };

  up = (): void => {
    if (this.level === 'books') this.booksKey({ kind: 'parent' });
    else if (!this.nav.left()) void this.setLevel('books');
    void this.focusCol();
  };

  crumb = (path: string): void => {
    this.nav.goTo(path);
    void this.focusCol();
  };
}
