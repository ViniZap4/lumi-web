// crdt_epoch lineage plumbing: epoch normalisation, the replica probe
// (full = /snapshot + metadata, ack = /state-vector only) and the
// api.ts /state-vector → /snapshot fallback for older servers.

import { describe, it, expect, vi } from 'vitest';
import { checkLineage, makeServerProbe, normEpoch } from './lineage.ts';
import { createClient } from './api.ts';
import { ApiError } from './types.ts';

const sv = (o: Record<number, number>) => new Map(Object.entries(o).map(([k, v]) => [Number(k), v]));

describe('normEpoch', () => {
  it('keeps non-empty strings only', () => {
    expect(normEpoch('ab12')).toBe('ab12');
    expect(normEpoch('')).toBeNull();
    expect(normEpoch(null)).toBeNull();
    expect(normEpoch(undefined)).toBeNull();
    expect(normEpoch(42)).toBeNull();
  });
});

describe('checkLineage with crdt_epoch', () => {
  it('equal epochs pass even when the state vector would say otherwise', () => {
    // Server vector behind a server-origin client: would be 'history'.
    const local = { stamp: { epoch: 'e1', createdAt: 't1' }, sv: sv({ 100: 9 }), localClients: new Set<number>() };
    expect(checkLineage(local, { stamp: { epoch: 'e1', createdAt: 't2' }, sv: sv({}) })).toEqual({ ok: true, basis: 'epoch' });
  });

  it('different epochs fail even when the state vector dominates', () => {
    const local = { stamp: { epoch: 'e1', createdAt: 't1' }, sv: sv({ 100: 9 }), localClients: new Set<number>() };
    expect(checkLineage(local, { stamp: { epoch: 'e2', createdAt: 't1' }, sv: sv({ 100: 50 }) })).toEqual({ ok: false, reason: 'epoch' });
  });

  it('falls back when either side lacks an epoch (old server / pre-epoch replica)', () => {
    const local = { stamp: { createdAt: 't1' }, sv: sv({ 100: 9 }), localClients: new Set<number>() };
    expect(checkLineage(local, { stamp: { epoch: 'e2' }, sv: sv({ 100: 9 }) })).toEqual({ ok: true, basis: 'state-vector' });
    const stamped = { ...local, stamp: { epoch: 'e1' } };
    expect(checkLineage(stamped, { stamp: {}, sv: sv({ 5: 1 }) })).toEqual({ ok: false, reason: 'history' });
  });
});

describe('makeServerProbe', () => {
  const fetchers = () => ({
    snapshot: vi.fn(async () => ({ id: 'n1', path: 'n1.md', text: 'hi', vector_clock: 'U1Zf', crdt_epoch: 'e-snap' })),
    stateVector: vi.fn(async () => ({ id: 'n1', crdt_epoch: 'e-sv', state_vector: 'U1Y=' })),
    note: vi.fn(async () => ({
      id: 'n1', vault_id: 'v1', path: 'n1.md', title: 'N', created_at: 't1', updated_at: 't2', crdt_epoch: 'e-meta',
    })),
  });

  it('ack probe hits only the state-vector endpoint', async () => {
    const f = fetchers();
    const p = await makeServerProbe(f)(false);
    expect(p).toEqual({ vectorClock: 'U1Y=', text: null, lineage: { epoch: 'e-sv' } });
    expect(f.snapshot).not.toHaveBeenCalled();
    expect(f.note).not.toHaveBeenCalled();
  });

  it('full probe reads /snapshot + metadata; snapshot epoch wins, metadata fills gaps', async () => {
    const f = fetchers();
    expect(await makeServerProbe(f)(true)).toEqual({
      vectorClock: 'U1Zf', text: 'hi', lineage: { epoch: 'e-snap', createdAt: 't1' },
    });
    f.snapshot.mockResolvedValueOnce({ id: 'n1', path: 'n1.md', text: 'hi', vector_clock: 'U1Zf', crdt_epoch: undefined as unknown as string });
    expect((await makeServerProbe(f)(true)).lineage.epoch).toBe('e-meta');
    expect(f.stateVector).not.toHaveBeenCalled();
  });

  it('old server: no epoch anywhere → null epoch, created_at kept', async () => {
    const f = {
      snapshot: async () => ({ id: 'n1', path: 'n1.md', text: '', vector_clock: 'AA==' }),
      stateVector: async () => ({ state_vector: 'AA==' }),
      note: async () => ({ id: 'n1', vault_id: 'v1', path: 'n1.md', title: 'N', created_at: 't1', updated_at: 't1' }),
    };
    expect((await makeServerProbe(f)(true)).lineage).toEqual({ epoch: null, createdAt: 't1' });
    expect((await makeServerProbe(f)(false)).lineage).toEqual({ epoch: null });
  });
});

