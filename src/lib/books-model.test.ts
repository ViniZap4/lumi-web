import { describe, it, expect } from 'vitest';
import {
  reconcileBooks, resolveActive, bookForShortcut, switchBinding, selectorOrder,
  type AccountVaults, type Book,
} from './books-model.ts';
import type { Vault } from './types.ts';

const NOW = '2026-11-22T12:00:00Z';
const v = (id: string, name: string, role: 'home' | 'follower' | null = null): Vault => ({
  id, name, slug: name.toLowerCase(), created_by: 'u', created_at: NOW, owner_user_id: 'u',
  federation: role ? { role, home_url: 'https://lumi.work.com', status: 'active' } : null,
});
const src = (server_url: string, username: string, added_at: string, vaults: Vault[]): AccountVaults =>
  ({ server_url, username, added_at, vaults });

const WORK = 'https://lumi.work.com';
const FRIEND = 'https://notes.friend.org';

describe('reconcileBooks — dedupe of federated copies (§2.4)', () => {
  it('a vault seen through one account becomes a book silently; new books sorted by name', () => {
    const r = reconcileBooks([], [src(WORK, 'alice', '2026-01-01', [v('b', 'Zeta'), v('a', 'Alpha')])], NOW);
    expect(r.books.map((b) => [b.name, b.sort])).toEqual([['Alpha', 10], ['Zeta', 20]]);
    expect(r.books[0]).toMatchObject({ id: 'a', vault_id: 'a', kind: 'bound', server_url: WORK, account: 'alice' });
    expect(r.dedupe).toEqual([]);
    expect(r.added).toEqual([{ server_url: WORK, count: 2 }]);
  });

  it('same vault_id on home + follower → binds to the home server, follower is an alternate', () => {
    // Follower account is OLDER, home must still win.
    const r = reconcileBooks([], [
      src(FRIEND, 'alice', '2025-01-01', [v('fed', 'Trabalho', 'follower')]),
      src(WORK, 'alice', '2026-01-01', [v('fed', 'Trabalho', 'home')]),
    ], NOW);
    expect(r.books).toHaveLength(1);
    expect(r.books[0]).toMatchObject({ server_url: WORK, account: 'alice' });
    expect(r.alternates['fed']).toEqual([{ server_url: FRIEND, account: 'alice', federation_role: 'follower' }]);
    expect(r.dedupe).toEqual([{ vault_id: 'fed', bound: WORK, others: [FRIEND] }]);
  });

  it('home not among the accounts → oldest account wins', () => {
    const r = reconcileBooks([], [
      src(FRIEND, 'bob', '2026-03-01', [v('fed', 'T', 'follower')]),
      src('https://third.example', 'bob', '2026-02-01', [v('fed', 'T', 'follower')]),
    ], NOW);
    expect(r.books[0].server_url).toBe('https://third.example');
    expect(r.alternates['fed'].map((a) => a.server_url)).toEqual([FRIEND]);
  });

  it('two accounts on the SAME server see the same vault → one book, other account is alternate', () => {
    const r = reconcileBooks([], [
      src(WORK, 'alice', '2026-01-01', [v('x', 'Shared')]),
      src(WORK, 'bob', '2026-02-01', [v('x', 'Shared')]),
    ], NOW);
    expect(r.books).toHaveLength(1);
    expect(r.books[0].account).toBe('alice');
    expect(r.alternates['x']).toEqual([{ server_url: WORK, account: 'bob', federation_role: null }]);
  });

  it('never moves an existing binding implicitly, keeps sort, refreshes the cached name', () => {
    const existing: Book[] = [{
      id: 'fed', name: 'Old', kind: 'bound', server_url: FRIEND, account: 'alice', vault_id: 'fed',
      sort: 30, added_at: NOW, last_opened_at: null,
    }];
    const r = reconcileBooks(existing, [
      src(WORK, 'alice', '2026-01-01', [v('fed', 'New', 'home')]),
      src(FRIEND, 'alice', '2026-02-01', [v('fed', 'New', 'follower')]),
    ], NOW);
    expect(r.books[0]).toMatchObject({ server_url: FRIEND, sort: 30, name: 'New' });
    expect(r.alternates['fed']).toEqual([{ server_url: WORK, account: 'alice', federation_role: 'home' }]);
    expect(r.dedupe).toEqual([]);
  });

  it('a book whose account answered without the vault is reported missing; silent accounts are untouched', () => {
    const existing: Book[] = [
      { id: 'gone', name: 'G', kind: 'bound', server_url: WORK, account: 'alice', vault_id: 'gone', sort: 10, added_at: NOW, last_opened_at: null },
      { id: 'off', name: 'O', kind: 'bound', server_url: FRIEND, account: 'alice', vault_id: 'off', sort: 20, added_at: NOW, last_opened_at: null },
    ];
    const r = reconcileBooks(existing, [src(WORK, 'alice', '2026-01-01', [])], NOW);
    expect(r.missing).toEqual(['gone']);
    expect(r.books).toHaveLength(2);
  });

  it('switchBinding rebinds to an alternate', () => {
    const b: Book = { id: 'x', name: 'X', kind: 'bound', server_url: WORK, account: 'a', vault_id: 'x', sort: 10, added_at: NOW, last_opened_at: null };
    expect(switchBinding(b, { server_url: FRIEND, account: 'b', federation_role: 'follower' }))
      .toMatchObject({ server_url: FRIEND, account: 'b', vault_id: 'x', sort: 10 });
  });
});

describe('active book + shortcut order', () => {
  const mk = (id: string, sort: number, server_url = WORK): Book =>
    ({ id, name: id, kind: 'bound', server_url, account: 'a', vault_id: id, sort, added_at: NOW, last_opened_at: null });

  it('falls back to the lowest sort when missing or removed', () => {
    const books = [mk('b', 20), mk('a', 10)];
    expect(resolveActive(books, null)?.id).toBe('a');
    expect(resolveActive(books, 'deleted')?.id).toBe('a');
    expect(resolveActive(books, 'b')?.id).toBe('b');
    expect(resolveActive([], 'x')).toBeNull();
  });

  it('g1–g9 follow the selector order (sort, grouped by server)', () => {
    const books = [mk('c', 30), mk('a', 10), mk('f', 15, FRIEND), mk('b', 20)];
    expect(selectorOrder(books).map((b) => b.id)).toEqual(['a', 'b', 'c', 'f']);
    expect(bookForShortcut(books, 1)?.id).toBe('a');
    expect(bookForShortcut(books, 4)?.id).toBe('f');
    expect(bookForShortcut(books, 5)).toBeNull();
    expect(bookForShortcut(books, 0)).toBeNull();
    expect(bookForShortcut(books, 10)).toBeNull();
  });
});
