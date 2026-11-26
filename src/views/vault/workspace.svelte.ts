// The book workspace: the state and behaviour behind VaultHomeView,
// split into controllers (Svelte 5 runes in plain classes):
//
//   Workspace          the open book: home vs note, opening notes and
//                      links, the book-open plan, deep links, the URL
//   EditingController  the live editor session (edit.svelte.ts)
//   PanesController    splits, zoom, pane focus, drag-to-split
//   HoverController    the hover link card
//   ExplorerController the floating explorer and its file operations
//   CommandController  keys, palette, legend, context menu
//
// One Workspace exists per mounted VaultHomeView; components below the
// shell reach it through `useWorkspace()` (context.ts). Effects are
// installed by `install()`, which the shell calls during its own init.

import { tick, untrack } from 'svelte';
import { vaults } from '../../lib/vaults.svelte.ts';
import { notes } from '../../lib/notes.svelte.ts';
import { books } from '../../lib/books.svelte.ts';
import { sync } from '../../lib/sync.svelte.ts';
import { offline } from '../../lib/offline.svelte.ts';
import { flushPending, editorPool } from '../../lib/editor-boot.ts';
import { uiState } from '../../lib/uistate.svelte.ts';
import { toasts } from '../../lib/toasts.svelte.ts';
import { editorSettings } from '../../lib/editor-settings.svelte.ts';
import { selectorOrder } from '../../lib/books-model.ts';
import { rememberLastNote, lastNote, planBookOpen, recentNotes, NoteHistory } from '../../lib/book-home.ts';
import { peekNote } from '../../lib/note-content.ts';
import { classifyLink, whereFromClick, type OpenWhere, type LinkAt } from '../../lib/link-open.ts';
import { formatDeepLink } from '../../lib/deeplink.ts';
import { resolveView, viewsFor } from '../../lib/note-views.ts';
import { dirOf, normalizePath, type NoteEntry } from '../../lib/notetree.ts';
import { markdownLink } from '../../lib/links.ts';
import { MAC } from '../../lib/platform.ts';
import { focusPane } from '../../lib/view-focus.ts';
import { withViewTransition, sharedTransition, scrollBehavior, motionAllowed, animate } from '../../lib/motion.ts';
import { armRise } from '../../lib/motion-actions.ts';
import { findLeaf } from '../../lib/pane-tree.ts';
import { EditingController } from './edit.svelte.ts';
import { PanesController } from './panes.svelte.ts';
import { HoverController } from './hover.svelte.ts';
import { ExplorerController } from './explorer.svelte.ts';
import { CommandController } from './commands.svelte.ts';

export type ScrollBy = number | 'top' | 'bottom' | 'half' | '-half' | 'page' | '-page';

export type OpenOpts = {
  /** The explorer row's name: it morphs into the note title. */
  from?: HTMLElement | null;
  /** false for H / L (walking the history itself). */
  history?: boolean;
  /** Close the floating explorer as part of the transition. */
  closeFx?: boolean;
};

export class Workspace {
  /** 'home' = the book's calm empty home; 'note' = a note (reader,
   *  editor or a split layout) fills the stage. */
  pane = $state<'home' | 'note'>('home');
  rootEl = $state<HTMLElement | null>(null);
  /** The stage (the primary pane's scroller while there is one pane). */
  previewEl = $state<HTMLElement | null>(null);
  homeEl = $state<HTMLElement | null>(null);
  /** The book whose opening (last note / home) was decided. */
  plannedFor = $state<string | null>(null);
  /** Book settings (members, roles) modal. */
  showSettings = $state(false);
  homeIndex = $state(-1);
  readonly noteHistory = new NoteHistory();

  readonly edit: EditingController;
  readonly panes: PanesController;
  readonly hover: HoverController;
  readonly explorer: ExplorerController;
  readonly cmd: CommandController;

