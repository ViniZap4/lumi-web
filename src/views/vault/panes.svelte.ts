// Panes: splits of notes (SPEC-PARTE2 §3).
//
// The note area is a tree of panes (lib/pane-tree.ts). `state` is null
// while there is a single pane (the classic reader/editor). The
// *primary* leaf renders the open note (notes.selected + the editing
// controller's session); every other leaf is a NotePane with its own
// note, reader and editor. Live sessions are shared through editorPool,
// so two panes on one note edit one Y.Doc. A pane renders the note view
// its kind picks (lib/note-views.ts): markdown, kanban, canvas.

import { tick, untrack } from 'svelte';
import { vaults } from '../../lib/vaults.svelte.ts';
import { notes } from '../../lib/notes.svelte.ts';
import { editorSettings } from '../../lib/editor-settings.svelte.ts';
import { linkCandidates } from '../../lib/links.ts';
import { withViewTransition, animate, SPRING, motionAllowed, springIn, exitGhost } from '../../lib/motion.ts';
import { dropSide, noteIdOfKey, NOTE_DRAG_TYPE, type DropTarget } from '../../lib/pane-drop.ts';
import { paneLayout, paneTarget, panesOf, type PaneId, type PaneDir, type WinCmd } from '../../lib/pane-nav.ts';
import {
  single, splitPane, closePane, equalize, setNote, setView, focus as focusLeafState, resizeSplit, nudgePane,
  neighbor, cycle, leaves, findLeaf, paneCount, parsePaneState, pruneNotes, newPaneId,
  type PaneState, type SplitDir,
} from '../../lib/pane-tree.ts';
import type { LinkAt } from '../../lib/link-open.ts';
import type { Workspace, ScrollBy } from './workspace.svelte.ts';

/** What the shell calls on a mounted secondary NotePane. */
export type NotePaneHandle = {
  focus(): void;
  scroll(by: ScrollBy): void;
  enterEdit(): Promise<void>;
  exitEdit(): void;
  isEditing(): boolean;
  element(): HTMLElement | null;
  notePath(): string;
};

export type DropAt = { leaf: string; t: DropTarget; rect: { left: number; top: number; width: number; height: number } };

export const PANES_KEY = 'lumi.panes.v1:';

/** The saved split layout of a book (only multi-pane layouts are kept),
 *  pruned to the notes that still exist; null when nothing usable. */
export function readSavedLayout(raw: string | null, noteIds: Set<string>): { state: PaneState; primary: string } | null {
  let o: { state?: unknown; primary?: unknown } | null = null;
  try {
    o = JSON.parse(raw ?? 'null');
  } catch {
    o = null;
  }
  const parsed = o ? parsePaneState(o.state) : null;
  if (!parsed) return null;
  const pruned = pruneNotes(parsed, (n) => noteIds.has(n));
  if (!pruned || paneCount(pruned) < 2) return null;
  const prim = typeof o?.primary === 'string' && findLeaf(pruned.root, o.primary) ? o.primary : pruned.active;
  return { state: pruned, primary: prim };
}

export class PanesController {
  state = $state.raw<PaneState | null>(null);
  primaryLeaf = $state(newPaneId());
  readonly refs: Record<string, NotePaneHandle | null> = $state({});
  info = $state<Record<string, { editing: boolean; title: string }>>({});
  primaryWrapEl = $state<HTMLElement | null>(null);
  /** The leaf filling the note area (tmux zoom); the others stay
   *  mounted, hidden. Never persisted. */
  zoomed = $state<string | null>(null);
  /** Which pane holds keyboard focus (click focuses panes too). */
  focusedPane = $state<PaneId | null>(null);
  narrowView = $state(false);
  splitNarrow = $state(false);
  dropAt = $state<DropAt | null>(null);
  noteDragging = $state(false);
  prevPane: PaneId | null = null;
  private prevLeaf: string | null = null;

