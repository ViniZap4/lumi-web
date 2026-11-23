// @vitest-environment jsdom
//
// Offline navigation: the last-known note list of a book is shown
// (marked stale) when the network is down, refreshed lists are cached,
// and a note with a persisted replica previews its local text offline.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./api.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api.ts')>();
  return { ...actual, listNotes: vi.fn(), getNoteContent: vi.fn() };
});

import * as api from './api.ts';
import { notes, type NotesOfflineHooks } from './notes.svelte.ts';
import { ApiError, type NoteSummary } from './types.ts';

const n = (id: string): NoteSummary => ({ id, vault_id: 'v', path: `${id}.md`, title: id, created_at: '', updated_at: '' });
const offlineErr = () => new ApiError(0, { error: 'network_error' });

let cache: Map<string, { at: number; list: NoteSummary[] }>;
let replicas: Map<string, string>;
let fullLists: string[][];
const hooks: NotesOfflineHooks = {
  loadNotesCache: async (v) => cache.get(v) ?? null,
  saveNotesCache: async (v, list) => void cache.set(v, { at: 42, list }),
  onFullList: async (_v, list) => void fullLists.push(list.map((x) => x.id)),
  replicaText: async (v, id) => replicas.get(`${v}/${id}`) ?? null,
};

beforeEach(async () => {
  cache = new Map();
  replicas = new Map();
  fullLists = [];
  vi.mocked(api.listNotes).mockReset();
  vi.mocked(api.getNoteContent).mockReset();
  notes.offlineHooks = hooks;
  await notes.openVault(null);
});

describe('notes list cache', () => {
  it('a successful list is cached and reported as the authoritative full list', async () => {
    vi.mocked(api.listNotes).mockResolvedValue({ notes: [n('a'), n('b')], limit: 200, offset: 0 } as any);
    await notes.openVault('v');
    expect(notes.stale).toBe(false);
    expect(cache.get('v')!.list.map((x) => x.id)).toEqual(['a', 'b']);
    expect(fullLists).toEqual([['a', 'b']]);
  });

  it('offline: shows the cached list, marked stale, with no error', async () => {
    cache.set('v', { at: 1234, list: [n('a')] });
    vi.mocked(api.listNotes).mockRejectedValue(offlineErr());
    await notes.openVault('v');
    await new Promise((r) => setTimeout(r, 0));
    expect(notes.list.map((x) => x.id)).toEqual(['a']);
    expect(notes.stale).toBe(true);
    expect(notes.staleAt).toBe(1234);
    expect(notes.listError).toBeNull();
    expect(fullLists).toEqual([]); // a stale list never drops replicas
  });

  it('a fresh (even empty) list wins over the cache', async () => {
    cache.set('v', { at: 1, list: [n('old')] });
    vi.mocked(api.listNotes).mockResolvedValue({ notes: [], limit: 200, offset: 0 } as any);
    await notes.openVault('v');
    await new Promise((r) => setTimeout(r, 0));
    expect(notes.list).toEqual([]);
    expect(notes.stale).toBe(false);
  });

  it('offline without cache: the error is shown as before', async () => {
    vi.mocked(api.listNotes).mockRejectedValue(offlineErr());
    await notes.openVault('v');
    await new Promise((r) => setTimeout(r, 0));
    expect(notes.listError).not.toBeNull();
  });
});

describe('offline note preview', () => {
  beforeEach(async () => {
    vi.mocked(api.listNotes).mockResolvedValue({ notes: [n('a'), n('b')], limit: 200, offset: 0 } as any);
    await notes.openVault('v');
  });

  it('falls back to the replica text when the content request fails offline', async () => {
    replicas.set('v/a', '# local copy');
    vi.mocked(api.getNoteContent).mockRejectedValue(offlineErr());
    await notes.select('a');
    expect(notes.content?.body).toBe('# local copy');
    expect(notes.contentStale).toBe(true);
    expect(notes.contentError).toBeNull();
  });

  it('without a replica it says so instead of a raw network error', async () => {
    vi.mocked(api.getNoteContent).mockRejectedValue(offlineErr());
    await notes.select('b');
    expect(notes.content).toBeNull();
    expect(notes.contentError).toMatch(/Offline/);
  });
});