describe('ApiClient.getNoteStateVector', () => {
  function res(status: number, body: unknown): Response {
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: String(status),
      headers: { get: (k: string) => (k.toLowerCase() === 'content-type' ? 'application/json' : null) },
      json: async () => body,
    } as unknown as Response;
  }
  const SV = { id: 'n1', crdt_epoch: 'e1', state_vector: 'AQ==' };
  const SNAP = { id: 'n1', path: 'n1.md', text: 'x', vector_clock: 'Ag==', crdt_epoch: 'e0' };

  it('uses /state-vector when the server has it', async () => {
    const fetch = vi.fn(async (_url: string) => res(200, SV));
    const c = createClient('https://s', () => 'tk', { fetch: fetch as unknown as typeof globalThis.fetch });
    expect(await c.getNoteStateVector('v1', 'n1')).toEqual(SV);
    expect(fetch.mock.calls[0][0]).toBe('https://s/api/vaults/v1/notes/n1/state-vector');
    expect(c.stateVectorSupported).toBe(true);
  });

  it('old server (route 404) falls back to /snapshot once, then goes straight there', async () => {
    const fetch = vi.fn(async (url: string) =>
      url.endsWith('/state-vector') ? res(404, { error: 'not_found' }) : res(200, SNAP));
    const c = createClient('https://s', () => 'tk', { fetch: fetch as unknown as typeof globalThis.fetch });
    expect(await c.getNoteStateVector('v1', 'n1')).toEqual({ id: 'n1', crdt_epoch: 'e0', state_vector: 'Ag==' });
    expect(c.stateVectorSupported).toBe(false);
    await c.getNoteStateVector('v1', 'n1');
    expect(fetch.mock.calls.map((x) => x[0])).toEqual([
      'https://s/api/vaults/v1/notes/n1/state-vector',
      'https://s/api/vaults/v1/notes/n1/snapshot',
      'https://s/api/vaults/v1/notes/n1/snapshot',
    ]);
  });

  it('405/501 also mean "route missing"', async () => {
    for (const status of [405, 501]) {
      const fetch = vi.fn(async (url: string) =>
        url.endsWith('/state-vector') ? res(status, { error: 'x' }) : res(200, SNAP));
      const c = createClient('https://s', () => 'tk', { fetch: fetch as unknown as typeof globalThis.fetch });
      expect((await c.getNoteStateVector('v1', 'n1')).state_vector).toBe('Ag==');
    }
  });

  it('note gone: both 404 → ApiError 404, support not decided', async () => {
    const fetch = vi.fn(async () => res(404, { error: 'not_found' }));
    const c = createClient('https://s', () => 'tk', { fetch });
    await expect(c.getNoteStateVector('v1', 'n1')).rejects.toMatchObject({ status: 404 });
    expect(c.stateVectorSupported).toBeNull();
  });

  it('a 404 after the route is known to exist is "note gone" (no fallback)', async () => {
    const fetch = vi.fn(async () => res(200, SV));
    const c = createClient('https://s', () => 'tk', { fetch });
    await c.getNoteStateVector('v1', 'n1');
    fetch.mockImplementation(async () => res(404, { error: 'not_found' }));
    await expect(c.getNoteStateVector('v1', 'n1')).rejects.toBeInstanceOf(ApiError);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('other errors propagate without fallback', async () => {
    const fetch = vi.fn(async () => res(403, { error: 'capability_missing' }));
    const c = createClient('https://s', () => 'tk', { fetch });
    await expect(c.getNoteStateVector('v1', 'n1')).rejects.toMatchObject({ status: 403 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