  readonly multi = $derived.by(() => !!this.state && paneCount(this.state) > 1 && this.ws.pane === 'note');
  readonly activeLeafId = $derived(this.state?.active ?? this.primaryLeaf);
  readonly activeIsSecondary = $derived(this.multi && this.activeLeafId !== this.primaryLeaf);
  readonly leafList = $derived(this.state ? leaves(this.state.root) : []);
  readonly layout = $derived.by(() =>
    paneLayout({
      splitNarrow: this.splitNarrow,
      editing: this.ws.edit.mode && !!this.ws.edit.session,
      split: this.ws.edit.mode && editorSettings.value.editMode === 'source' && editorSettings.value.previewSplit && !!this.ws.edit.session?.editable,
      mainHasNote: this.ws.pane === 'note' && !!notes.selectedID && !!notes.content,
    }),
  );
  /** The focused pane when it is on screen; else the pane the current
   *  mode implies. */
  readonly activePane: PaneId = $derived.by(() => {
    if (this.focusedPane === 'leaf' && this.activeIsSecondary) return 'leaf';
    if (this.focusedPane && panesOf(this.layout).includes(this.focusedPane)) return this.focusedPane;
    if (this.ws.edit.mode && this.ws.edit.session) return 'editor';
    return 'main';
  });
  readonly multiPane = $derived(this.multi || this.layout.order.length + (this.layout.stack ? 1 : 0) > 1);

  constructor(private readonly ws: Workspace) {}

  install(): void {
    $effect(() => {
      if (this.zoomed && (!this.multi || !this.state || !findLeaf(this.state.root, this.zoomed))) untrack(() => (this.zoomed = null));
    });

    // The primary leaf follows the open note.
    $effect(() => {
      const id = notes.selectedID;
      untrack(() => {
        if (!this.state) return;
        const l = findLeaf(this.state.root, this.primaryLeaf);
        if (!l) return;
        if (id && l.note !== id) this.state = setNote(this.state, this.primaryLeaf, id);
        else if (!id && !notes.loadingContent && paneCount(this.state) > 1 && this.ws.pane === 'note') {
          // The primary note is gone (deleted): its pane closes.
          this.closeLeaf(this.primaryLeaf);
        }
      });
    });

    // Notes deleted elsewhere close their panes and leave the history.
    $effect(() => {
      const list = notes.list;
      untrack(() => {
        if (notes.loadingList || notes.stale) return;
        const ids = new Set(list.map((n) => n.id));
        this.ws.noteHistory.prune((n) => ids.has(n));
        if (!this.state) return;
        const pruned = pruneNotes(this.state, (n) => ids.has(n));
        if (pruned === this.state) return;
        if (!pruned || paneCount(pruned) < 2) this.state = null;
        else {
          if (!findLeaf(pruned.root, this.primaryLeaf)) this.promote(pruned.active);
          this.state = pruned;
        }
      });
    });

    // Layout per book, per device (only multi-pane layouts are kept).
    $effect(() => {
      const vid = vaults.selectedID;
      const s = this.state;
      const prim = this.primaryLeaf;
      untrack(() => {
        if (!vid || this.ws.plannedFor !== vid) return;
        try {
          if (s && paneCount(s) > 1) localStorage.setItem(PANES_KEY + vid, JSON.stringify({ v: 1, state: s, primary: prim }));
          else localStorage.removeItem(PANES_KEY + vid);
        } catch {
          /* storage unavailable */
        }
      });
    });
  }

