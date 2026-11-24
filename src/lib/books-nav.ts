// Books level of the floating explorer (SPEC-PARTE2 §2): switching
// books is floating too. It is a *scope*, not a folder (owner,
// 2026-11-25: "os dois aparecem como book… confunde como se fosse uma
// pasta pai"):
// - "Livros": ONE list of every book, grouped under account section
//   headers (headers are not rows: the cursor skips them). j/k cross
//   account groups.
// - "Contas e servidores": a separate layer only when there are many
//   accounts (≥ ACCOUNTS_LAYER_MIN); `h` on Livros climbs to it, `l` /
//   Enter on an account jumps to its first book. With fewer accounts
//   the layer does not exist and `h` stays on Livros.
//
// Pure: the component keeps `BooksCursor` in $state and renders the
// columns derived here.

import { bookAccountKey, selectorOrder, type Book } from './books-model.ts';

export interface AccountGroup {
  /** accountKey(server_url, account). */
  key: string;
  server_url: string;
  account: string;
  books: Book[];
}

/** Accounts in selector order (each account where its first book
 *  appears), books in selector order inside — so the g1–g9 numbers
 *  shown on rows are the ones that open them. */
export function accountGroups(books: readonly Book[]): AccountGroup[] {
  const out: AccountGroup[] = [];
  for (const b of selectorOrder(books)) {
    const key = bookAccountKey(b);
    let g = out.find((x) => x.key === key);
    if (!g) out.push((g = { key, server_url: b.server_url, account: b.account, books: [] }));
    g.books.push(b);
  }
  return out;
}

/** Below this many accounts the grouped Livros list is enough. */
export const ACCOUNTS_LAYER_MIN = 3;

export function hasAccountsLayer(groups: readonly AccountGroup[]): boolean {
  return groups.length >= ACCOUNTS_LAYER_MIN;
}

/** Flat index of the cursor's book across all groups. */
export function flatIndex(groups: readonly AccountGroup[], c: Pick<BooksCursor, 'account' | 'book'>): number {
  let n = 0;
  for (let a = 0; a < c.account && a < groups.length; a++) n += groups[a].books.length;
  return n + c.book;
}

/** Cursor at flat book index `i` (clamped). */
export function fromFlat(groups: readonly AccountGroup[], i: number): BooksCursor {
  const total = groups.reduce((s, g) => s + g.books.length, 0);
  let r = clamp(i, total);
  for (let a = 0; a < groups.length; a++) {
    if (r < groups[a].books.length) return { level: 'books', account: a, book: r };
    r -= groups[a].books.length;
  }
  return { level: 'books', account: 0, book: 0 };
}

/** pt-BR count: 1 livro, 2 livros, 0 livros. */
export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export interface BooksCursor {
  /** Which list is the current (keyboard) column. */
  level: 'accounts' | 'books';
  account: number;
  book: number;
}

/** Cursor on `bookID` (its account, its row); first book otherwise. */
export function cursorAt(groups: readonly AccountGroup[], bookID: string | null): BooksCursor {
  for (let a = 0; a < groups.length; a++) {
    const i = groups[a].books.findIndex((b) => b.id === bookID);
    if (i >= 0) return { level: 'books', account: a, book: i };
  }
  return { level: 'books', account: 0, book: 0 };
}

export type BooksKey =
  | { kind: 'move'; n: number }
  | { kind: 'top' }
  | { kind: 'bottom' }
  | { kind: 'parent' }
  | { kind: 'open' };

export type BooksStep = { cursor: BooksCursor; open: Book | null };

function clamp(i: number, n: number): number {
  return n <= 0 ? 0 : Math.max(0, Math.min(n - 1, i));
}

/** One key on the books level. `open` is the book to switch to. */
export function booksStep(groups: readonly AccountGroup[], c: BooksCursor, k: BooksKey): BooksStep {
  const acc = groups[clamp(c.account, groups.length)];
  const total = groups.reduce((s, g) => s + g.books.length, 0);
  const len = c.level === 'accounts' ? groups.length : total;
  const idx = c.level === 'accounts' ? c.account : flatIndex(groups, c);
  const at = (i: number): BooksCursor =>
    c.level === 'accounts' ? { ...c, account: clamp(i, len), book: 0 } : fromFlat(groups, i);
  switch (k.kind) {
    case 'move': return { cursor: at(idx + k.n), open: null };
    case 'top': return { cursor: at(0), open: null };
    case 'bottom': return { cursor: at(len - 1), open: null };
    case 'parent':
      return { cursor: c.level === 'books' && hasAccountsLayer(groups) ? { ...c, level: 'accounts' } : c, open: null };
    case 'open':
      if (c.level === 'accounts') return { cursor: acc ? { level: 'books', account: c.account, book: 0 } : c, open: null };
      return { cursor: c, open: acc?.books[clamp(c.book, acc.books.length)] ?? null };
  }
}

/** The book under the cursor (books level), else null. */
export function bookAt(groups: readonly AccountGroup[], c: BooksCursor): Book | null {
  if (c.level !== 'books') return null;
  return groups[c.account]?.books[c.book] ?? null;
}
