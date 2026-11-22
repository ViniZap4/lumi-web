// Miller-column navigation state (wave 3, SPEC-V3 "Yazi navigation").
//
// Mirrors the TUI tree browser's grammar (tui-client/ui/keys_tree.go,
// history.go): the browser shows parent | current | preview columns;
// `h` ascends (landing on the folder you came from), `l` descends into
// a folder, `H`/`L` walk a capped back/forward history of folder
// visits, `gg`/`G` jump to the ends, `gh`/`zh` go to the book root.
// Each folder remembers its own selection, so walking back out
// restores the cursor like yazi does.
//
// Pure state, no DOM: the view feeds keys/clicks and renders the
// derived columns. The tree is derived from a source getter (the notes
// store list) so it follows live changes; a folder that disappears
// (all its notes moved/deleted) resolves to its nearest surviving
// ancestor.

import type { NoteSummary } from './types.ts';
import {
  buildTree,
  filterEntries,
  folderKey,
  nearestExisting,
  noteKey,
  parentDir,
  ROOT,
  type Entry,
  type NoteEntry,
  type NoteTree,
} from './notetree.ts';

/** Same cap as the TUI (navHistoryCap). */
export const HISTORY_CAP = 50;

interface Loc {
  dir: string;
  key: string | null;
}

interface Remembered {
  key: string | null;
  index: number;
}

export class MillerNav {
  /** Requested folder; `dir` is the one actually shown. */
  cwd = $state(ROOT);
  /** Filter for the CURRENT column (`/`). Cleared on folder change. */
  filter = $state('');
  /** Per-folder remembered selection. Replaced, not mutated. */
  private memory = $state.raw<ReadonlyMap<string, Remembered>>(new Map());
  private back = $state.raw<readonly Loc[]>([]);
  private fwd = $state.raw<readonly Loc[]>([]);

  /** Replaced in the constructor; initialised here (before the
   *  deriveds that read it lazily) to satisfy field-order checks. */
  private source: () => readonly NoteSummary[] = () => [];

  readonly tree: NoteTree = $derived(buildTree(this.source()));
  readonly dir: string = $derived(nearestExisting(this.tree, this.cwd));
  readonly allEntries: readonly Entry[] = $derived(this.tree.folders.get(this.dir) ?? []);
  readonly entries: readonly Entry[] = $derived(filterEntries(this.allEntries, this.filter));
  readonly cursor: number = $derived(this.resolveCursor(this.dir, this.entries));
  readonly current: Entry | null = $derived(this.entries[this.cursor] ?? null);

  readonly parent: string | null = $derived(parentDir(this.dir));
  readonly parentEntries: readonly Entry[] = $derived(
    this.parent == null ? [] : (this.tree.folders.get(this.parent) ?? []),
  );
  /** The current folder's row in the parent column. */
  readonly parentCursor: number = $derived(
    this.parent == null ? -1 : this.parentEntries.findIndex((e) => e.key === folderKey(this.dir)),
  );
  /** Children of the folder under the cursor (preview column). */
  readonly previewEntries: readonly Entry[] | null = $derived(
    this.current?.kind === 'folder' ? (this.tree.folders.get(this.current.path) ?? []) : null,
  );
  readonly previewCursor: number = $derived(
    this.current?.kind === 'folder' ? this.resolveCursor(this.current.path, this.previewEntries ?? []) : -1,
  );

  get canBack(): boolean {
    return this.back.length > 0;
  }
  get canForward(): boolean {
    return this.fwd.length > 0;
  }

  constructor(source: () => readonly NoteSummary[]) {
    this.source = source;
  }

  // ---- cursor ---------------------------------------------------------------

  /** Move the cursor by `delta` rows (clamped). */
  move(delta: number): void {
    if (this.entries.length === 0) return;
    this.setCursor(this.cursor + delta);
  }

  top(): void {
    this.setCursor(0);
  }

  bottom(): void {
    this.setCursor(this.entries.length - 1);
  }

  setCursor(i: number): void {
    const n = this.entries.length;
    if (n === 0) return;
    const index = Math.max(0, Math.min(n - 1, i));
    this.remember(this.dir, this.entries[index].key, index);
  }

  // ---- columns ----------------------------------------------------------------

