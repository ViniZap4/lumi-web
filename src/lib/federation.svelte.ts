// Federation state for the currently-selected vault (v3 F-phases).
// One store holds federations + federation invites + federated
// members because the settings modal shows them side by side, exactly
// like vaultmembers.svelte.ts does for members/roles/invites.
//
// Pattern matches vaultmembers.svelte.ts: a single openVault(id)
// entry point hydrates everything; mutations update local lists
// optimistically and roll back on error. Errors bubble through
// `lastError`; per-action errors are rethrown so forms can render
// them inline.

import {
  ApiError,
  type Federation,
  type FederationInvite,
  type FederationJoinResponse,
  type FederatedMember,
} from './types.ts';
import * as api from './api.ts';

// Re-export so callers can import the shapes from one place.
export type CreateFederationInviteInput = api.CreateFederationInviteInput;
export type JoinFederationInput = api.JoinFederationInput;

/**
 * Client-side pre-check of a federated member key. The wire format is
 * `username@https://server` — username, one `@`, then the follower
 * server's full URL. Returns a human-readable problem or null when
 * the key looks valid. The server revalidates either way (400
 * `validation`); this only exists so the add form can hint before a
 * round-trip.
 */
export function validateMemberKey(key: string): string | null {
  const trimmed = key.trim();
  if (!trimmed) return 'Enter a member key.';
  const at = trimmed.indexOf('@');
  if (at <= 0) return 'Member key must look like username@https://server.';
  const username = trimmed.slice(0, at);
  const server = trimmed.slice(at + 1);
  if (!/^[a-zA-Z0-9._-]+$/.test(username)) {
    return 'The username part contains invalid characters.';
  }
  if (!/^https?:\/\//.test(server)) {
    return 'The server part must be a full URL (https://…).';
  }
  try {
    // Structural URL check — catches `https://` with nothing after it.
    const u = new URL(server);
    if (!u.host) return 'The server part must be a valid URL.';
  } catch {
    return 'The server part must be a valid URL.';
  }
  return null;
}

class FederationStore {
  vaultID = $state<string | null>(null);

  federations = $state<Federation[]>([]);
  invites = $state<FederationInvite[]>([]);
  members = $state<FederatedMember[]>([]);

  loading = $state(false);
  lastError = $state<string | null>(null);

  /** Vault whose data is fully hydrated (null while loading/cleared). */
  private loadedVaultID: string | null = null;
  /** Monotonic ticket; responses from an older ticket are dropped. */
  private seq = 0;

  /** Hydrate everything for the given vault. Idempotent for repeat
   *  ids; calling with `null` clears state (e.g. when modal closes). */
  async openVault(id: string | null): Promise<void> {
    if (id == null) {
      this.clear();
      return;
    }
    // "Loaded" is tracked explicitly: a vault with zero rows is just
    // as loaded as one with many (checking `list.length > 0` refetched
    // empty vaults on every open).
    if (this.vaultID === id && (this.loadedVaultID === id || this.loading)) {
      // Already loaded / loading; the caller can refresh() for fresh data.
      return;
    }
    const seq = ++this.seq;
    this.vaultID = id;
    this.loadedVaultID = null;
    this.loading = true;
    this.lastError = null;
    try {
      const [federations, invites, members] = await Promise.all([
        // Federations list is member-visible (LGPD notice) — errors here
        // are real errors and should surface.
        api.listFederations(id),
        // Invite management needs vault.federate; a plain member opening
        // Settings shouldn't see an error for a list they're not
        // entitled to read — they just see nothing.
        api.listFederationInvites(id).catch(swallowForbidden<FederationInvite>),
        api.listFederatedMembers(id).catch(swallowForbidden<FederatedMember>),
      ]);
      if (seq !== this.seq) return; // superseded by a newer open/clear
      this.federations = federations;
      this.invites = invites;
      this.members = members;
      this.loadedVaultID = id;
    } catch (e) {
      if (seq !== this.seq) return;
      this.lastError = describeError(e);
    } finally {
      if (seq === this.seq) this.loading = false;
    }
  }

  async refresh(): Promise<void> {
    if (!this.vaultID) return;
    const id = this.vaultID;
    this.vaultID = null; // forces openVault to re-hydrate
    this.loading = false;
    await this.openVault(id);
  }

  clear(): void {
    this.seq++; // invalidate any in-flight hydration
    this.loading = false;
    this.loadedVaultID = null;
    this.vaultID = null;
    this.federations = [];
    this.invites = [];
    this.members = [];
    this.lastError = null;
  }

  // ---- federation invites ---------------------------------------------------

