// Books registry model (SPEC-LIVROS §2.3/§2.4) — pure functions.
//
// Web rows have the books.yaml shape minus `path` and only
// `kind: bound` (no local books on the web in this version). Book id =
// vault_id: on the web every book is born from a server vault, and
// §2.4 guarantees at most one bound book per vault_id, so the id is
// stable and unique without inventing a local UUID.

import type { Vault } from './types.ts';

export interface Book {
  id: string;
  name: string;
  kind: 'bound';
  server_url: string;
  account: string; // username
  vault_id: string;
  sort: number;
  added_at: string;
  last_opened_at: string | null;
}

export interface Alternate {
  server_url: string;
  account: string;
  federation_role: 'home' | 'follower' | 'mirror' | null;
}

export interface AccountVaults {
  server_url: string;
  username: string;
  added_at: string;
  vaults: Vault[];
}

export interface DedupeNotice {
  vault_id: string;
  bound: string; // server_url the book syncs through
  others: string[]; // other server_urls carrying the same vault_id
}

export interface ReconcileResult {
  books: Book[];
  /** vault_id → other (server, account) pairs where it is reachable. */
  alternates: Record<string, Alternate[]>;
  /** Newly created books, grouped by server (for "N livros adicionados"). */
  added: Array<{ server_url: string; count: number }>;
  dedupe: DedupeNotice[];
  /** Book ids bound to an account that answered but no longer lists
   *  the vault (treated like `vault.revoked{removed}`). */
  missing: string[];
}

export const SORT_STEP = 10;

export function accountKey(serverUrl: string, username: string): string {
  return `${serverUrl}#${username}`;
}

export function bookAccountKey(b: Pick<Book, 'server_url' | 'account'>): string {
  return accountKey(b.server_url, b.account);
}