  readonly structuralOffline = $derived(sync.isOffline(books.active));
  /** The book was revoked (vault.revoked / gone from the list). */
  readonly activeRevoked = $derived(books.active ? (books.revoked[books.active.id] ?? null) : null);
  readonly activeStatus = $derived(books.active ? sync.statusOf(books.active) : null);
  /** Viewer / mirror book: "Edit" opens a read-only live view. */
  readonly readOnlyBook = $derived(!!vaults.selectedID && books.isReadOnly(vaults.selectedID));
  readonly recents = $derived(recentNotes(notes.list, 12));
  readonly noteConflicts = $derived(offline.conflicts.filter((c) => c.noteID === notes.selectedID));
  /** Copies of notes that no longer exist cannot be reached through a
   *  note: listed at the book level. */
  readonly orphanConflicts = $derived(
    notes.stale || notes.loadingList ? [] : offline.conflicts.filter((c) => !notes.list.some((n) => n.id === c.noteID)),
  );
  readonly noteFolder = $derived(notes.selected ? dirOf(notes.selected.path) : '');
  readonly noteCrumbs = $derived(this.noteFolder ? this.noteFolder.split('/') : []);
  readonly primaryMatch = $derived({
    path: notes.selected?.path ?? notes.content?.path ?? '',
    kind: notes.content?.kind ?? notes.selected?.kind ?? null,
    frontmatter: notes.content?.frontmatter ?? null,
    body: notes.content?.body ?? '',
  });
  readonly primaryViews = $derived(viewsFor(this.primaryMatch));
  readonly primaryView = $derived.by(() =>
    resolveView(this.primaryMatch, this.panes.state ? (findLeaf(this.panes.state.root, this.panes.primaryLeaf)?.view ?? null) : null),
  );

  /** A focus request made while the stage was not mounted yet. */
  private focusWanted = false;
  private lastSelectedID: string | null = null;
  private lastBook: string | null = null;

  constructor() {
    this.edit = new EditingController(this);
    this.panes = new PanesController(this);
    this.hover = new HoverController(this);
    this.explorer = new ExplorerController(this);
    this.cmd = new CommandController(this);
  }

  /** Short notices slide in as stacked toasts (lib/toasts). */
  flash(text: string, tone: 'info' | 'warn' | 'error' = 'info'): void {
    toasts.push(text, tone);
  }

  // ---- lifecycle ------------------------------------------------------------

  /** Install every effect; call once during the shell's init. */
  install(): void {
    this.installBookEffects();
    this.edit.install();
    this.panes.install();
    this.cmd.install();
  }

  /** The shell unmounts (e.g. logout while an editor is open). */
  destroy(): void {
    this.explorer.destroy();
    this.cmd.destroy();
    this.hover.intent.cancel();
    void offline.watchConflicts(null);
    // Tear the editor session down (socket + Y.Doc).
    const s = this.edit.session;
    if (s) {
      sync.setEditor(s.vaultID, null);
      editorPool.release(s);
      this.edit.session = null;
    }
    // Drop the per-vault cache so the next vault load starts clean.
    void notes.openVault(null);
  }

