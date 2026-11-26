// Helpers for the explorer's books level (accounts → books).

import { notes } from '../../lib/notes.svelte.ts';
import { books } from '../../lib/books.svelte.ts';
import { sync } from '../../lib/sync.svelte.ts';
import { accounts } from '../../lib/accounts.svelte.ts';
import { noteCountOf } from '../../lib/book-counts.ts';

/** Notes in a book: live for the open one, last known for the rest. */
export function noteCount(b: { id: string; vault_id: string }): number | null {
  return b.id === books.activeID && notes.list.length ? notes.list.length : noteCountOf(b.vault_id);
}

export function accountOf(key: string) {
  return accounts.list.find((a) => a.key === key) ?? null;
}

/** A stable hue slot per account (avatar tint). */
export function avatarSlot(key: string): number {
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 4;
}

export const statusOf = (b: (typeof books.list)[number]) => sync.statusOf(b);
