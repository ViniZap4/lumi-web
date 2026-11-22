// @vitest-environment jsdom
//
// The notes store loads EVERY note of a vault (no 200 cap) by paging
// the server's offset API (maxLimit 200).

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./api.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api.ts')>();
  return { ...actual, listNotes: vi.fn() };
});

import * as api from './api.ts';
import { notes, PAGE_SIZE } from './notes.svelte.ts';
import type { NoteSummary } from './types.ts';

const summary = (i: number): NoteSummary => ({
  id: `n${i}`, vault_id: 'v', path: `f${i % 10}/n${i}.md`, title: `Note ${i}`, created_at: '', updated_at: '',
});

function serve(total: number) {
  const all = Array.from({ length: total }, (_, i) => summary(i));
  vi.mocked(api.listNotes).mockImplementation(async (_v, o = {}) => {
    const off = o.offset ?? 0;
    const lim = Math.min(o.limit ?? 50, PAGE_SIZE);
    return { notes: all.slice(off, off + lim), limit: lim, offset: off };
  });
}

beforeEach(async () => {
  vi.mocked(api.listNotes).mockReset();
  await notes.openVault(null);
});

describe('notes store paging', () => {
  it('loads 10k notes across pages', async () => {
    serve(10_000);
    await notes.openVault('v');
    expect(notes.list).toHaveLength(10_000);
    expect(new Set(notes.list.map((n) => n.id)).size).toBe(10_000);
    // 50 full pages + the empty terminating one within the last wave.
    expect(vi.mocked(api.listNotes).mock.calls.length).toBeGreaterThanOrEqual(51);
    expect(vi.mocked(api.listNotes).mock.calls.length).toBeLessThanOrEqual(54);
    expect(notes.loadingList).toBe(false);
    expect(notes.loadingMore).toBe(false);
  });

  it('a single short page needs one request', async () => {
    serve(3);
    await notes.openVault('v');
    expect(notes.list).toHaveLength(3);
    expect(api.listNotes).toHaveBeenCalledTimes(1);
  });

  it('exact multiple of the page size stops at the first empty page', async () => {
    serve(PAGE_SIZE * 2);
    await notes.openVault('v');
    expect(notes.list).toHaveLength(PAGE_SIZE * 2);
  });

  it('drops duplicates that shifted between pages', async () => {
    const page0 = Array.from({ length: PAGE_SIZE }, (_, i) => summary(i));
    const page1 = [summary(PAGE_SIZE - 1), summary(PAGE_SIZE)];
    vi.mocked(api.listNotes).mockImplementation(async (_v, o = {}) => {
      const off = o.offset ?? 0;
      const notes = off === 0 ? page0 : off === PAGE_SIZE ? page1 : [];
      return { notes, limit: PAGE_SIZE, offset: off };
    });
    await notes.openVault('v');
    expect(notes.list).toHaveLength(PAGE_SIZE + 1);
  });
});