  private installBookEffects(): void {
    // Conflict copies (lineage mismatch / deleted note) of this book.
    $effect(() => {
      const vid = vaults.selectedID;
      untrack(() => void offline.watchConflicts(vid));
    });

    // Push replicas of this book that still hold unsent edits (closed
    // notes edited offline) once the network is back.
    $effect(() => {
      const vid = vaults.selectedID;
      if (!vid || this.structuralOffline) return;
      const open = this.edit.session?.noteID ?? null;
      if (offline.pendingNotes(vid, open).length === 0) return;
      untrack(() => void flushPending(vid, open));
    });

    // Reset edit state whenever the focused note changes. ONLY
    // notes.selectedID is a dependency: the body runs untracked, because
    // reading the edit state here made the effect re-run when enterEdit
    // flipped editMode — cancelling the edit the instant it started.
    this.lastSelectedID = untrack(() => notes.selectedID);
    $effect(() => {
      const id = notes.selectedID;
      untrack(() => {
        if (id === this.lastSelectedID) return;
        this.lastSelectedID = id;
        if (this.edit.session && this.edit.session.noteID !== id) this.edit.exit();
        this.edit.error = null;
      });
    });

    // Hydrate notes whenever the active vault changes. The notes store
    // is idempotent on a no-op vaultID transition so this is safe. The
    // full list fetched here is the book's catch-up baseline (cursor =
    // the head known now; later heads trigger GET /changes).
    $effect(() => {
      const vid = vaults.selectedID;
      untrack(() => {
        if (notes.vaultID !== vid) {
          this.pane = 'home';
          this.explorer.reset();
          this.panes.state = null;
          this.plannedFor = null;
          this.noteHistory.reset();
        }
        if (this.edit.session && this.edit.session.vaultID !== vid) this.edit.exit();
        const b = vid ? books.bookForVault(vid) : null;
        if (b && notes.vaultID !== vid) sync.onBookOpened(b);
        void notes.openVault(vid);
      });
    });

    // A revoked book closes the editor (SPEC-LIVROS §3.3).
    $effect(() => {
      if (this.activeRevoked) untrack(() => this.edit.exit());
    });

    // A note that no longer exists (deleted here or elsewhere) returns to
    // the book's home.
    $effect(() => {
      if (this.pane === 'note' && !notes.selectedID) untrack(() => (this.pane = 'home'));
    });
    // A note selected from elsewhere (just created, a store-level select)
    // opens: the home never sits on top of a selected note.
    $effect(() => {
      if (this.pane === 'home' && notes.selectedID) untrack(() => (this.pane = 'note'));
    });

    // The last opened note, per book, per device.
    $effect(() => {
      const vid = vaults.selectedID;
      const id = this.pane === 'note' ? notes.selectedID : null;
      if (!vid || !id || this.plannedFor !== vid) return;
      untrack(() => rememberLastNote(vid, id));
    });

    // A book OPENS like a cover (motion v2): switching books swings the
    // new book's page in from its spine (left edge), in perspective.
    $effect(() => {
      const id = books.activeID;
      const prev = untrack(() => this.lastBook);
      this.lastBook = id;
      if (!prev || !id || prev === id || !motionAllowed()) return;
      void tick().then(() => {
        const page = this.rootEl?.querySelector<HTMLElement>('[data-testid="stage"], [data-testid="book-home"]');
        animate(page, [
          { transformOrigin: 'left center', transform: 'perspective(1600px) rotateY(-24deg) translateX(-18px) scale(0.97)', opacity: 0 },
          { transformOrigin: 'left center', transform: 'perspective(1600px) rotateY(3deg)', opacity: 1, offset: 0.7 },
          { transformOrigin: 'left center', transform: 'none', opacity: 1 },
        ], 560, 'cubic-bezier(0.22, 0.8, 0.25, 1)');
      });
    });

    // Opening a book (SPEC-PARTE2 §2): once the book's list is in, its
    // saved split layout, else its last note (per device), else the calm
    // home with the explorer floating.
    $effect(() => {
      const vid = vaults.selectedID;
      const ready = !!vid && notes.vaultID === vid && !notes.loadingList;
      if (!ready || this.plannedFor === vid) return;
      untrack(() => {
        if (uiState.pendingNote?.vault === vid) return; // the deep link decides
        const saved = this.panes.savedLayout(vid!);
        const plan = planBookOpen({
          notes: notes.list,
          layoutNote: saved ? findLeaf(saved.state.root, saved.primary)!.note : null,
          last: lastNote(vid!),
        });
        this.plannedFor = vid;
        if (plan.kind === 'note') {
          if (plan.source === 'layout' && saved) {
            this.panes.primaryLeaf = saved.primary;
            this.panes.state = saved.state;
          }
          this.noteHistory.visit(plan.note);
          this.pane = 'note';
          void notes.select(plan.note);
          void tick().then(() => this.focusReader());
        } else {
          this.pane = 'home';
          if (plan.explore && !this.explorer.fx && !this.cmd.overlayOpen()) this.explorer.open({ auto: true });
        }
      });
    });

    // Deep links (SPEC-PARTE2 §8): a pending #/b/<vault>/n/<note> opens
    // once the book's notes are in.
    $effect(() => {
      const want = uiState.pendingNote;
      const vid = vaults.selectedID;
      const ready = notes.vaultID === vid && !notes.loadingList;
      if (!want || !vid || want.vault !== vid || !ready) return;
      untrack(() => {
        uiState.pendingNote = null;
        this.plannedFor = vid;
        const n = want.note
          ? notes.list.find((x) => x.id === want.note)
          : notes.list.find((x) => normalizePath(x.path) === normalizePath(want.path ?? ''));
        if (!n) {
          this.flash('that note is not in this book (deleted or moved?)', 'warn');
          if (this.pane === 'home' && !this.explorer.fx) this.explorer.open({ auto: true });
          return;
        }
        this.panes.state = null;
        this.explorer.fx = null;
        this.openNote(n.id);
      });
    });

    // The URL follows the book / note (so it can be copied or targeted by
    // `lumi open`); replaceState, so Back is not flooded.
    $effect(() => {
      const vid = vaults.selectedID;
      const id = this.pane === 'note' ? notes.selectedID : null;
      if (!vid || uiState.pendingNote) return;
      const want = formatDeepLink({ vault: vid, note: id ?? undefined });
      try {
        if (window.location.hash !== want) window.history.replaceState(window.history.state, '', want);
      } catch {
        /* sandboxed */
      }
    });
  }

