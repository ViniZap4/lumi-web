// The floating explorer (SPEC-PARTE2 §2) — the only navigation — and
// the file operations it runs (create, rename/move, delete, paste,
// drag a note onto a folder).

import { tick } from 'svelte';
import { vaults } from '../../lib/vaults.svelte.ts';
import { notes } from '../../lib/notes.svelte.ts';
import { books } from '../../lib/books.svelte.ts';
import * as api from '../../lib/api.ts';
import { ApiError } from '../../lib/types.ts';
import { rememberLastNote } from '../../lib/book-home.ts';
import { noteViewKind } from '../../lib/note-kind.ts';
import { dirOf, normalizePath, type Entry } from '../../lib/notetree.ts';
import { movedPath, copyTitle, noteCreateInput } from '../../lib/fileops.ts';
import { findLeaf } from '../../lib/pane-tree.ts';
import type { MillerNav } from '../../lib/miller.svelte.ts';
import type { ShellAction } from '../../lib/shell-keymap.ts';
import type { OpenWhere } from '../../lib/link-open.ts';
import type { FxOps, FxPrompt, FxPlan, FxLevel, FxInitial } from '../../components/explorer/fx-types.ts';
import type { Workspace } from './workspace.svelte.ts';

export const OFFLINE_HINT = 'Indisponível offline: criar, renomear e apagar notas precisam do servidor.';

export type FxState = { startNote: string | null; startDir: string; level: FxLevel; initial: FxInitial; key: number };
export type FxOpen = { level?: FxLevel; initial?: FxInitial; root?: boolean; dir?: string; auto?: boolean };

export function errText(e: unknown): string {
  return e instanceof ApiError ? (e.detail ?? e.code) : (e as Error).message;
}