  /** The book's saved split layout (pruned to existing notes), or null. */
  savedLayout(vid: string): { state: PaneState; primary: string } | null {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(PANES_KEY + vid);
    } catch {
      raw = null;
    }
    return readSavedLayout(raw, new Set(notes.list.map((n) => n.id)));
  }

  /** A focusin anywhere in the view: track the pane that holds focus. */
  onFocusIn(e: FocusEvent): void {
    const leafEl = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-leaf]') : null;
    if (leafEl?.dataset.leaf && this.state && this.state.active !== leafEl.dataset.leaf) this.state = focusLeafState(this.state, leafEl.dataset.leaf);
    const el = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-pane]') : null;
    const p = (el?.dataset.pane as PaneId | undefined) ?? null;
    if (!p || p === this.focusedPane) return;
    this.prevPane = this.focusedPane;
    this.focusedPane = p;
    this.ws.cmd.resetPreviewKeys();
  }

  /** First click/tap in a pane (lib/pane-click): focus it. */
  activate(leaf: string): void {
    if (this.state && this.state.active !== leaf && findLeaf(this.state.root, leaf)) this.state = focusLeafState(this.state, leaf);
    if (leaf !== this.primaryLeaf && this.multi) this.focusedPane = 'leaf';
  }

  /** Mark leaf `id` active in the tree (pointer down, editor focus). */
  markActive(id: string): void {
    if (this.state && this.state.active !== id) this.state = focusLeafState(this.state, id);
  }

  setLeafNote(leaf: string, id: string): void {
    if (this.state) this.state = setNote(this.state, leaf, id);
  }

  setLeafView(leaf: string, view: string | null): void {
    if (this.state) this.state = setView(this.state, leaf, view);
  }

  resize(id: string, i: number, at: number): void {
    if (this.state) this.state = resizeSplit(this.state, id, i, at);
  }

  equalize(): void {
    if (this.state) this.state = equalize(this.state);
  }

  // ---- focus movement (Ctrl-h/j/k/l, Ctrl-w h/j/k/l/w/p) -------------------

  /** Move focus `dir`; false when no pane lies that way. With several
   *  note panes, h/j/k/l follow the pane tree's geometry; the editor |
   *  preview pair of the primary pane moves inside first. */
  navigate = (dir: PaneDir): boolean => {
    // Moving to another pane unzooms first (tmux).
    if (this.zoomed) void this.setZoom(null, false);
    if (this.multi && this.state) return this.navigateTree(dir);
    const from = this.activePane;
    const to = paneTarget(this.layout, from, dir, this.prevPane);
    if (!to || to === from) return false;
    void this.focusPaneEl(to, from);
    return true;
  };

  private navigateTree(dir: PaneDir): boolean {
    const t = this.state!;
    const cur = this.activeLeafId;
    if (dir === 'w' || dir === 'p') {
      const to = dir === 'w' ? cycle(t, cur, 1) : (this.prevLeaf && findLeaf(t.root, this.prevLeaf) ? this.prevLeaf : null);
      if (!to || to === cur) return false;
      this.prevLeaf = cur;
      this.focusLeaf(to);
      return true;
    }
    // Inside the primary pane: editor ⇄ split preview first.
    if (!this.activeIsSecondary && this.ws.edit.mode && this.ws.edit.session && (dir === 'h' || dir === 'l')) {
      const inner = this.activePane;
      if (dir === 'l' && inner === 'editor' && this.layout.order.includes('split')) return void this.focusPaneEl('split', 'editor'), true;
      if (dir === 'h' && inner === 'split') return void this.focusPaneEl('editor', 'split'), true;
    }
    const to = neighbor(t, cur, dir);
    if (!to) return false;
    this.prevLeaf = cur;
    this.focusLeaf(to, dir);
    return true;
  }

  async focusPaneEl(to: PaneId, from: PaneId | null = this.activePane): Promise<void> {
    const ed = this.ws.edit;
    switch (to) {
      case 'main':
        this.ws.focusReader();
        return;
      case 'split':
        await ed.splitRef?.focusPreview();
        return;
      case 'editor': {
        ed.splitRef?.revealSource();
        await tick();
        if (from === 'split' && editorSettings.value.previewCursorSync) {
          const line = ed.splitRef?.topLine();
          if (line != null) ed.editorRef?.gotoLine(line);
        }
        ed.editorRef?.focus();
        return;
      }
    }
  }

  focusLeaf(id: string, from?: PaneDir): void {
    if (this.state) this.state = focusLeafState(this.state, id);
    if (id === this.primaryLeaf || !this.multi) {
      const ed = this.ws.edit;
      if (ed.mode && ed.session) {
        const split = editorSettings.value.editMode === 'source' && editorSettings.value.previewSplit && !this.splitNarrow;
        void this.focusPaneEl(from === 'h' && split ? 'split' : 'editor');
      } else void this.focusPaneEl('main');
      return;
    }
    this.refs[id]?.focus();
  }

  // ---- tree edits -----------------------------------------------------------

  private ensureTree(): PaneState | null {
    if (this.state) return this.state;
    const id = notes.selectedID;
    if (!id) return null;
    this.state = single(id, this.primaryLeaf);
    return this.state;
  }

  leafElement(id: string): HTMLElement | null {
    return this.ws.rootEl?.querySelector<HTMLElement>(`[data-leaf="${id}"]`) ?? null;
  }

  private leafEls(): HTMLElement[] {
    return [...(this.ws.rootEl?.querySelectorAll<HTMLElement>('[data-leaf]') ?? [])];
  }

  /** Zoom `id` (or unzoom with null). The zoomed pane is revealed from
   *  its old box to the full note area (clip, no text distortion); on
   *  unzoom the hidden panes settle back in around it. */
  async setZoom(id: string | null, animated = true): Promise<void> {
    if (id === this.zoomed) return;
    if (id && (!this.multi || !this.state || !findLeaf(this.state.root, id))) {
      this.ws.flash('zoom needs a split — ⌃w v first', 'warn');
      return;
    }
    const target = id ?? this.zoomed!;
    const el = this.leafElement(target);
    const first = el?.getBoundingClientRect() ?? null;
    // Zoom in: the other panes RECEDE (a snapshot of each shrinks and
    // fades where it stood) while the zoomed one expands over them.
    if (id && animated) {
      for (const x of this.leafEls()) {
        if (x.dataset.leaf !== target) exitGhost(x, { scale: 0.9, opacity: 0 }, { spring: 'gentle', origin: '50% 50%' });
      }
    }
    if (id && this.state) this.state = focusLeafState(this.state, id);
    this.zoomed = id;
    await tick();
    if (!animated || !motionAllowed()) return;
    const now = this.leafElement(target);
    if (id && now && first) {
      // Grow: the pane's content starts where it was (translated to the
      // old box) and slides home while its visible window (clip) widens
      // to the full area — a shared-element grow without scaling text.
      const last = now.getBoundingClientRect();
      const dx = first.left - last.left;
      const dy = first.top - last.top;
      const inset = `inset(0px ${Math.max(0, last.width - first.width)}px ${Math.max(0, last.height - first.height)}px 0px round 12px)`;
      animate(now, [
        { transform: `translate(${dx}px, ${dy}px)`, clipPath: inset },
        { transform: 'none', clipPath: 'inset(0px 0px 0px 0px round 0px)' },
      ], SPRING.glide.ms, SPRING.glide.easing);
    } else if (!id) {
      const others = this.leafEls().filter((x) => x.dataset.leaf !== target);
      // Unzoom: the zoomed pane springs back into its slot (FLIP from
      // the full area) and the others come forward again, one by one.
      others.forEach((x, i) => springIn(x, { scale: 0.9, opacity: 0 }, { spring: 'glide', delay: Math.min(160, 40 + i * 45), origin: '50% 50%' }));
      if (now && first) {
        const last = now.getBoundingClientRect();
        springIn(now, { x: first.left - last.left, y: first.top - last.top, sx: first.width / last.width, sy: first.height / last.height }, { spring: 'glide', origin: '0 0', absolute: true });
      }
    }
  }

  toggleZoom = (id: string = this.activeLeafId): void => {
    void this.setZoom(this.zoomed ? null : id);
  };

  /** Open `note` in a new pane beside (`row`) or below (`col`) leaf `at`. */
  async splitWith(dir: SplitDir, note: string | null, at: string = this.activeLeafId, before = false): Promise<void> {
    // Opening a split unzooms first.
    if (this.zoomed) this.zoomed = null;
    // From the home, the first note simply opens.
    if (this.ws.pane === 'home' || !notes.selectedID) {
      if (note) this.ws.openNote(note);
      else this.ws.flash('open a note first', 'warn');
      return;
    }
    const base = this.ensureTree();
    if (!base) return this.ws.flash('open a note first', 'warn');
    const target = note ?? findLeaf(base.root, at)?.note ?? notes.selectedID;
    if (!target) return;
    const next = splitPane(base, findLeaf(base.root, at) ? at : base.active, dir, target, undefined, before);
    if (!next) return this.ws.flash('too many panes — close one first (⌃w q)', 'warn');
    // FLIP: remember where every existing pane was.
    const firsts = new Map<string, DOMRect>();
    for (const x of this.leafEls()) firsts.set(x.dataset.leaf!, x.getBoundingClientRect());
    this.state = next;
    await tick();
    const el = this.leafElement(next.active);
    // The new pane UNFOLDS from the divider it shares with its sibling
    // (scale from that edge, glide: it overshoots a hair and settles)…
    const edge = dir === 'row' ? (before ? 'right center' : 'left center') : before ? 'center bottom' : 'center top';
    springIn(el, dir === 'row' ? { sx: 0.4, opacity: 0 } : { sy: 0.4, opacity: 0 }, { spring: 'glide', origin: edge });
    // …and the neighbours spring to their new sizes.
    for (const x of this.leafEls()) {
      const f = firsts.get(x.dataset.leaf!);
      if (!f || x === el) continue;
      const l = x.getBoundingClientRect();
      if (!l.width || !l.height) continue;
      springIn(x, { x: f.left - l.left, y: f.top - l.top, sx: f.width / l.width, sy: f.height / l.height }, { spring: 'glide', origin: '0 0', absolute: true });
    }
    this.focusedPane = 'leaf';
    this.refs[next.active]?.focus();
    requestAnimationFrame(() => {
      if (this.state?.active === next.active) this.refs[next.active]?.focus();
    });
  }

  /** Make leaf `id` the primary one (it shows notes.selected). */
  promote(id: string): void {
    if (!this.state || id === this.primaryLeaf) return;
    const l = findLeaf(this.state.root, id);
    if (!l) return;
    const wasEditing = this.refs[id]?.isEditing() ?? false;
    if (this.ws.edit.session) this.ws.edit.exit();
    this.primaryLeaf = id;
    void notes.select(l.note).then(() => {
      // The secondary pane released its session with a grace period:
      // the primary picks the same live doc up.
      if (wasEditing) void this.ws.edit.enter();
    });
  }

  closeLeaf = (id: string = this.activeLeafId): void => {
    if (!this.state || paneCount(this.state) < 2) {
      if (this.ws.edit.mode) this.ws.edit.exitAnimated();
      else this.ws.closeNote();
      return;
    }
    const next = closePane(this.state, id);
    if (!next) return;
    void withViewTransition(async () => {
      if (id === this.primaryLeaf) this.promote(next.active === id ? leaves(next.root)[0].id : next.active);
      this.state = paneCount(next) > 1 ? next : null;
      if (!this.state) this.primaryLeaf = leaves(next.root)[0].id;
      delete this.refs[id];
      await tick();
    });
    void tick().then(() => this.focusLeaf(next.active));
  };

  onlyLeaf(id: string = this.activeLeafId): void {
    if (!this.state) return;
    if (id !== this.primaryLeaf) this.promote(id);
    void withViewTransition(async () => {
      this.state = null;
      await tick();
    });
    void tick().then(() => this.focusLeaf(this.primaryLeaf));
  }

  setPrimaryView(view: string | null): void {
    const base = this.ensureTree();
    if (base) this.state = setView(base, this.primaryLeaf, view);
  }

  /** Window commands: Ctrl-w v/s/q/o/=/f/F/</>/+/- and :vsplit etc. */
  runWin = (cmd: WinCmd, o: { link?: LinkAt | null; arg?: string } = {}): void => {
    switch (cmd) {
      case 'vsplit':
      case 'split': {
        let note: string | null = null;
        if (o.arg) {
          const hit = linkCandidates(notes.list, o.arg, { limit: 1 })[0];
          if (!hit) return this.ws.flash(`no note matches “${o.arg}”`, 'warn');
          note = hit.id;
        }
        void this.splitWith(cmd === 'vsplit' ? 'row' : 'col', note);
        return;
      }
      case 'close': this.closeLeaf(); return;
      case 'only': this.onlyLeaf(); return;
      case 'zoom': this.toggleZoom(); return;
      case 'equal': this.equalize(); return;
      case 'linkV':
      case 'linkH': {
        const l = o.link ?? this.ws.readerLinkTarget();
        if (!l) return this.ws.flash('no link under the cursor', 'warn');
        this.ws.followLink(l.href, cmd === 'linkV' ? 'vsplit' : 'hsplit', this.ws.leafPath(), l.wiki);
        return;
      }
      case 'wider':
      case 'narrower':
      case 'taller':
      case 'shorter':
        if (!this.state) return;
        this.state = nudgePane(this.state, this.activeLeafId, cmd === 'wider' || cmd === 'narrower' ? 'row' : 'col', cmd === 'wider' || cmd === 'taller' ? 0.05 : -0.05);
        return;
    }
  };

  // ---- drag a note from the explorer onto a pane edge ---------------------

  private dropTargetAt(x: number, y: number): DropAt | null {
    const stage = this.ws.previewEl;
    if (!stage || this.ws.pane !== 'note') return null;
    const els = this.multi ? [...stage.querySelectorAll<HTMLElement>('[data-leaf]')] : [stage];
    for (const el of els) {
      const r = el.getBoundingClientRect();
      if (!r.width) continue;
      const t = dropSide(r, x, y);
      if (t) return { leaf: el.dataset.leaf ?? this.primaryLeaf, t, rect: { left: r.left, top: r.top, width: r.width, height: r.height } };
    }
    return null;
  }

  onStageDragOver = (e: DragEvent): void => {
    if (!e.dataTransfer || ![...e.dataTransfer.types].includes(NOTE_DRAG_TYPE)) return;
    const d = this.dropTargetAt(e.clientX, e.clientY);
    this.dropAt = d;
    if (d) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  };

  onStageDrop = (e: DragEvent): void => {
    const d = this.dropAt ?? this.dropTargetAt(e.clientX, e.clientY);
    this.dropAt = null;
    const key = e.dataTransfer?.getData(NOTE_DRAG_TYPE);
    const id = key ? noteIdOfKey(key) : null;
    if (!d || !id) return;
    e.preventDefault();
    this.ws.explorer.fx = null;
    this.noteDragging = false;
    void this.splitWith(d.t.dir, id, d.leaf, d.t.before);
  };
}
