// @vitest-environment jsdom
//
// Tests for the federation store (v3 F-phases) — hydration with
// capability-tolerant invite/member lists, invite create/revoke,
// federation revoke (incl. 409 already-revoked), join, federated
// member add/change/remove, and the member-key pre-validation helper.
// The api module is mocked; the store logic under test is the
// optimistic updates + rollback + error surfacing.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./api.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api.ts')>();
  return {
    ...actual,
    listFederations: vi.fn(async () => []),
    listFederationInvites: vi.fn(async () => []),
    listFederatedMembers: vi.fn(async () => []),
    createFederationInvite: vi.fn(),
    revokeFederationInvite: vi.fn(),
    revokeFederation: vi.fn(),
    joinFederation: vi.fn(),
    addFederatedMember: vi.fn(),
    updateFederatedMemberRole: vi.fn(),
    removeFederatedMember: vi.fn(),
  };
});

import { federation, validateMemberKey } from './federation.svelte.ts';
import * as api from './api.ts';
import {
  ApiError,
  type Federation,
  type FederationInvite,
  type FederatedMember,
} from './types.ts';

const sampleFederation = (over: Partial<Federation> = {}): Federation => ({
  id: 'fed-1',
  vault_id: 'v1',
  role: 'home',
  peer_url: 'https://follower.example',
  status: 'active',
  last_acked_seq: 41,
  jurisdiction: 'BR',
  created_at: '2026-07-02T00:00:00Z',
  ...over,
});

const sampleInvite = (over: Partial<FederationInvite> = {}): FederationInvite => ({
  token: 'fed-tok-1',
  vault_id: 'v1',
  server_url_hint: 'https://follower.example',
  expires_at: '2026-08-01T00:00:00Z',
  created_at: '2026-07-02T00:00:00Z',
  used: false,
  revoked: false,
  ...over,
});

const sampleMember = (over: Partial<FederatedMember> = {}): FederatedMember => ({
  member_key: 'alice@https://follower.example',
  role_id: 'r1',
  role_name: 'Editor',
  joined_at: '2026-07-02T00:00:00Z',
  ...over,
});

beforeEach(() => {
  federation.clear();
  vi.clearAllMocks();
});

describe('FederationStore.openVault', () => {
  it('hydrates federations, invites, and members together', async () => {
    vi.mocked(api.listFederations).mockResolvedValueOnce([sampleFederation()]);
    vi.mocked(api.listFederationInvites).mockResolvedValueOnce([sampleInvite()]);
    vi.mocked(api.listFederatedMembers).mockResolvedValueOnce([sampleMember()]);

    await federation.openVault('v1');
    expect(federation.federations).toHaveLength(1);
    expect(federation.invites).toHaveLength(1);
    expect(federation.members).toHaveLength(1);
    expect(federation.lastError).toBeNull();
    expect(federation.loading).toBe(false);
  });

  it('tolerates capability_missing on the invite + member lists', async () => {
    // A plain member can read federations (LGPD notice) but not the
    // vault.federate-gated invite list nor members.manage surfaces.
    vi.mocked(api.listFederations).mockResolvedValueOnce([sampleFederation()]);
    vi.mocked(api.listFederationInvites).mockRejectedValueOnce(
      new ApiError(403, { error: 'capability_missing', capability: 'vault.federate' }),
    );
    vi.mocked(api.listFederatedMembers).mockRejectedValueOnce(
      new ApiError(403, { error: 'forbidden' }),
    );

    await federation.openVault('v1');
    expect(federation.federations).toHaveLength(1);
    expect(federation.invites).toEqual([]);
    expect(federation.members).toEqual([]);
    expect(federation.lastError).toBeNull();
  });

  it('surfaces a federations-list failure into lastError', async () => {
    vi.mocked(api.listFederations).mockRejectedValueOnce(
      new ApiError(500, { error: 'internal', detail: 'boom' }),
    );
    await federation.openVault('v1');
    expect(federation.lastError).toBe('boom');
  });

  it('clears state when called with null', async () => {
    vi.mocked(api.listFederations).mockResolvedValueOnce([sampleFederation()]);
    await federation.openVault('v1');
    await federation.openVault(null);
    expect(federation.vaultID).toBeNull();
    expect(federation.federations).toEqual([]);
  });
});

