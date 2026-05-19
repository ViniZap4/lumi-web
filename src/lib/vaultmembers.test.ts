// @vitest-environment jsdom
//
// Tests for VaultMembersStore — the new store backing the
// VaultSettingsModal. The store coordinates three resources
// (members, roles, invites) and surfaces a single capabilities
// helper for the UI to pre-gate affordances. We mock api.ts so the
// tests are pure logic.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./api.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api.ts')>();
  return {
    ...actual,
    listVaultMembers: vi.fn(),
    listVaultRoles: vi.fn(),
    listVaultInvites: vi.fn(),
    updateMemberRole: vi.fn(),
    removeMember: vi.fn(),
    createInvite: vi.fn(),
    revokeInvite: vi.fn(),
    createRole: vi.fn(),
    updateRole: vi.fn(),
    deleteRole: vi.fn(),
  };
});

import { vaultMembers } from './vaultmembers.svelte.ts';
import * as api from './api.ts';
import {
  ApiError,
  type RemoteMember,
  type RemoteRole,
  type Invite,
} from './types.ts';

// Mirrors the server's seed Admin shape exactly: CapAll = "*".
// Earlier drafts of these tests carried hand-written dotted strings
// (vault.member.manage etc.) that don't exist in the real server;
// keeping them would mask the very bug this slice is fixing.
const adminRole: RemoteRole = {
  id: 'r-admin',
  vault_id: 'v1',
  name: 'Admin',
  capabilities: ['*'],
  is_seed: true,
};
const viewerRole: RemoteRole = {
  id: 'r-viewer',
  vault_id: 'v1',
  name: 'Viewer',
  capabilities: ['note.read'],
  is_seed: true,
};

const alice: RemoteMember = {
  vault_id: 'v1',
  user_id: 'u-alice',
  role_id: 'r-admin',
  username: 'alice',
  display_name: 'Alice',
  role_name: 'Admin',
  capabilities: ['*'], // matches adminRole.capabilities — keep in sync
  joined_at: '2026-04-01T00:00:00Z',
};
const bob: RemoteMember = {
  vault_id: 'v1',
  user_id: 'u-bob',
  role_id: 'r-viewer',
  username: 'bob',
  display_name: 'Bob',
  role_name: 'Viewer',
  capabilities: viewerRole.capabilities,
  joined_at: '2026-04-02T00:00:00Z',
};

const sampleInvite: Invite = {
  token: 'inv-1',
  vault_id: 'v1',
  role_id: 'r-viewer',
  inviter_user_id: 'u-alice',
  email_hint: undefined,
  max_uses: 1,
  use_count: 0,
  expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  created_at: '2026-05-19T00:00:00Z',
  revoked_at: null,
};

beforeEach(() => {
  vaultMembers.clear();
  vi.clearAllMocks();
  vi.mocked(api.listVaultMembers).mockResolvedValue([alice, bob]);
  vi.mocked(api.listVaultRoles).mockResolvedValue([adminRole, viewerRole]);
  vi.mocked(api.listVaultInvites).mockResolvedValue([sampleInvite]);
});

describe('VaultMembersStore.openVault', () => {
  it('hydrates members, roles, and invites in parallel', async () => {
    await vaultMembers.openVault('v1');
    expect(vaultMembers.members).toHaveLength(2);
    expect(vaultMembers.roles).toHaveLength(2);
    expect(vaultMembers.invites).toHaveLength(1);
    expect(vaultMembers.lastError).toBeNull();
  });

  it('swallows capability_missing on invites and shows empty', async () => {
    // A non-admin opening Settings should still see members+roles; the
    // invites list silently empties rather than erroring.
    vi.mocked(api.listVaultInvites).mockRejectedValueOnce(
      new ApiError(403, { error: 'capability_missing', capability: 'vault.member.invite' }),
    );
    await vaultMembers.openVault('v1');
    expect(vaultMembers.invites).toEqual([]);
    expect(vaultMembers.lastError).toBeNull();
  });

  it('clear() resets all state', async () => {
    await vaultMembers.openVault('v1');
    vaultMembers.clear();
    expect(vaultMembers.vaultID).toBeNull();
    expect(vaultMembers.members).toEqual([]);
    expect(vaultMembers.invites).toEqual([]);
  });
});

describe('VaultMembersStore.capabilitiesOf', () => {
  it('returns the member\'s caps when they\'re in the list', async () => {
    await vaultMembers.openVault('v1');
    expect(vaultMembers.capabilitiesOf('u-alice')).toContain('*');
    expect(vaultMembers.capabilitiesOf('u-bob')).not.toContain('*');
  });

  it('returns [] for unknown / nullish users', async () => {
    await vaultMembers.openVault('v1');
    expect(vaultMembers.capabilitiesOf('u-ghost')).toEqual([]);
    expect(vaultMembers.capabilitiesOf(null)).toEqual([]);
    expect(vaultMembers.capabilitiesOf(undefined)).toEqual([]);
  });
});

