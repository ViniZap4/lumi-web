import { describe, it, expect } from 'vitest';
import { accountGroups, cursorAt, booksStep, bookAt, flatIndex, fromFlat, hasAccountsLayer, plural } from './books-nav.ts';
import type { Book } from './books-model.ts';

const b = (id: string, server: string, account: string, sort: number): Book => ({
  id, name: id.toUpperCase(), kind: 'bound', server_url: server, account, vault_id: id, sort, added_at: '', last_opened_at: null,
});

const BOOKS = [
  b('w1', 'https://work', 'ana', 10),
  b('h1', 'https://home', 'ana', 20),
  b('w2', 'https://work', 'ana', 30),
  b('w3', 'https://work', 'bo', 40),
];

describe('accountGroups', () => {
  it('groups by account in selector order (servers grouped, sort inside)', () => {
    const g = accountGroups(BOOKS);
    expect(g.map((x) => [x.account, x.server_url, x.books.map((y) => y.id)])).toEqual([
      ['ana', 'https://work', ['w1', 'w2']],
      ['bo', 'https://work', ['w3']],
      ['ana', 'https://home', ['h1']],
    ]);
  });
});

describe('books level cursor', () => {
  const g = accountGroups(BOOKS);
  it('starts on the active book', () => {
    expect(cursorAt(g, 'w3')).toEqual({ level: 'books', account: 1, book: 0 });
    expect(cursorAt(g, 'w2')).toEqual({ level: 'books', account: 0, book: 1 });
    expect(cursorAt(g, null)).toEqual({ level: 'books', account: 0, book: 0 });
  });
  it('j/k walk ONE list across account groups (headers are skipped), clamped', () => {
    let c = cursorAt(g, 'w1');
    c = booksStep(g, c, { kind: 'move', n: 1 }).cursor;
    expect(bookAt(g, c)?.id).toBe('w2');
    c = booksStep(g, c, { kind: 'move', n: 1 }).cursor; // crosses into bo's group
    expect(bookAt(g, c)?.id).toBe('w3');
    c = booksStep(g, c, { kind: 'move', n: 9 }).cursor;
    expect(bookAt(g, c)?.id).toBe('h1');
    c = booksStep(g, c, { kind: 'top' }).cursor;
    expect(bookAt(g, c)?.id).toBe('w1');
    expect(flatIndex(g, cursorAt(g, 'h1'))).toBe(3);
    expect(fromFlat(g, 2)).toEqual({ level: 'books', account: 1, book: 0 });
  });
  it('few accounts: no accounts layer, h stays on Livros', () => {
    const two = accountGroups(BOOKS.slice(0, 3)); // ana@work, ana@home
    expect(hasAccountsLayer(two)).toBe(false);
    const c = cursorAt(two, 'w1');
    expect(booksStep(two, c, { kind: 'parent' }).cursor).toEqual(c);
    expect(hasAccountsLayer(accountGroups(BOOKS.slice(0, 1)))).toBe(false);
  });
  it('pt-BR plurals', () => {
    expect(plural(1, 'livro', 'livros')).toBe('1 livro');
    expect(plural(0, 'livro', 'livros')).toBe('0 livros');
    expect(plural(3, 'nota', 'notas')).toBe('3 notas');
  });
  it('many accounts: h climbs to Contas e servidores, l / Enter jump to the account\'s first book', () => {
    expect(hasAccountsLayer(g)).toBe(true);
    let c = cursorAt(g, 'w1');
    c = booksStep(g, c, { kind: 'parent' }).cursor;
    expect(c.level).toBe('accounts');
    expect(bookAt(g, c)).toBeNull();
    expect(booksStep(g, c, { kind: 'parent' }).cursor).toEqual(c); // top
    c = booksStep(g, c, { kind: 'bottom' }).cursor;
    expect(c.account).toBe(2);
    const down = booksStep(g, c, { kind: 'open' });
    expect(down.open).toBeNull();
    expect(down.cursor).toEqual({ level: 'books', account: 2, book: 0 });
    expect(booksStep(g, down.cursor, { kind: 'open' }).open?.id).toBe('h1');
  });
  it('no books: nothing to open', () => {
    expect(booksStep([], cursorAt([], null), { kind: 'open' }).open).toBeNull();
    expect(booksStep([], cursorAt([], null), { kind: 'parent' }).cursor.level).toBe('books');
  });
});
