// @vitest-environment jsdom
//
// Async race regression tests: a stale response (older request that
// resolves after a newer one, or after the user switched vault/note)
// must never overwrite newer state. Also covers the federation
// "loaded" check for vaults with zero federations.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./api.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api.ts')>();
  return {
    ...actual,
    listNotes: vi.fn(),
    getNoteContent: vi.fn(),
    updateNote: vi.fn(),
    deleteNote: vi.fn(),
    listFederations: vi.fn(),
    listFederationInvites: vi.fn(async () => []),
    listFederatedMembers: vi.fn(async () => []),
    listVaultMembers: vi.fn(),
    listVaultRoles: vi.fn(async () => []),
    listVaultInvites: vi.fn(async () => []),
  };
});

import * as api from './api.ts';
import { notes } from './notes.svelte.ts';
import { federation } from './federation.svelte.ts';
import { vaultMembers } from './vaultmembers.svelte.ts';
import type { NoteSummary, NoteContent } from './types.ts';

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const summary = (id: string): NoteSummary =>
  ({ id, vault_id: 'v', path: `${id}.md`, title: id, created_at: '', updated_at: '' }) as NoteSummary;
const content = (id: string, body: string): NoteContent =>
  ({ id, path: `${id}.md`, title: id, body, frontmatter: {} }) as unknown as NoteContent;

const listOf = (...ids: string[]) => ({ notes: ids.map(summary), limit: 200, offset: 0 });

beforeEach(async () => {
  vi.mocked(api.listNotes).mockReset();
  vi.mocked(api.getNoteContent).mockReset();
  await notes.openVault(null);
  federation.clear();
  vaultMembers.clear();
});

describe('notes store sequencing', () => {
  it('select(): a slow earlier content fetch cannot overwrite a newer selection', async () => {
    vi.mocked(api.listNotes).mockResolvedValueOnce(listOf('a', 'b'));
    await notes.openVault('v1');

    const slowA = deferred<NoteContent>();
    const fastB = deferred<NoteContent>();
    vi.mocked(api.getNoteContent)
      .mockReturnValueOnce(slowA.promise)
      .mockReturnValueOnce(fastB.promise);

    const pa = notes.select('a');
    const pb = notes.select('b');
    fastB.resolve(content('b', 'B body'));
    await pb;
    slowA.resolve(content('a', 'A body'));
    await pa;

    expect(notes.selectedID).toBe('b');
    expect(notes.content?.body).toBe('B body');
    expect(notes.loadingContent).toBe(false);
  });

  it('select() aborts the superseded request', async () => {
    vi.mocked(api.listNotes).mockResolvedValueOnce(listOf('a', 'b'));
    await notes.openVault('v1');
    let firstSignal: AbortSignal | undefined;
    vi.mocked(api.getNoteContent)
      .mockImplementationOnce((_v, _id, signal) => {
        firstSignal = signal;
        return new Promise(() => {});
      })
      .mockResolvedValueOnce(content('b', 'B'));
    void notes.select('a');
    await notes.select('b');
    expect(firstSignal?.aborted).toBe(true);
  });

  it('refresh(): an older list response cannot overwrite a newer one', async () => {
    vi.mocked(api.listNotes).mockResolvedValueOnce(listOf('a'));
    await notes.openVault('v1');

    const slow = deferred<ReturnType<typeof listOf>>();
    const fast = deferred<ReturnType<typeof listOf>>();
    vi.mocked(api.listNotes).mockReturnValueOnce(slow.promise).mockReturnValueOnce(fast.promise);
    const p1 = notes.refresh();
    const p2 = notes.refresh();
    fast.resolve(listOf('a', 'b', 'c'));
    await p2;
    slow.resolve(listOf('stale'));
    await p1;

    expect(notes.list.map((n) => n.id)).toEqual(['a', 'b', 'c']);
    expect(notes.loadingList).toBe(false);
  });

  it('openVault(): list of the previous vault never lands in the new vault', async () => {
    const v1 = deferred<ReturnType<typeof listOf>>();
    vi.mocked(api.listNotes)
      .mockReturnValueOnce(v1.promise)
      .mockResolvedValueOnce(listOf('v2-note'));
    const p1 = notes.openVault('v1');
    await notes.openVault('v2');
    v1.resolve(listOf('v1-note'));
    await p1;
    expect(notes.vaultID).toBe('v2');
    expect(notes.list.map((n) => n.id)).toEqual(['v2-note']);
  });

  it('openVault(): note content of the previous vault never lands after switching', async () => {
    vi.mocked(api.listNotes).mockResolvedValueOnce(listOf('a'));
    await notes.openVault('v1');
    const slowA = deferred<NoteContent>();
    vi.mocked(api.getNoteContent).mockReturnValueOnce(slowA.promise);
    const pa = notes.select('a');
    vi.mocked(api.listNotes).mockResolvedValueOnce(listOf('x'));
    await notes.openVault('v2');
    slowA.resolve(content('a', 'old vault body'));
    await pa;
    expect(notes.selectedID).toBeNull();
    expect(notes.content).toBeNull();
  });

  it('update(): does not clobber content when the user moved to another note', async () => {
    vi.mocked(api.listNotes).mockResolvedValueOnce(listOf('a', 'b'));
    await notes.openVault('v1');
    vi.mocked(api.getNoteContent).mockResolvedValueOnce(content('a', 'A'));
    await notes.select('a');

    const patch = deferred<NoteSummary>();
    vi.mocked(api.updateNote).mockReturnValueOnce(patch.promise);
    const pu = notes.update({ body: 'A2' });
    vi.mocked(api.getNoteContent).mockResolvedValueOnce(content('b', 'B'));
    await notes.select('b');
    patch.resolve(summary('a'));
    await pu;

    expect(notes.selectedID).toBe('b');
    expect(notes.content?.body).toBe('B');
    // No content refetch for 'a' was issued after the user left it.
    expect(vi.mocked(api.getNoteContent)).toHaveBeenCalledTimes(2);
  });
});

