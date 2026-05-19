// @vitest-environment jsdom
//
// Tests for VaultStore.create — the new method added in the 4.x
// invite/vault-create slice. We mock the api module so we don't make
// real HTTP calls; the store logic we care about is the optimistic
// prepend + error-state surfacing, which is independent of transport.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./api.ts', async (importOriginal) => {
  // Keep the real ApiError + types; override only the network calls
  // we exercise here.
  const actual = await importOriginal<typeof import('./api.ts')>();
  return {
    ...actual,
    listVaults: vi.fn(async () => []),
    createVault: vi.fn(),
  };
});

import { vaults } from './vaults.svelte.ts';
import * as api from './api.ts';
import { ApiError, type Vault } from './types.ts';

const sampleVault = (over: Partial<Vault> = {}): Vault => ({
  id: 'v1',
  slug: 'work',
  name: 'Work',
  created_by: 'u1',
  created_at: '2026-05-19T00:00:00Z',
  ...over,
});

beforeEach(() => {
  vaults.clear();
  vi.clearAllMocks();
});

describe('VaultStore.create', () => {
  it('prepends the new vault and returns it', async () => {
    vi.mocked(api.createVault).mockResolvedValueOnce(sampleVault({ id: 'v2', name: 'New' }));
    const out = await vaults.create({ name: 'New' });
    expect(out.id).toBe('v2');
    expect(vaults.list[0].id).toBe('v2');
    expect(vaults.lastError).toBeNull();
  });

  it('replaces a duplicate id rather than doubling it', async () => {
    vaults.list = [sampleVault({ id: 'v1', name: 'Old' })];
    vi.mocked(api.createVault).mockResolvedValueOnce(sampleVault({ id: 'v1', name: 'New' }));
    await vaults.create({ name: 'New' });
    const ids = vaults.list.map((v) => v.id);
    expect(ids.filter((x) => x === 'v1')).toHaveLength(1);
    expect(vaults.list[0].name).toBe('New');
  });

  it('surfaces ApiError detail into lastError and rethrows', async () => {
    vi.mocked(api.createVault).mockRejectedValueOnce(
      new ApiError(409, { error: 'slug_conflict', detail: 'that slug is taken' }),
    );
    await expect(vaults.create({ name: 'X' })).rejects.toBeInstanceOf(ApiError);
    expect(vaults.lastError).toBe('that slug is taken');
  });

  it('forwards optional slug through to the API', async () => {
    vi.mocked(api.createVault).mockResolvedValueOnce(sampleVault());
    await vaults.create({ name: 'X', slug: 'custom' });
    expect(api.createVault).toHaveBeenCalledWith({ name: 'X', slug: 'custom' });
  });
});