  // ---- the stage ------------------------------------------------------------

  /** The scrollable reader of the primary pane. */
  readerEl(): HTMLElement | null {
    return this.panes.multi ? this.panes.primaryWrapEl : this.previewEl;
  }

  /** Focus the primary pane's reader (or its structured view). When the
   *  stage has not mounted yet, it takes focus as soon as it does. */
  focusReader(): void {
    const el = this.readerEl();
    if (el) {
      this.focusWanted = false;
      focusPane(el);
    } else {
      this.focusWanted = this.pane === 'note';
    }
  }

  /** The stage mounted: honour a focus request made before it existed. */
  stageMounted(): void {
    if (!this.focusWanted) return;
    this.focusWanted = false;
    const a = document.activeElement;
    if (a && a !== document.body && !this.rootEl?.contains(a)) return;
    if (a && a !== document.body && a.closest('.fx, [role="dialog"]')) return;
    focusPane(this.readerEl());
  }

  /** Book-relative path of the note in leaf `id`. */
  leafPath(id: string = this.panes.activeLeafId): string {
    if (id === this.panes.primaryLeaf) return notes.selected?.path ?? notes.content?.path ?? '';
    const t = this.panes.state;
    const l = t ? findLeaf(t.root, id) : null;
    return (l && notes.list.find((n) => n.id === l.note)?.path) ?? this.panes.refs[id]?.notePath() ?? '';
  }

  /** The note an action applies to: the open note, if any. */
  noteUnderFocus(): string | null {
    return this.pane === 'note' ? notes.selectedID : null;
  }

  scrollNote(by: ScrollBy): void {
    if (this.panes.activeIsSecondary) return this.panes.refs[this.panes.activeLeafId]?.scroll(by);
    const el = this.readerEl();
    if (!el) return;
    const h = el.clientHeight;
    const smooth = (top: number) => {
      if (typeof el.scrollTo === 'function') el.scrollTo({ top, behavior: scrollBehavior() });
      else el.scrollTop = top;
    };
    if (by === 'top') smooth(0);
    else if (by === 'bottom') smooth(el.scrollHeight);
    else if (by === 'half') smooth(el.scrollTop + h / 2);
    else if (by === '-half') smooth(el.scrollTop - h / 2);
    else if (by === 'page') smooth(el.scrollTop + h * 0.9);
    else if (by === '-page') smooth(el.scrollTop - h * 0.9);
    else el.scrollTop += by;
  }

