// Books level of the floating explorer (SPEC-PARTE2 §2): switching
// books is floating too. The overlay's columns walk accounts → books
// the way they walk folders → notes: `h` from the book root climbs to
// the books of the current account, `h` again to the accounts; `l` /
// Enter goes down (an account shows its books, a book opens).
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
  const len = c.level === 'accounts' ? groups.length : (acc?.books.length ?? 0);
  const idx = c.level === 'accounts' ? c.account : c.book;
  const at = (i: number): BooksCursor =>
    c.level === 'accounts' ? { ...c, account: clamp(i, len), book: 0 } : { ...c, book: clamp(i, len) };
  switch (k.kind) {
    case 'move': return { cursor: at(idx + k.n), open: null };
    case 'top': return { cursor: at(0), open: null };
    case 'bottom': return { cursor: at(len - 1), open: null };
    case 'parent':
      return { cursor: c.level === 'books' && groups.length > 0 ? { ...c, level: 'accounts' } : c, open: null };
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