export class ExplorerController {
  fx = $state<FxState | null>(null);
  /** The overlay's level as it walks (h at the book root → books). */
  level = $state<FxLevel>('files');
  yanked = $state<Entry | null>(null);
  /** Transient hint for actions that need the network. */
  offlineHint = $state<string | null>(null);
  /** Folder the explorer last showed (it reopens there with no note). */
  private dir = '';
  private key = 0;
  private leaf: string | null = null;
  private hintTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly ws: Workspace) {}

  /** The book changed: forget the overlay and the yank. */
  reset(): void {
    this.fx = null;
    this.dir = '';
    this.yanked = null;
  }

  destroy(): void {
    if (this.hintTimer) clearTimeout(this.hintTimer);
  }

  /** Open the floating explorer: at the open note's folder, the last
   *  folder it showed, or the book root (`root`); at the books level
   *  with `level: 'books'`; running `initial` (a prompt) once open. */
  open = (o: FxOpen = {}): void => {
    const ws = this.ws;
    ws.hover.intent.hide();
    this.leaf = ws.panes.activeLeafId;
    const t = ws.panes.state;
    const l = t ? findLeaf(t.root, ws.panes.activeLeafId) : null;
    const note = o.root || o.dir != null || ws.pane !== 'note' ? null : (l?.note ?? notes.selectedID);
    this.level = o.level ?? 'files';
    this.fx = { startNote: note, startDir: o.root ? '' : (o.dir ?? this.dir), level: this.level, initial: o.initial ?? null, key: ++this.key };
  };

  /** `gb`, the book button, palette "Switch book": books level. */
  openBooks = (): void => {
    this.open({ level: 'books' });
  };

  close = (dir?: string): void => {
    if (dir != null) this.dir = dir;
    this.fx = null;
    this.level = 'files';
    // Focus returns to the note, or to the home.
    void tick().then(() => {
      const a = document.activeElement;
      if (a && a !== document.body && this.ws.rootEl?.contains(a)) return;
      if (this.ws.pane === 'note') this.ws.panes.focusLeaf(this.ws.panes.activeLeafId);
      else this.ws.homeEl?.focus({ preventScroll: true });
    });
  };

  /** A row was opened (Enter / Ctrl-v / Ctrl-s / click). */
  openNote = (id: string, where: OpenWhere, from?: HTMLElement | null): void => {
    const leaf = this.leaf ?? this.ws.panes.activeLeafId;
    const d = notes.list.find((n) => n.id === id);
    if (d) this.dir = dirOf(d.path);
    this.ws.openIn(id, where, leaf, { from, closeFx: true });
  };

  /** An app key typed inside the overlay (palette, help, …). */
  app = (a: ShellAction): void => {
    this.close();
    this.ws.cmd.runAction(a);
  };

  /** Top-bar crumb `i`: the explorer at that folder. */
  exploreCrumb(i: number): void {
    this.open({ dir: this.ws.noteCrumbs.slice(0, i + 1).join('/') });
  }

  // ---- prompts that need the network ----------------------------------------

  showOfflineHint(): void {
    this.offlineHint = OFFLINE_HINT;
    if (this.hintTimer) clearTimeout(this.hintTimer);
    this.hintTimer = setTimeout(() => (this.offlineHint = null), 4000);
  }

  private prompt(initial: FxInitial): void {
    if (this.ws.structuralOffline) return this.showOfflineHint();
    this.open({ initial });
  }

  beginCreate = (): void => this.prompt('create');
  /** `a` prompt prefilled with `.canvas` (POST kind:"canvas"). */
  beginCreateCanvas = (): void => this.prompt('createCanvas');
  beginRename = (): void => this.prompt('rename');
  beginDelete = (): void => this.prompt('delete');
  beginNewFolder = (): void => this.prompt('newFolder');

  // ---- file operations ------------------------------------------------------

  readonly ops: FxOps = {
    offline: () => this.ws.structuralOffline,
    run: (p, plan, n) => this.runPlan(p, plan, n),
    remove: async (entry) => {
      if (entry.kind !== 'note') return;
      const ws = this.ws;
      const wasOpen = ws.pane === 'note' && notes.selectedID === entry.note.id;
      if (ws.panes.multi && wasOpen) ws.panes.closeLeaf(ws.panes.primaryLeaf);
      const vid = vaults.selectedID;
      if (!vid) return;
      if (notes.selectedID === entry.note.id) await notes.deleteSelected();
      else {
        await api.deleteNote(vid, entry.note.id);
        await notes.refresh();
      }
      if (wasOpen) rememberLastNote(vid, null);
    },
    paste: async (src, n) => {
      if (src.kind !== 'note') return;
      if (this.ws.structuralOffline) throw new Error(OFFLINE_HINT);
      const vid = vaults.selectedID;
      if (!vid) return;
      const c = await api.getNoteContent(vid, src.note.id);
      const taken = new Set(notes.list.map((x) => x.title));
      const isCanvas = noteViewKind({ path: src.note.path, kind: src.note.kind ?? c.kind }) === 'canvas';
      await this.createNoteIn(n, copyTitle(src.note.title ?? src.name, taken), n.dir, c.body ?? '', isCanvas ? 'canvas' : undefined);
    },
    move: async (key, folder) => {
      const note = notes.list.find((n) => 'n:' + n.id === key);
      if (!note) return null;
      const file = normalizePath(note.path || note.id + '.md').split('/').pop()!;
      const path = `${folder.path}/${file}`;
      if (normalizePath(note.path) === path) return null;
      const updated = await notes.patch(note.id, { path });
      return updated ? `moved ${file} → ${folder.path}/` : null;
    },
    copyLink: (e) => this.ws.copyLinkTo(e, this.ws.pane === 'note' ? (notes.selected?.path ?? '') : ''),
    refresh: () => void notes.refresh(),
  };

  /** Run a create / rename / move plan against the explorer's state `n`. */
  async runPlan(p: FxPrompt, plan: FxPlan, n: MillerNav): Promise<void> {
    if (plan.kind === 'error') throw new Error(plan.message);
    if (plan.kind === 'none') return;
    try {
      if (plan.kind === 'folder' && 'path' in plan) {
        n.addFolder(plan.path);
        n.goTo(plan.path);
        this.ws.flash(`folder ${plan.path}/ — create a note in it to keep it (a)`);
      } else if (plan.kind === 'folder') {
        await this.moveFolder(plan.from, plan.to, n);
      } else if (plan.kind === 'note' && 'folder' in plan) {
        await this.createNoteIn(n, plan.title, plan.folder, '', plan.noteKind);
      } else if (plan.kind === 'note' && p.kind === 'rename' && p.entry.kind === 'note') {
        const input: { title?: string; path?: string } = {};
        if (plan.title) input.title = plan.title;
        if (plan.path) input.path = plan.path;
        const updated = await notes.patch(p.entry.note.id, input);
        if (updated && plan.path) {
          n.reveal(updated.id);
          this.ws.flash(`moved to ${updated.path}`);
        }
      }
    } catch (e) {
      throw new Error(errText(e));
    }
  }

  /** POST (always at the book root), then PATCH the path into `folder`. */
  private async createNoteIn(n: MillerNav, title: string, folder: string, body = '', kind?: 'canvas'): Promise<void> {
    const created = await notes.create(noteCreateInput(title, body, kind));
    if (!created) return;
    let final = created;
    if (folder) {
      const file = normalizePath(created.path || created.id + '.md').split('/').pop()!;
      final = (await notes.patch(created.id, { path: `${folder}/${file}` })) ?? created;
      n.removeFolder(folder); // real now
    }
    n.reveal(final.id);
  }

  private async moveFolder(from: string, to: string, ex: MillerNav): Promise<void> {
    if (ex.extraDirs.has(from) && !notes.list.some((n) => movedPath(n.path, from, to))) {
      ex.removeFolder(from);
      ex.addFolder(to);
      ex.goTo(dirOf(to), 'd:' + to);
      return;
    }
    const moves = notes.list
      .map((n) => ({ n, path: movedPath(n.path || n.id + '.md', from, to) }))
      .filter((m): m is { n: (typeof notes.list)[number]; path: string } => m.path != null);
    let done = 0;
    for (const m of moves) {
      this.ws.flash(`moving ${++done}/${moves.length}…`);
      await notes.patch(m.n.id, { path: m.path });
    }
    ex.goTo(dirOf(to), 'd:' + to);
    this.ws.flash(`moved ${moves.length} ${moves.length === 1 ? 'note' : 'notes'} to ${to}/`);
  }

  /** The overlay picked another book. */
  pickBook = (id: string): void => {
    this.fx = null;
    books.setActive(id);
  };
}