describe('VaultMembersStore.changeRole', () => {
  it('optimistically updates the member row and persists', async () => {
    await vaultMembers.openVault('v1');
    vi.mocked(api.updateMemberRole).mockResolvedValueOnce(undefined);

    await vaultMembers.changeRole('u-bob', 'r-admin');
    const bobNew = vaultMembers.members.find((m) => m.user_id === 'u-bob');
    expect(bobNew?.role_id).toBe('r-admin');
    expect(bobNew?.role_name).toBe('Admin');
    expect(bobNew?.capabilities).toContain('*');
    expect(api.updateMemberRole).toHaveBeenCalledWith('v1', 'u-bob', 'r-admin');
  });

  it('rolls back on server error', async () => {
    await vaultMembers.openVault('v1');
    vi.mocked(api.updateMemberRole).mockRejectedValueOnce(
      new ApiError(409, { error: 'last_admin', detail: 'demoting last admin' }),
    );
    await expect(vaultMembers.changeRole('u-alice', 'r-viewer')).rejects.toBeInstanceOf(ApiError);
    const alicePost = vaultMembers.members.find((m) => m.user_id === 'u-alice');
    expect(alicePost?.role_id).toBe('r-admin');
    expect(vaultMembers.lastError).toBe('You can’t remove or demote the last admin.');
  });

  it('no-ops when target role doesn\'t exist', async () => {
    await vaultMembers.openVault('v1');
    await vaultMembers.changeRole('u-bob', 'r-bogus');
    expect(api.updateMemberRole).not.toHaveBeenCalled();
  });
});

describe('VaultMembersStore.removeMember', () => {
  it('optimistically drops the row and persists', async () => {
    await vaultMembers.openVault('v1');
    vi.mocked(api.removeMember).mockResolvedValueOnce(undefined);
    await vaultMembers.removeMember('u-bob');
    expect(vaultMembers.members.map((m) => m.user_id)).toEqual(['u-alice']);
  });

  it('rolls back on server error', async () => {
    await vaultMembers.openVault('v1');
    vi.mocked(api.removeMember).mockRejectedValueOnce(
      new ApiError(409, { error: 'self_remove' }),
    );
    await expect(vaultMembers.removeMember('u-alice')).rejects.toBeInstanceOf(ApiError);
    expect(vaultMembers.members).toHaveLength(2);
    expect(vaultMembers.lastError).toBe('You can’t remove yourself from the vault.');
  });
});

describe('VaultMembersStore.userHasCapability', () => {
  it('admin with CapAll = "*" sees every affordance', async () => {
    // This is the test that closes the bug from the previous slice:
    // the modal had `myCaps.includes('vault.member.manage')` which
    // would never be true for an Admin (whose role grants "*"), so
    // every admin button was hidden. userHasCapability fixes that
    // with the same wildcard semantics the server uses.
    await vaultMembers.openVault('v1');
    expect(vaultMembers.userHasCapability('u-alice', 'roles.manage')).toBe(true);
    expect(vaultMembers.userHasCapability('u-alice', 'members.manage')).toBe(true);
    expect(vaultMembers.userHasCapability('u-alice', 'audit.read')).toBe(true);
  });

  it('viewer with note.read only is denied admin actions', async () => {
    await vaultMembers.openVault('v1');
    expect(vaultMembers.userHasCapability('u-bob', 'note.read')).toBe(true);
    expect(vaultMembers.userHasCapability('u-bob', 'members.manage')).toBe(false);
    expect(vaultMembers.userHasCapability('u-bob', 'roles.manage')).toBe(false);
  });

  it('unknown user has no capabilities', async () => {
    await vaultMembers.openVault('v1');
    expect(vaultMembers.userHasCapability('u-ghost', 'note.read')).toBe(false);
  });
});