describe('FederationStore.createInvite', () => {
  it('returns the created row (with the show-once token) and reloads the list', async () => {
    vi.mocked(api.listFederations).mockResolvedValue([]);
    await federation.openVault('v1');

    vi.mocked(api.createFederationInvite).mockResolvedValueOnce(sampleInvite());
    vi.mocked(api.listFederationInvites).mockResolvedValueOnce([sampleInvite()]);

    const created = await federation.createInvite({
      server_url_hint: 'https://follower.example',
    });
    expect(created.token).toBe('fed-tok-1');
    expect(api.createFederationInvite).toHaveBeenCalledWith('v1', {
      server_url_hint: 'https://follower.example',
    });
    expect(federation.invites).toHaveLength(1);
  });

  it('surfaces errors into lastError and rethrows', async () => {
    await federation.openVault('v1');
    vi.mocked(api.createFederationInvite).mockRejectedValueOnce(
      new ApiError(403, { error: 'capability_missing', capability: 'vault.federate' }),
    );
    await expect(federation.createInvite({})).rejects.toBeInstanceOf(ApiError);
    expect(federation.lastError).toBe('Missing capability: vault.federate');
  });
});

describe('FederationStore.revokeInvite', () => {
  it('optimistically flags the row revoked', async () => {
    vi.mocked(api.listFederationInvites).mockResolvedValueOnce([sampleInvite()]);
    await federation.openVault('v1');
    vi.mocked(api.revokeFederationInvite).mockResolvedValueOnce(undefined);

    await federation.revokeInvite('fed-tok-1');
    expect(federation.invites[0].revoked).toBe(true);
    expect(api.revokeFederationInvite).toHaveBeenCalledWith('v1', 'fed-tok-1');
  });

  it('rolls back on failure and rethrows', async () => {
    vi.mocked(api.listFederationInvites).mockResolvedValueOnce([sampleInvite()]);
    await federation.openVault('v1');
    vi.mocked(api.revokeFederationInvite).mockRejectedValueOnce(
      new ApiError(403, { error: 'forbidden' }),
    );

    await expect(federation.revokeInvite('fed-tok-1')).rejects.toBeInstanceOf(ApiError);
    expect(federation.invites[0].revoked).toBe(false);
    expect(federation.lastError).not.toBeNull();
  });
});

describe('FederationStore.revokeFederation', () => {
  it('optimistically marks the link revoked', async () => {
    vi.mocked(api.listFederations).mockResolvedValueOnce([sampleFederation()]);
    await federation.openVault('v1');
    vi.mocked(api.revokeFederation).mockResolvedValueOnce(undefined);

    await federation.revokeFederation('fed-1');
    expect(federation.federations[0].status).toBe('revoked');
    expect(federation.federations[0].revoked_at).toBeTruthy();
    expect(api.revokeFederation).toHaveBeenCalledWith('v1', 'fed-1');
  });

  it('keeps the revoked state on 409 conflict (already revoked)', async () => {
    vi.mocked(api.listFederations).mockResolvedValue([sampleFederation()]);
    await federation.openVault('v1');
    vi.mocked(api.revokeFederation).mockRejectedValueOnce(
      new ApiError(409, { error: 'conflict' }),
    );

    // Does not throw — the desired end state (revoked) already holds.
    await federation.revokeFederation('fed-1');
    expect(federation.federations[0].status).toBe('revoked');
    expect(federation.lastError).toBeNull();
  });

  it('rolls back on other failures and rethrows', async () => {
    vi.mocked(api.listFederations).mockResolvedValueOnce([sampleFederation()]);
    await federation.openVault('v1');
    vi.mocked(api.revokeFederation).mockRejectedValueOnce(
      new ApiError(403, { error: 'capability_missing', capability: 'vault.federate' }),
    );

    await expect(federation.revokeFederation('fed-1')).rejects.toBeInstanceOf(ApiError);
    expect(federation.federations[0].status).toBe('active');
    expect(federation.lastError).toBe('Missing capability: vault.federate');
  });
});

describe('FederationStore.joinFederation', () => {
  it('passes through to the api and returns the replica vault', async () => {
    const resp = {
      vault: { id: 'v-replica', slug: 'work', name: 'Work' },
      federation: sampleFederation({ role: 'follower' }),
    };
    vi.mocked(api.joinFederation).mockResolvedValueOnce(resp);

    const out = await federation.joinFederation({
      home_url: 'https://home.example',
      token: 'fed-tok-1',
      jurisdiction: 'BR',
    });
    expect(out.vault.id).toBe('v-replica');
    expect(api.joinFederation).toHaveBeenCalledWith({
      home_url: 'https://home.example',
      token: 'fed-tok-1',
      jurisdiction: 'BR',
    });
    expect(federation.lastError).toBeNull();
  });

  it('surfaces validation errors into lastError and rethrows', async () => {
    vi.mocked(api.joinFederation).mockRejectedValueOnce(
      new ApiError(400, { error: 'validation', message: 'invite token expired' }),
    );
    await expect(
      federation.joinFederation({ home_url: 'https://home.example', token: 'bad' }),
    ).rejects.toBeInstanceOf(ApiError);
    expect(federation.lastError).toBe('invite token expired');
  });
});