  // ---- the book's home ------------------------------------------------------

  homeFocus(i: number): void {
    if (this.recents.length === 0) return;
    this.homeIndex = Math.max(0, Math.min(this.recents.length - 1, i));
    this.homeEl?.querySelector<HTMLElement>(`[data-recent="${this.homeIndex}"]`)?.focus({ preventScroll: false });
  }

  homeMove(d: number): void {
    const a = document.activeElement as HTMLElement | null;
    const at = a?.dataset?.recent != null ? Number(a.dataset.recent) : this.homeIndex;
    this.homeFocus(at < 0 ? (d > 0 ? 0 : this.recents.length - 1) : at + d);
  }

  /** Close the open note: back to the book's home. */
  closeNote(): void {
    if (this.edit.mode) this.edit.exit();
    const vid = vaults.selectedID;
    if (vid) rememberLastNote(vid, null);
    void withViewTransition(async () => {
      this.pane = 'home';
      this.panes.state = null;
      await tick();
    });
    void notes.select(null);
    this.homeIndex = -1;
    void tick().then(() => this.homeEl?.focus({ preventScroll: true }));
  }

  cycleBook(dir: 1 | -1): void {
    const order = selectorOrder(books.list);
    if (order.length < 2) return;
    const i = Math.max(0, order.findIndex((b) => b.id === books.activeID));
    books.setActive(order[(i + dir + order.length) % order.length].id);
  }

  // ---- opening notes and links (SPEC-PARTE2 §3) ----------------------------

  openNote(id: string, o: OpenOpts = {}): void {
    this.openIn(id, 'current', this.panes.primaryLeaf, o);
  }

  /** Open note `id` in the current pane, or in a new split. */
  openIn(id: string, where: OpenWhere, leaf: string = this.panes.activeLeafId, o: OpenOpts = {}): void {
    // The layout moves under a still pointer: no card for a moment.
    this.hover.quiet(700);
    if (where === 'current') armRise();
    this.hover.intent.hide();
    if (where !== 'current') {
      if (o.closeFx) this.explorer.fx = null;
      void this.panes.splitWith(where === 'vsplit' ? 'row' : 'col', id, leaf);
      return;
    }
    if (this.panes.multi && leaf !== this.panes.primaryLeaf && this.panes.state) {
      if (o.closeFx) this.explorer.fx = null;
      this.panes.setLeafNote(leaf, id);
      return;
    }
    if (this.edit.mode) this.edit.exit();
    if (o.history !== false) this.noteHistory.visit(id);
    if (editorSettings.value.openIn === 'editing') {
      if (o.closeFx) this.explorer.fx = null;
      void this.edit.editNote(id);
      return;
    }
    // Never wait for the network inside a transition: a body the
    // explorer preview already fetched paints at once, anything else
    // shows the reader skeleton until it arrives.
    const vid = vaults.selectedID;
    const hit = vid ? peekNote(vid, id) : null;
    const seed = hit && !hit.stale ? hit.content : null;
    const update = async () => {
      if (o.closeFx) this.explorer.fx = null;
      void notes.select(id, seed);
      this.pane = 'note';
      await tick();
    };
    const run = o.from && seed ? sharedTransition('note-title', o.from, update) : withViewTransition(update);
    // A canvas / board that already took focus on mount keeps it.
    void run.then(() => this.focusReader());
  }

  /** Follow an href found in the note at `fromPath`. */
  followLink(href: string, where: OpenWhere, fromPath: string, wiki = false, leaf: string = this.panes.activeLeafId): void {
    const t = classifyLink(notes.list, fromPath, href, wiki);
    switch (t.kind) {
      case 'note': this.openIn(t.note.id, where, leaf); return;
      case 'external': window.open(t.url, '_blank', 'noopener,noreferrer'); return;
      case 'missing': this.flash(`no note at ${t.path}`, 'warn'); return;
      case 'unsafe': this.flash('link not followed (unsupported scheme)', 'warn'); return;
      case 'anchor': return;
    }
  }