describe('VaultMembersStore role CRUD', () => {
  it('createRole appends to the list and returns the role', async () => {
    await vaultMembers.openVault('v1');
    const editor: RemoteRole = {
      id: 'r-editor',
      vault_id: 'v1',
      name: 'Editor',
      capabilities: ['note.read', 'note.edit'],
      is_seed: false,
    };
    vi.mocked(api.createRole).mockResolvedValueOnce(editor);
    const out = await vaultMembers.createRole({
      name: 'Editor',
      capabilities: ['note.read', 'note.edit'],
    });
    expect(out.id).toBe('r-editor');
    expect(vaultMembers.roles.map((r) => r.id)).toContain('r-editor');
  });

  it('updateRole optimistically merges then replaces with server row', async () => {
    const custom: RemoteRole = {
      id: 'r-custom',
      vault_id: 'v1',
      name: 'Custom',
      capabilities: ['note.read'],
      is_seed: false,
    };
    vi.mocked(api.listVaultRoles).mockResolvedValueOnce([adminRole, viewerRole, custom]);
    vaultMembers.clear();
    await vaultMembers.openVault('v1');

    const updated: RemoteRole = { ...custom, name: 'Renamed', capabilities: ['note.read', 'note.edit'] };
    vi.mocked(api.updateRole).mockResolvedValueOnce(updated);

    await vaultMembers.updateRole('r-custom', { name: 'Renamed', capabilities: updated.capabilities });
    const got = vaultMembers.roles.find((r) => r.id === 'r-custom');
    expect(got?.name).toBe('Renamed');
    expect(got?.capabilities).toEqual(['note.read', 'note.edit']);
  });

  it('updateRole rolls back on server error and surfaces seed_role mapping', async () => {
    await vaultMembers.openVault('v1');
    vi.mocked(api.updateRole).mockRejectedValueOnce(
      new ApiError(409, { error: 'seed_role_immutable' }),
    );
    const before = vaultMembers.roles.find((r) => r.id === 'r-admin');
    await expect(
      vaultMembers.updateRole('r-admin', { name: 'NotAdmin' }),
    ).rejects.toBeInstanceOf(ApiError);
    const after = vaultMembers.roles.find((r) => r.id === 'r-admin');
    expect(after?.name).toBe(before?.name);
    expect(vaultMembers.lastError).toBe('Built-in roles can’t be edited or deleted.');
  });

  it('deleteRole optimistically removes and rolls back on role_in_use', async () => {
    await vaultMembers.openVault('v1');
    vi.mocked(api.deleteRole).mockRejectedValueOnce(
      new ApiError(409, { error: 'role_in_use' }),
    );
    await expect(vaultMembers.deleteRole('r-viewer')).rejects.toBeInstanceOf(ApiError);
    expect(vaultMembers.roles.map((r) => r.id)).toContain('r-viewer');
    expect(vaultMembers.lastError).toBe(
      'Can’t delete a role that still has members. Reassign them first.',
    );
  });

  it('deleteRole succeeds and removes the row', async () => {
    await vaultMembers.openVault('v1');
    vi.mocked(api.deleteRole).mockResolvedValueOnce(undefined);
    await vaultMembers.deleteRole('r-viewer');
    expect(vaultMembers.roles.map((r) => r.id)).not.toContain('r-viewer');
  });
});

describe('VaultMembersStore.createInvite + revokeInvite', () => {
  it('creates an invite and reloads the list', async () => {
    await vaultMembers.openVault('v1');
    const newInvite: Invite = {
      ...sampleInvite,
      token: 'inv-2',
      use_count: 0,
    };
    vi.mocked(api.createInvite).mockResolvedValueOnce({
      token: 'inv-2',
      url: 'http://localhost:5173/?invite=inv-2',
      expires_at: newInvite.expires_at,
      max_uses: 1,
      use_count: 0,
    });
    vi.mocked(api.listVaultInvites).mockResolvedValueOnce([sampleInvite, newInvite]);

    const out = await vaultMembers.createInvite({
      role_id: 'r-viewer',
      max_uses: 1,
      expires_at: newInvite.expires_at,
    });

    expect(out.token).toBe('inv-2');
    expect(vaultMembers.invites.map((i) => i.token)).toEqual(['inv-1', 'inv-2']);
  });

  it('revokeInvite optimistically marks revoked_at', async () => {
    await vaultMembers.openVault('v1');
    vi.mocked(api.revokeInvite).mockResolvedValueOnce(undefined);
    await vaultMembers.revokeInvite('inv-1');
    const revoked = vaultMembers.invites.find((i) => i.token === 'inv-1');
    expect(revoked?.revoked_at).not.toBeNull();
    expect(revoked?.revoked_at).not.toBe(undefined);
  });

  it('revokeInvite rolls back on error', async () => {
    await vaultMembers.openVault('v1');
    vi.mocked(api.revokeInvite).mockRejectedValueOnce(
      new ApiError(410, { error: 'invite_revoked' }),
    );
    await expect(vaultMembers.revokeInvite('inv-1')).rejects.toBeInstanceOf(ApiError);
    const inv = vaultMembers.invites.find((i) => i.token === 'inv-1');
    expect(inv?.revoked_at).toBeFalsy();
    expect(vaultMembers.lastError).toBe('This invite was already revoked.');
  });
});
