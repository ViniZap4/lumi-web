// What a book shows when it opens (SPEC-PARTE2 §2, owner decision
// 2026-11-24): the floating explorer is the only navigation, so the
// book itself has no browse screen. It opens on the note last opened
// in it on this device; with none (or it is gone) a calm empty home
// shows — book name, recent notes, sync state — with the floating
// explorer opened on top.
//
// Pure + storage helpers; the view decides when to call them.

import type { NoteSummary } from './types.ts';

/** localStorage key prefix: last opened note per book, per device. */
export const LAST_NOTE_KEY = 'lumi.lastNote.v1:';

export function rememberLastNote(vaultID: string, noteID: string | null, store: Storage | null = safeStorage()): void {
  if (!store || !vaultID) return;
  try {
    if (noteID) store.setItem(LAST_NOTE_KEY + vaultID, noteID);
    else store.removeItem(LAST_NOTE_KEY + vaultID);
  } catch {
    /* storage full / blocked: the book simply opens on its home */
  }
}

export function lastNote(vaultID: string, store: Storage | null = safeStorage()): string | null {
  if (!store || !vaultID) return null;
  try {
    const v = store.getItem(LAST_NOTE_KEY + vaultID);
    return v && v.length <= 512 ? v : null;
  } catch {
    return null;
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export type BookOpening =
  /** Open this note (the last one, or the saved split layout's). */
  | { kind: 'note'; note: string; source: 'layout' | 'last' }
  /** The empty home; `explore` = open the floating explorer on top. */
  | { kind: 'home'; explore: boolean };

export interface BookOpenInput {
  /** Notes of the book (the loaded list). */
  notes: readonly Pick<NoteSummary, 'id'>[];
  /** The note a restored split layout puts in its primary pane. */
  layoutNote?: string | null;
  /** The last note opened in this book on this device. */
  last?: string | null;
}

/** Decide what a freshly opened book shows. A saved split layout wins
 *  (it already names its notes), then the last note; a note that no
 *  longer exists falls back to the home with the explorer open. */
export function planBookOpen(x: BookOpenInput): BookOpening {
  const has = (id: string | null | undefined): id is string => !!id && x.notes.some((n) => n.id === id);
  if (has(x.layoutNote)) return { kind: 'note', note: x.layoutNote, source: 'layout' };
  if (has(x.last)) return { kind: 'note', note: x.last, source: 'last' };
  return { kind: 'home', explore: true };
}

/** The home's "recent notes": most recently updated first. */
export function recentNotes<T extends Pick<NoteSummary, 'id' | 'updated_at'>>(list: readonly T[], n = 8): T[] {
  if (n <= 0) return [];
  // Partial selection keeps this O(len · n) for 10k-note books.
  const out: T[] = [];
  for (const it of list) {
    if (out.length === n && it.updated_at <= out[n - 1].updated_at) continue;
    let i = out.length;
    while (i > 0 && out[i - 1].updated_at < it.updated_at) i--;
    out.splice(i, 0, it);
    if (out.length > n) out.pop();
  }
  return out;
}

/** Notes opened in this pane, for `H` / `L` (back / forward). Capped,
 *  de-duplicated against the current entry, pruned of deleted notes. */
export class NoteHistory {
  private back: string[] = [];
  private fwd: string[] = [];
  current: string | null = null;

  constructor(private cap = 50) {}

  /** A note was opened (not through back / forward). */
  visit(id: string): void {
    if (id === this.current) return;
    if (this.current) this.back.push(this.current);
    if (this.back.length > this.cap) this.back.shift();
    this.fwd = [];
    this.current = id;
  }

  goBack(): string | null {
    const id = this.back.pop();
    if (!id) return null;
    if (this.current) this.fwd.push(this.current);
    this.current = id;
    return id;
  }

  goForward(): string | null {
    const id = this.fwd.pop();
    if (!id) return null;
    if (this.current) this.back.push(this.current);
    this.current = id;
    return id;
  }

  /** Drop notes that no longer exist. */
  prune(alive: (id: string) => boolean): void {
    this.back = this.back.filter(alive).filter((id, i, a) => i === 0 || a[i - 1] !== id);
    this.fwd = this.fwd.filter(alive);
    if (this.current && !alive(this.current)) this.current = null;
  }

  reset(): void {
    this.back = [];
    this.fwd = [];
    this.current = null;
  }

  get canBack(): boolean {
    return this.back.length > 0;
  }
  get canForward(): boolean {
    return this.fwd.length > 0;
  }
}