/** Selector / shortcut order: `sort`, then `id` (§2.3). */
export function sortBooks(books: readonly Book[]): Book[] {
  return [...books].sort((a, b) => a.sort - b.sort || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function fedRole(v: Vault): 'home' | 'follower' | 'mirror' | null {
  return v.federation?.role ?? null;
}

/**
 * Merge every account's GET /api/vaults into the registry (§2.4):
 *  1. at most one bound book per vault_id;
 *  2. a vault_id seen through one account only becomes a book silently;
 *  3. seen through several → bind to the account whose server reports
 *     `federation.role = "home"`; otherwise the oldest account;
 *  4. the rest become in-memory `alternates` (no feed of their own);
 *  existing bindings are never moved implicitly ("Trocar servidor" is
 *  an explicit user action).
 *
 * `sources` only contains accounts that answered; a book whose account
 * did not answer (offline, needs login) is kept untouched.
 */
export function reconcileBooks(
  existing: readonly Book[],
  sources: readonly AccountVaults[],
  now: string,
): ReconcileResult {
  const books = existing.map((b) => ({ ...b }));
  const byVault = new Map(books.map((b) => [b.vault_id, b]));

  // vault_id → candidates in deterministic order (oldest account first).
  const ordered = [...sources].sort(
    (a, b) =>
      a.added_at.localeCompare(b.added_at) ||
      accountKey(a.server_url, a.username).localeCompare(accountKey(b.server_url, b.username)),
  );
  const candidates = new Map<string, Array<{ src: AccountVaults; vault: Vault }>>();
  for (const src of ordered) {
    for (const v of src.vaults) {
      let list = candidates.get(v.id);
      if (!list) candidates.set(v.id, (list = []));
      if (!list.some((c) => c.src === src)) list.push({ src, vault: v });
    }
  }

  const alternates: Record<string, Alternate[]> = {};
  const dedupe: DedupeNotice[] = [];
  const created: Book[] = [];
  let maxSort = books.reduce((m, b) => Math.max(m, b.sort), 0);

  for (const [vaultID, cands] of candidates) {
    let book = byVault.get(vaultID);
    let boundCand = book
      ? cands.find((c) => c.src.server_url === book!.server_url && c.src.username === book!.account)
      : undefined;
    if (!book) {
      boundCand = cands.find((c) => fedRole(c.vault) === 'home') ?? cands[0];
      book = {
        id: vaultID,
        name: boundCand.vault.name,
        kind: 'bound',
        server_url: boundCand.src.server_url,
        account: boundCand.src.username,
        vault_id: vaultID,
        sort: 0, // assigned below
        added_at: now,
        last_opened_at: null,
      };
      created.push(book);
      byVault.set(vaultID, book);
      books.push(book);
      if (cands.length > 1) {
        const others = [...new Set(cands.filter((c) => c !== boundCand).map((c) => c.src.server_url))]
          .filter((u) => u !== book!.server_url);
        dedupe.push({ vault_id: vaultID, bound: book.server_url, others });
      }
    }
    if (boundCand) book.name = boundCand.vault.name; // name = cache of server name
    const alts = cands
      .filter((c) => c !== boundCand && !(c.src.server_url === book!.server_url && c.src.username === book!.account))
      .map((c) => ({ server_url: c.src.server_url, account: c.src.username, federation_role: fedRole(c.vault) }));
    if (alts.length > 0) alternates[vaultID] = alts;
  }

  // New books: appended after existing ones, ordered by name (§2.5).
  created.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  for (const b of created) {
    maxSort += SORT_STEP;
    b.sort = maxSort;
  }

  const answered = new Set(sources.map((s) => accountKey(s.server_url, s.username)));
  const missing = books
    .filter((b) => answered.has(bookAccountKey(b)) && !candidatesHas(candidates, b))
    .map((b) => b.id);

  const addedMap = new Map<string, number>();
  for (const b of created) addedMap.set(b.server_url, (addedMap.get(b.server_url) ?? 0) + 1);

  return {
    books: sortBooks(books),
    alternates,
    added: [...addedMap].map(([server_url, count]) => ({ server_url, count })),
    dedupe,
    missing,
  };
}

function candidatesHas(
  candidates: Map<string, Array<{ src: AccountVaults }>>,
  b: Book,
): boolean {
  return (candidates.get(b.vault_id) ?? []).some(
    (c) => c.src.server_url === b.server_url && c.src.username === b.account,
  );
}

/** "Trocar servidor" (§2.4.5): rebind to an alternate. Cursor reset and
 *  list-cache drop are the caller's job (seq is per server). */
export function switchBinding(book: Book, alt: Alternate): Book {
  return { ...book, server_url: alt.server_url, account: alt.account };
}

/** Active book fallback (§2.3): missing/removed → lowest sort. */
export function resolveActive(books: readonly Book[], wanted: string | null): Book | null {
  if (wanted) {
    const hit = books.find((b) => b.id === wanted);
    if (hit) return hit;
  }
  return sortBooks(books)[0] ?? null;
}

/** Order of rows in the selector: grouped by server (servers in order
 *  of their lowest-sorted book), `sort` within a group. Shortcuts use
 *  this same order so the number shown on a row is the one that opens
 *  it. With a single server it is exactly `sort` order. */
export function selectorOrder(books: readonly Book[]): Book[] {
  return groupByServer(books).flatMap((g) => g.books);
}

/** Book for shortcut g1–g9 / ⌃⌘1–9 (1-based, selector order). */
export function bookForShortcut(books: readonly Book[], n: number): Book | null {
  if (!Number.isInteger(n) || n < 1 || n > 9) return null;
  return selectorOrder(books)[n - 1] ?? null;
}

/** Group for the selector: by server, servers in first-appearance
 *  order of the sorted list. */
export function groupByServer(books: readonly Book[]): Array<{ server_url: string; books: Book[] }> {
  const out: Array<{ server_url: string; books: Book[] }> = [];
  for (const b of sortBooks(books)) {
    let g = out.find((x) => x.server_url === b.server_url);
    if (!g) out.push((g = { server_url: b.server_url, books: [] }));
    g.books.push(b);
  }
  return out;
}
