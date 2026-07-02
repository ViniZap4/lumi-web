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
    transferOwnership: vi.fn(),
    copyVault: vi.fn(),
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
  owner_user_id: 'u1',
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

describe('VaultStore owner exposure (v3 Phase O)', () => {
  it('selectedOwnerID mirrors the selected vault\'s owner_user_id', () => {
    vaults.list = [
      sampleVault({ id: 'v1', owner_user_id: 'u-alice' }),
      sampleVault({ id: 'v2', owner_user_id: 'u-bob' }),
    ];
    vaults.select('v2');
    expect(vaults.selectedOwnerID).toBe('u-bob');
    vaults.select('v1');
    expect(vaults.selectedOwnerID).toBe('u-alice');
  });

  it('selectedOwnerID is null with no selection', () => {
    vaults.list = [sampleVault()];
    expect(vaults.selectedOwnerID).toBeNull();
  });

  it('isOwner compares against the selected vault and is null-safe', () => {
    vaults.list = [sampleVault({ id: 'v1', owner_user_id: 'u-alice' })];
    vaults.select('v1');
    expect(vaults.isOwner('u-alice')).toBe(true);
    expect(vaults.isOwner('u-bob')).toBe(false);
    expect(vaults.isOwner(null)).toBe(false);
    expect(vaults.isOwner(undefined)).toBe(false);
    vaults.select(null);
    expect(vaults.isOwner('u-alice')).toBe(false);
  });
});

describe('VaultStore.transferOwnership', () => {
  it('replaces the vault row with the server DTO (new owner)', async () => {
    vaults.list = [
      sampleVault({ id: 'v1', owner_user_id: 'u-alice' }),
      sampleVault({ id: 'v2', owner_user_id: 'u-alice' }),
    ];
    vaults.select('v1');
    vi.mocked(api.transferOwnership).mockResolvedValueOnce(
      sampleVault({ id: 'v1', owner_user_id: 'u-bob' }),
    );

    const out = await vaults.transferOwnership('v1', 'u-bob');
    expect(out.owner_user_id).toBe('u-bob');
    expect(api.transferOwnership).toHaveBeenCalledWith('v1', 'u-bob');
    expect(vaults.selectedOwnerID).toBe('u-bob');
    // The other vault is untouched.
    expect(vaults.list.find((v) => v.id === 'v2')?.owner_user_id).toBe('u-alice');
    expect(vaults.lastError).toBeNull();
  });

  it('surfaces validation errors into lastError and rethrows', async () => {
    vaults.list = [sampleVault({ id: 'v1', owner_user_id: 'u-alice' })];
    vi.mocked(api.transferOwnership).mockRejectedValueOnce(
      new ApiError(400, { error: 'validation' }),
    );
    await expect(vaults.transferOwnership('v1', 'u-ghost')).rejects.toBeInstanceOf(ApiError);
    expect(vaults.lastError).toBe('validation');
    // List is untouched on failure.
    expect(vaults.list[0].owner_user_id).toBe('u-alice');
  });

  it('surfaces 403 (not the owner) and rethrows', async () => {
    vaults.list = [sampleVault({ id: 'v1' })];
    vi.mocked(api.transferOwnership).mockRejectedValueOnce(
      new ApiError(403, { error: 'forbidden', detail: 'only the owner may transfer' }),
    );
    await expect(vaults.transferOwnership('v1', 'u-bob')).rejects.toMatchObject({ status: 403 });
    expect(vaults.lastError).toBe('only the owner may transfer');
  });
});

describe('VaultStore.sendCopy', () => {
  it('returns the fork DTO without touching the local list', async () => {
    vaults.list = [sampleVault({ id: 'v1' })];
    const fork = sampleVault({
      id: 'v-fork',
      slug: 'work-copy',
      name: 'Work',
      owner_user_id: 'u-bob',
      copied_from: {
        vault_id: 'v1',
        slug: 'work',
        copied_by: 'u-alice',
        copied_at: '2026-07-02T00:00:00Z',
      },
    });
    vi.mocked(api.copyVault).mockResolvedValueOnce(fork);

    const out = await vaults.sendCopy('v1', 'bob');
    expect(out.id).toBe('v-fork');
    expect(out.copied_from?.vault_id).toBe('v1');
    expect(api.copyVault).toHaveBeenCalledWith('v1', 'bob');
    // We're not a member of the fork — it must not enter our list.
    expect(vaults.list.map((v) => v.id)).toEqual(['v1']);
    expect(vaults.lastError).toBeNull();
  });

  it('surfaces recipient_not_found into lastError and rethrows', async () => {
    vi.mocked(api.copyVault).mockRejectedValueOnce(
      new ApiError(400, { error: 'recipient_not_found' }),
    );
    await expect(vaults.sendCopy('v1', 'ghost')).rejects.toMatchObject({
      code: 'recipient_not_found',
    });
    expect(vaults.lastError).toBe('recipient_not_found');
  });
});