describe('federation store loaded check', () => {
  it('treats a vault with zero federations as loaded (no refetch on reopen)', async () => {
    vi.mocked(api.listFederations).mockResolvedValue([]);
    await federation.openVault('v1');
    await federation.openVault('v1');
    expect(vi.mocked(api.listFederations)).toHaveBeenCalledTimes(1);
  });

  it('drops a stale hydration that resolves after switching vaults', async () => {
    const slow = deferred<any[]>();
    vi.mocked(api.listFederations)
      .mockReturnValueOnce(slow.promise)
      .mockResolvedValueOnce([{ id: 'fed-v2' }] as any);
    const p1 = federation.openVault('v1');
    await federation.openVault('v2');
    slow.resolve([{ id: 'fed-v1' }]);
    await p1;
    expect(federation.vaultID).toBe('v2');
    expect(federation.federations.map((f) => f.id)).toEqual(['fed-v2']);
    expect(federation.loading).toBe(false);
  });

  it('clear() during hydration discards the late response', async () => {
    const slow = deferred<any[]>();
    vi.mocked(api.listFederations).mockReturnValueOnce(slow.promise);
    const p = federation.openVault('v1');
    federation.clear();
    slow.resolve([{ id: 'late' }]);
    await p;
    expect(federation.federations).toEqual([]);
    expect(federation.vaultID).toBeNull();
  });
});

describe('vault members store sequencing', () => {
  it('drops a stale hydration that resolves after switching vaults', async () => {
    const slow = deferred<any[]>();
    vi.mocked(api.listVaultMembers)
      .mockReturnValueOnce(slow.promise)
      .mockResolvedValueOnce([{ user_id: 'u-v2' }] as any);
    const p1 = vaultMembers.openVault('v1');
    await vaultMembers.openVault('v2');
    slow.resolve([{ user_id: 'u-v1' }]);
    await p1;
    expect(vaultMembers.members.map((m) => m.user_id)).toEqual(['u-v2']);
    expect(vaultMembers.loading).toBe(false);
  });
});
