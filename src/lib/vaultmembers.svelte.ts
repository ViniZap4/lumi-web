// Members / roles / invites store for the currently-selected vault.
// One store object holds all three because they're always loaded
// together (the settings modal shows them side by side) and
// mutations on one often affect another's view (creating an invite,
// changing a role, etc.).
//
// Pattern matches notes.svelte.ts: a single openVault(id) entry
// point hydrates everything; subsequent mutations update local lists
// optimistically AND reload only on errors that need it. Errors
// bubble through `lastError`, the modal renders them inline.

import {
  ApiError,
  type RemoteMember,
  type RemoteRole,
  type Invite,
  type InviteCreated,
} from './types.ts';
import * as api from './api.ts';
import { hasCapability } from './capabilities.ts';

// Re-export so callers can import the shape from one place.
export type CreateInviteInput = api.CreateInviteInput;
export type CreateRoleInput = api.CreateRoleInput;
export type UpdateRoleInput = api.UpdateRoleInput;

class VaultMembersStore {
  vaultID = $state<string | null>(null);
  members = $state<RemoteMember[]>([]);
  roles = $state<RemoteRole[]>([]);
  invites = $state<Invite[]>([]);

  loading = $state(false);
  lastError = $state<string | null>(null);

  /** Hydrate everything for the given vault. Idempotent for repeat
   *  ids; calling with `null` clears state (e.g. when modal closes). */
  async openVault(id: string | null): Promise<void> {
    if (id == null) {
      this.clear();
      return;
    }
    if (this.vaultID === id && (this.members.length > 0 || this.loading)) {
      // Already loaded; the caller can refresh() if they want fresh.
      return;
    }
    this.vaultID = id;
    this.loading = true;
    this.lastError = null;
    try {
      const [members, roles, invites] = await Promise.all([
        api.listVaultMembers(id),
        api.listVaultRoles(id),
        api.listVaultInvites(id).catch((e) => {
          // Listing invites requires `vault.member.invite` capability.
          // A non-admin opening Settings shouldn't see an error toast
          // for a list they're not entitled to read — they just see
          // an empty Invites tab.
          if (e instanceof ApiError && e.code === 'capability_missing') {
            return [];
          }
          throw e;
        }),
      ]);
      this.members = members;
      this.roles = roles;
      this.invites = invites;
    } catch (e) {
      this.lastError = describeError(e);
    } finally {
      this.loading = false;
    }
  }

  async refresh(): Promise<void> {
    if (!this.vaultID) return;
    const id = this.vaultID;
    this.vaultID = null; // forces openVault to re-hydrate
    await this.openVault(id);
  }

  clear(): void {
    this.vaultID = null;
    this.members = [];
    this.roles = [];
    this.invites = [];
    this.lastError = null;
  }

  // ---- mutations ----------------------------------------------------------

  /** Returns the slice of capabilities for the given user in this
   *  vault, used to pre-gate UI affordances. Returns [] when the user
   *  is not a member (e.g. before the list is loaded). */
  capabilitiesOf(userID: string | undefined | null): string[] {
    if (!userID) return [];
    return this.members.find((m) => m.user_id === userID)?.capabilities ?? [];
  }

  /** Wildcard-aware capability check for a given user. Use this rather
   *  than `capabilitiesOf(x).includes(needed)` — the server's
   *  CapabilitySet treats `*` and `prefix.*` as wildcards, so a raw
   *  includes() would deny admins (whose role carries `*`) every
   *  affordance. See lib/capabilities.ts. */
  userHasCapability(userID: string | undefined | null, needed: string): boolean {
    return hasCapability(this.capabilitiesOf(userID), needed);
  }

  async changeRole(userID: string, roleID: string): Promise<void> {
    if (!this.vaultID) return;
    const prev = this.members;
    // Optimistic update — find the new role name + caps for display.
    const newRole = this.roles.find((r) => r.id === roleID);
    if (!newRole) return; // unknown role, no-op
    this.members = this.members.map((m) =>
      m.user_id === userID
        ? { ...m, role_id: roleID, role_name: newRole.name, capabilities: newRole.capabilities }
        : m,
    );
    try {
      await api.updateMemberRole(this.vaultID, userID, roleID);
    } catch (e) {
      this.members = prev; // roll back
      this.lastError = describeError(e);
      throw e;
    }
  }