  /** Link clicks in rendered markdown: plain click = this pane,
   *  Cmd/Ctrl-click = vertical split, Shift-Cmd/Ctrl-click = horizontal. */
  routeClick(href: string, e: MouseEvent, fromPath: string, leaf: string): void {
    if (href.startsWith('#')) return;
    const where = whereFromClick(e, MAC);
    if (!where) return; // middle / Alt-click: the browser's
    e.preventDefault();
    this.hover.intent.hide();
    this.followLink(href, where, fromPath, false, leaf);
  }

  /** Open a relative note link from the open note (Live Preview
   *  Mod-click without a pane router). */
  openLinkedNote = (href: string): void => {
    this.followLink(href, 'current', this.leafPath(this.panes.primaryLeaf), false, this.panes.primaryLeaf);
  };

  /** Link clicks inside the primary pane's rendered markdown (reader,
   *  split preview). In-note `#` anchors are handled by MarkdownView. */
  onMdLink = (href: string, e: MouseEvent): void => {
    this.routeClick(href, e, this.leafPath(this.panes.primaryLeaf), this.panes.primaryLeaf);
  };

  /** The reader's link target for gf / K / Ctrl-w f: the focused link,
   *  else the hovered one, else the first link in view. */
  readerLinkTarget(root: HTMLElement | null = this.activeReaderRoot()): LinkAt | null {
    if (!root) return null;
    const a = document.activeElement;
    let el: Element | null = a instanceof HTMLAnchorElement && root.contains(a) ? a : null;
    const hovered = this.hover.lastEl;
    if (!el && hovered && root.contains(hovered)) el = hovered;
    if (!el) {
      const r = root.getBoundingClientRect();
      el = Array.from(root.querySelectorAll('.md-body a[href]')).find((x) => {
        const b = x.getBoundingClientRect();
        return b.bottom > r.top && b.top < r.bottom && !(x.getAttribute('href') ?? '').startsWith('#');
      }) ?? null;
    }
    const href = el?.getAttribute('href');
    return href ? { href, wiki: false, from: 0, to: 0 } : null;
  }

  activeReaderRoot(): HTMLElement | null {
    if (this.panes.activeIsSecondary) return this.panes.refs[this.panes.activeLeafId]?.element() ?? null;
    if (this.edit.mode && this.panes.activePane === 'split') return this.edit.splitRef?.previewElement() ?? null;
    return this.readerEl();
  }

  // ---- clipboard ------------------------------------------------------------

  async copyText(text: string, sel: string | undefined): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      this.flash(sel ? 'copied selection' : 'copied note text');
    } catch {
      this.flash('clipboard unavailable', 'warn');
    }
  }

  async copyNoteText(): Promise<void> {
    const sel = window.getSelection?.()?.toString();
    await this.copyText(sel || notes.content?.body || '', sel);
  }

  async copyPreviewText(): Promise<void> {
    const sel = window.getSelection?.()?.toString();
    await this.copyText(sel || this.edit.session?.ytext.toString() || notes.content?.body || '', sel);
  }

  copyLinkTo(e: NoteEntry, fromPath: string): void {
    const link = markdownLink(e.note.title ?? e.name, fromPath, e.note.path || e.note.id + '.md');
    void navigator.clipboard?.writeText(link).then(() => this.flash('copied ' + link), () => this.flash('clipboard unavailable', 'warn'));
  }

  copyDeepLink(): void {
    const vid = vaults.selectedID;
    if (!vid) return;
    const url = window.location.origin + window.location.pathname + formatDeepLink({ vault: vid, note: notes.selectedID ?? undefined });
    void navigator.clipboard?.writeText(url).then(() => this.flash('copied link'), () => this.flash('clipboard unavailable', 'warn'));
  }

  /** Status-line path of what fills the stage. */
  fmtPath(): string {
    if (this.pane === 'note' && notes.selected) return normalizePath(notes.selected.path);
    return '/';
  }
}