describe('FederationStore federated members', () => {
  it('addMember posts then reloads the canonical list', async () => {
    await federation.openVault('v1');
    vi.mocked(api.addFederatedMember).mockResolvedValueOnce(sampleMember());
    vi.mocked(api.listFederatedMembers).mockResolvedValueOnce([sampleMember()]);

    await federation.addMember('alice@https://follower.example', 'r1');
    expect(api.addFederatedMember).toHaveBeenCalledWith(
      'v1',
      'alice@https://follower.example',
      'r1',
    );
    expect(federation.members).toHaveLength(1);
  });

  it('addMember surfaces 400 validation and rethrows', async () => {
    await federation.openVault('v1');
    vi.mocked(api.addFederatedMember).mockRejectedValueOnce(
      new ApiError(400, { error: 'validation', message: 'role belongs to another vault' }),
    );
    await expect(federation.addMember('alice@https://x.example', 'r-foreign')).rejects.toBeInstanceOf(
      ApiError,
    );
    expect(federation.lastError).toBe('role belongs to another vault');
  });

  it('changeMemberRole updates optimistically and rolls back on failure', async () => {
    vi.mocked(api.listFederatedMembers).mockResolvedValueOnce([sampleMember()]);
    await federation.openVault('v1');

    vi.mocked(api.updateFederatedMemberRole).mockResolvedValueOnce(undefined);
    await federation.changeMemberRole('alice@https://follower.example', 'r2', 'Viewer');
    expect(federation.members[0].role_id).toBe('r2');
    expect(federation.members[0].role_name).toBe('Viewer');

    vi.mocked(api.updateFederatedMemberRole).mockRejectedValueOnce(
      new ApiError(403, { error: 'forbidden' }),
    );
    await expect(
      federation.changeMemberRole('alice@https://follower.example', 'r3'),
    ).rejects.toBeInstanceOf(ApiError);
    expect(federation.members[0].role_id).toBe('r2'); // rolled back
  });

  it('removeMember drops the row optimistically and rolls back on failure', async () => {
    vi.mocked(api.listFederatedMembers).mockResolvedValueOnce([sampleMember()]);
    await federation.openVault('v1');

    vi.mocked(api.removeFederatedMember).mockRejectedValueOnce(
      new ApiError(403, { error: 'forbidden' }),
    );
    await expect(
      federation.removeMember('alice@https://follower.example'),
    ).rejects.toBeInstanceOf(ApiError);
    expect(federation.members).toHaveLength(1); // rolled back

    vi.mocked(api.removeFederatedMember).mockResolvedValueOnce(undefined);
    await federation.removeMember('alice@https://follower.example');
    expect(federation.members).toHaveLength(0);
    expect(api.removeFederatedMember).toHaveBeenCalledWith(
      'v1',
      'alice@https://follower.example',
    );
  });
});

describe('validateMemberKey', () => {
  it('accepts username@https://server keys', () => {
    expect(validateMemberKey('alice@https://follower.example')).toBeNull();
    expect(validateMemberKey('bob.smith_2@http://localhost:8080')).toBeNull();
    expect(validateMemberKey('  alice@https://follower.example  ')).toBeNull();
  });

  it('rejects empty and @-less keys', () => {
    expect(validateMemberKey('')).toBeTruthy();
    expect(validateMemberKey('   ')).toBeTruthy();
    expect(validateMemberKey('alice')).toBeTruthy();
    expect(validateMemberKey('@https://follower.example')).toBeTruthy();
  });

  it('rejects bad username characters', () => {
    expect(validateMemberKey('al ice@https://follower.example')).toBeTruthy();
    expect(validateMemberKey('al/ice@https://follower.example')).toBeTruthy();
  });

  it('rejects non-URL server parts', () => {
    expect(validateMemberKey('alice@follower.example')).toBeTruthy();
    expect(validateMemberKey('alice@ftp://follower.example')).toBeTruthy();
    expect(validateMemberKey('alice@https://')).toBeTruthy();
  });
});
