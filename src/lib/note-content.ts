// Note bodies for surfaces other than the main reader: secondary panes,
// the hover card and the floating explorer's preview.
//
// Same sources as the notes store: the server's /content, and offline
// the note's persisted replica (read-only, marked stale). A small LRU
// keyed by (vault, note, updated_at) keeps hovering and walking the
// floating explorer instant; a newer `updated_at` (live feed) misses
// the cache, so a card never shows an outdated body for long.

import * as api from './api.ts';
import { isNetworkError } from './api.ts';
import { notes } from './notes.svelte.ts';
import { ApiError, type NoteContent } from './types.ts';

export interface LoadedNote {
  content: NoteContent;
  /** From the local replica (offline). */
  stale: boolean;
}

const CAP = 40;
const cache = new Map<string, LoadedNote>();

function cacheKey(vaultID: string, noteID: string): string {
  const meta = notes.vaultID === vaultID ? notes.list.find((n) => n.id === noteID) : undefined;
  return `${vaultID}\u0000${noteID}\u0000${meta?.updated_at ?? ''}`;
}

/** Cached body, if any (synchronous, for an instant first paint). */
export function peekNote(vaultID: string, noteID: string): LoadedNote | null {
  return cache.get(cacheKey(vaultID, noteID)) ?? null;
}

export function forgetNotes(): void {
  cache.clear();
}

/** Load a note body; throws an Error with a user-facing message. */
export async function loadNote(vaultID: string, noteID: string, signal?: AbortSignal): Promise<LoadedNote> {
  const k = cacheKey(vaultID, noteID);
  const hit = cache.get(k);
  if (hit && !hit.stale) {
    cache.delete(k);
    cache.set(k, hit);
    return hit;
  }
  // The note open in the main reader is already loaded.
  if (notes.vaultID === vaultID && notes.content?.id === noteID && !notes.contentStale) {
    return remember(k, { content: notes.content, stale: false });
  }
  try {
    const content = await api.getNoteContent(vaultID, noteID, signal);
    return remember(k, { content, stale: false });
  } catch (e) {
    if (isNetworkError(e)) {
      const text = await notes.offlineHooks?.replicaText(vaultID, noteID).catch(() => null);
      if (text != null) {
        const meta = notes.list.find((n) => n.id === noteID);
        return { content: { id: noteID, vault_id: vaultID, path: meta?.path ?? `${noteID}.md`, frontmatter: {}, body: text }, stale: true };
      }
      throw new Error('Offline — no local copy of this note on this device.');
    }
    if (e instanceof ApiError) throw new Error(e.detail ?? e.code);
    throw e;
  }
}

function remember(k: string, v: LoadedNote): LoadedNote {
  cache.delete(k);
  cache.set(k, v);
  while (cache.size > CAP) cache.delete(cache.keys().next().value as string);
  return v;
}