  /** `h`: ascend, landing on the folder we came from. No-op at root. */
  left(): boolean {
    const p = this.parent;
    if (p == null) return false;
    this.goTo(p, folderKey(this.dir));
    return true;
  }

  /** `l` / Enter: descend into the folder under the cursor. Returns
   *  the note under the cursor instead (caller opens it). */
  right(): NoteEntry | null {
    const e = this.current;
    if (!e) return null;
    if (e.kind === 'note') return e;
    this.goTo(e.path);
    return null;
  }

  /** Navigate to `dir` (recorded in history), optionally selecting
   *  `selectKey` there. No-op (and no history entry) when already
   *  there and nothing to select — `gh` at the root does not pollute
   *  the stack, as in the TUI. */
  goTo(dir: string, selectKey?: string): void {
    const target = nearestExisting(this.tree, dir);
    if (target === this.dir) {
      this.filter = '';
      if (selectKey) this.selectKey(selectKey);
      return;
    }
    this.pushBack();
    this.fwd = [];
    this.enter(target, selectKey);
  }

  home(): void {
    this.goTo(ROOT);
  }

  /** `H` */
  historyBack(): boolean {
    const dest = this.back.at(-1);
    if (!dest) return false;
    this.back = this.back.slice(0, -1);
    this.fwd = capped([...this.fwd, this.here()]);
    this.enter(dest.dir, dest.key ?? undefined);
    return true;
  }

  /** `L` */
  historyForward(): boolean {
    const dest = this.fwd.at(-1);
    if (!dest) return false;
    this.fwd = this.fwd.slice(0, -1);
    this.back = capped([...this.back, this.here()]);
    this.enter(dest.dir, dest.key ?? undefined);
    return true;
  }

  /** Show `noteID` in its folder with the cursor on it (e.g. after the
   *  note was created or selected elsewhere). Returns false if unknown. */
  reveal(noteID: string): boolean {
    const dir = this.tree.noteDir.get(noteID);
    if (dir == null) return false;
    const key = noteKey(noteID);
    if (this.current?.key === key) return true;
    if (dir !== this.dir) this.goTo(dir, key);
    else {
      if (!this.entries.some((e) => e.key === key)) this.filter = '';
      this.selectKey(key);
    }
    return true;
  }

  setFilter(q: string): void {
    this.filter = q;
  }

  /** Forget everything (book switch). */
  reset(): void {
    this.cwd = ROOT;
    this.filter = '';
    this.memory = new Map();
    this.back = [];
    this.fwd = [];
  }

  // ---- internals ---------------------------------------------------------------

  private selectKey(key: string): void {
    const i = this.entries.findIndex((e) => e.key === key);
    if (i >= 0) this.remember(this.dir, key, i);
  }

  private enter(dir: string, selectKey?: string): void {
    this.cwd = dir;
    this.filter = '';
    if (selectKey) {
      const entries = this.tree.folders.get(nearestExisting(this.tree, dir)) ?? [];
      const i = entries.findIndex((e) => e.key === selectKey);
      if (i >= 0) this.remember(dir, selectKey, i);
    }
  }

  private here(): Loc {
    return { dir: this.dir, key: this.current?.key ?? null };
  }

  private pushBack(): void {
    const here = this.here();
    const last = this.back.at(-1);
    if (last && last.dir === here.dir && last.key === here.key) return;
    this.back = capped([...this.back, here]);
  }

  private remember(dir: string, key: string | null, index: number): void {
    const prev = this.memory.get(dir);
    if (prev && prev.key === key && prev.index === index) return;
    const next = new Map(this.memory);
    next.set(dir, { key, index });
    this.memory = next;
  }

  /** Remembered key if still visible, else the remembered index
   *  clamped (the row that took its place), else 0. */
  private resolveCursor(dir: string, entries: readonly Entry[]): number {
    if (entries.length === 0) return -1;
    const m = this.memory.get(dir);
    if (!m) return 0;
    if (m.key != null) {
      // Fast path: the row is usually still where we left it.
      if (entries[m.index]?.key === m.key) return m.index;
      const i = entries.findIndex((e) => e.key === m.key);
      if (i >= 0) return i;
    }
    return Math.max(0, Math.min(entries.length - 1, m.index));
  }
}

function capped(stack: Loc[]): Loc[] {
  return stack.length > HISTORY_CAP ? stack.slice(stack.length - HISTORY_CAP) : stack;
}