  /** Create a federation invite. Returns the created row — the ONLY
   *  place the caller should surface the raw token (show once, copy
   *  to clipboard). The list is reloaded so the new row appears. */
  async createInvite(input: CreateFederationInviteInput): Promise<FederationInvite> {
    if (!this.vaultID) throw new Error('no vault selected');
    try {
      const created = await api.createFederationInvite(this.vaultID, input);
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
    // Optimistic: flag revoked locally so the badge flips immediately.
    this.invites = this.invites.map((i) => (i.token === token ? { ...i, revoked: true } : i));
    try {
      await api.revokeFederationInvite(this.vaultID, token);
    } catch (e) {
      this.invites = prev;
      this.lastError = describeError(e);
      throw e;
    }
  }

  private async reloadInvites(): Promise<void> {
    const id = this.vaultID;
    if (!id) return;
    try {
      const invites = await api.listFederationInvites(id);
      if (this.vaultID === id) this.invites = invites;
    } catch {
      // list refresh is best-effort; the create/revoke error already surfaced
    }
  }

  // ---- federations ------------------------------------------------------------

  /** Sever a federation link. The peer keeps its copy of the data —
   *  it was trusted with plaintext; the confirm dialog must say so.
   *  409 `conflict` (already revoked) resolves by refreshing. */
  async revokeFederation(id: string): Promise<void> {
    if (!this.vaultID) return;
    const prev = this.federations;
    const now = new Date().toISOString();
    this.federations = this.federations.map((f) =>
      f.id === id ? { ...f, status: 'revoked' as const, revoked_at: now } : f,
    );
    try {
      await api.revokeFederation(this.vaultID, id);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'conflict') {
        // Already revoked server-side — our optimistic state is right;
        // refresh in the background to pick up the canonical row.
        void this.refresh();
        return;
      }
      this.federations = prev;
      this.lastError = describeError(e);
      throw e;
    }
  }

  // ---- join (this server becomes a follower) ---------------------------------

  /** Join a remote vault's federation: this server becomes a follower
   *  and materialises a local replica vault. Not vault-scoped, so it
   *  works before any vault is selected. Returns the join response so
   *  the caller can refresh the vault list and select the replica. */
  async joinFederation(input: JoinFederationInput): Promise<FederationJoinResponse> {
    this.lastError = null;
    try {
      return await api.joinFederation(input);
    } catch (e) {
      this.lastError = describeError(e);
      throw e;
    }
  }

  // ---- federated members ------------------------------------------------------

  /** Grant a cross-server user (`username@https://server`) a role in
   *  this vault. Reloads the list so the row carries the server's
   *  canonical shape (role_name resolution etc.). */
  async addMember(memberKey: string, roleID: string): Promise<void> {
    const id = this.vaultID;
    if (!id) throw new Error('no vault selected');
    try {
      await api.addFederatedMember(id, memberKey, roleID);
      const members = await api.listFederatedMembers(id);
      if (this.vaultID === id) this.members = members;
    } catch (e) {
      this.lastError = describeError(e);
      throw e;
    }
  }

  async changeMemberRole(memberKey: string, roleID: string, roleName?: string): Promise<void> {
    if (!this.vaultID) return;
    const prev = this.members;
    this.members = this.members.map((m) =>
      m.member_key === memberKey
        ? { ...m, role_id: roleID, role_name: roleName ?? m.role_name }
        : m,
    );
    try {
      await api.updateFederatedMemberRole(this.vaultID, memberKey, roleID);
    } catch (e) {
      this.members = prev;
      this.lastError = describeError(e);
      throw e;
    }
  }

  async removeMember(memberKey: string): Promise<void> {
    if (!this.vaultID) return;
    const prev = this.members;
    this.members = this.members.filter((m) => m.member_key !== memberKey);
    try {
      await api.removeFederatedMember(this.vaultID, memberKey);
    } catch (e) {
      this.members = prev;
      this.lastError = describeError(e);
      throw e;
    }
  }
}

// For lists a plain member may not read (vault.federate / members.manage
// gated): 403s mean "not yours to see", not "broken" — return empty.
function swallowForbidden<T>(e: unknown): T[] {
  if (e instanceof ApiError && (e.code === 'capability_missing' || e.code === 'forbidden')) {
    return [];
  }
  throw e;
}

function describeError(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'capability_missing':
        return err.capability
          ? `Missing capability: ${err.capability}`
          : 'You don’t have permission for that action.';
      case 'forbidden':
        return 'You don’t have permission for that action.';
      case 'conflict':
        return 'That federation link was already revoked.';
      case 'validation':
        return err.detail ?? 'The form has invalid fields.';
      default:
        return err.detail ?? err.code;
    }
  }
  if (err instanceof Error) return err.message;
  return 'Unknown error';
}

export const federation = new FederationStore();