  async removeMember(userID: string): Promise<void> {
    if (!this.vaultID) return;
    const prev = this.members;
    this.members = this.members.filter((m) => m.user_id !== userID);
    try {
      await api.removeMember(this.vaultID, userID);
    } catch (e) {
      this.members = prev;
      this.lastError = describeError(e);
      throw e;
    }
  }

  async createInvite(input: CreateInviteInput): Promise<InviteCreated> {
    if (!this.vaultID) throw new Error('no vault selected');
    try {
      const created = await api.createInvite(this.vaultID, input);
      // Reload the invite list so the new row appears with the full
      // server shape (the create response is leaner than the list row).
      await this.reloadInvites();
      return created;
    } catch (e) {
      this.lastError = describeError(e);
      throw e;
    }
  }

  async revokeInvite(token: string): Promise<void> {
    if (!this.vaultID) return;
    const prev = this.invites;
    // Optimistic: stamp revoked_at on the local row so the UI's
    // "Revoked" badge appears immediately.
    const now = new Date().toISOString();
    this.invites = this.invites.map((i) =>
      i.token === token ? { ...i, revoked_at: now } : i,
    );
    try {
      await api.revokeInvite(this.vaultID, token);
    } catch (e) {
      this.invites = prev;
      this.lastError = describeError(e);
      throw e;
    }
  }

  private async reloadInvites(): Promise<void> {
    if (!this.vaultID) return;
    try {
      this.invites = await api.listVaultInvites(this.vaultID);
    } catch {
      // already toasted by the caller; ignore on background refresh
    }
  }

  // ---- role mutations -----------------------------------------------------

  async createRole(input: CreateRoleInput): Promise<RemoteRole> {
    if (!this.vaultID) throw new Error('no vault selected');
    try {
      const role = await api.createRole(this.vaultID, input);
      this.roles = [...this.roles, role];
      return role;
    } catch (e) {
      this.lastError = describeError(e);
      throw e;
    }
  }

  async updateRole(roleID: string, input: UpdateRoleInput): Promise<RemoteRole> {
    if (!this.vaultID) throw new Error('no vault selected');
    const prev = this.roles;
    // Optimistic merge so the form feels instant. Seed roles are
    // guarded by the server anyway; the modal hides edit affordances
    // for them so this branch only fires on custom roles.
    this.roles = this.roles.map((r) =>
      r.id === roleID
        ? { ...r, name: input.name ?? r.name, capabilities: input.capabilities ?? r.capabilities }
        : r,
    );
    try {
      const role = await api.updateRole(this.vaultID, roleID, input);
      // Replace the optimistic row with the server's canonical one
      // (preserves any server-side normalisation, e.g. dedup).
      this.roles = this.roles.map((r) => (r.id === roleID ? role : r));
      return role;
    } catch (e) {
      this.roles = prev;
      this.lastError = describeError(e);
      throw e;
    }
  }

  async deleteRole(roleID: string): Promise<void> {
    if (!this.vaultID) return;
    const prev = this.roles;
    this.roles = this.roles.filter((r) => r.id !== roleID);
    try {
      await api.deleteRole(this.vaultID, roleID);
    } catch (e) {
      this.roles = prev;
      this.lastError = describeError(e);
      throw e;
    }
  }
}

function describeError(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'capability_missing':
        return err.capability
          ? `Missing capability: ${err.capability}`
          : 'You don’t have permission for that action.';
      case 'last_admin':
        return 'You can’t remove or demote the last admin.';
      case 'self_remove':
        return 'You can’t remove yourself from the vault.';
      case 'owner_protected':
        return 'The vault owner can’t be removed or demoted below Admin. Transfer ownership first.';
      case 'seed_role_immutable':
      case 'seed_role':
        return 'Built-in roles can’t be edited or deleted.';
      case 'role_in_use':
        return 'Can’t delete a role that still has members. Reassign them first.';
      case 'role_name_taken':
        return 'A role with that name already exists.';
      case 'invite_expired':
        return 'This invite has expired.';
      case 'invite_revoked':
        return 'This invite was already revoked.';
      case 'validation_failed':
        return err.detail ?? 'The form has invalid fields.';
      default:
        return err.detail ?? err.code;
    }
  }
  if (err instanceof Error) return err.message;
  return 'Unknown error';
}

export const vaultMembers = new VaultMembersStore();
