// Reactive vault list + selection. Hydrated on first authed render
// via load(); the user picks a vault to enter, slice 4.2 will mount
// the note browser against the selected vault id.
//
// Capabilities for the selected vault land here too so views can
// gate UI ("show 'New Note' button" iff caller has note.create).
// Slice 4.1 only stores them; later slices read them.

import { ApiError, type Vault } from './types.ts';
import * as api from './api.ts';

class VaultStore {
  list = $state<Vault[]>([]);
  loading = $state(false);
  lastError = $state<string | null>(null);

  selectedID = $state<string | null>(null);
  selected = $derived<Vault | null>(
    this.selectedID == null ? null : this.list.find((v) => v.id === this.selectedID) ?? null,
  );

  // v3 Phase O: owner of the currently-selected vault. Views compare
  // member user_ids against this to render the "owner" badge and to
  // guard remove / role-change affordances.
  selectedOwnerID = $derived<string | null>(this.selected?.owner_user_id ?? null);

  /** True when `userID` owns the currently-selected vault. Null-safe:
   *  returns false before a vault is selected or while signed out. */
  isOwner(userID: string | undefined | null): boolean {
    if (!userID || this.selectedOwnerID == null) return false;
    return this.selectedOwnerID === userID;
  }

  async load(): Promise<void> {
    this.loading = true;
    this.lastError = null;
    try {
      this.list = await api.listVaults();
    } catch (e) {
      if (e instanceof ApiError) {
        this.lastError = e.detail ?? e.code;
      } else if (e instanceof Error) {
        this.lastError = e.message;
      } else {
        this.lastError = 'Unknown error';
      }
    } finally {
      this.loading = false;
    }
  }

  select(id: string | null): void {
    this.selectedID = id;
  }

  clear(): void {
    this.list = [];
    this.selectedID = null;
    this.lastError = null;
  }

  /**
   * Create a new vault and prepend it to the live list. Returns the
   * created vault so the caller can route the user straight into it.
   * Errors set `lastError` so the form can surface them inline.
   */
  async create(input: api.CreateVaultInput): Promise<Vault> {
    this.lastError = null;
    try {
      const v = await api.createVault(input);
      // Prepend rather than reload — keeps the existing list rendered
      // and avoids a brief "empty / loading" flash. listVaults() would
      // return them in created_at-desc order anyway, so prepend is
      // consistent with the next refresh.
      this.list = [v, ...this.list.filter((x) => x.id !== v.id)];
      return v;
    } catch (e) {
      if (e instanceof ApiError) {
        this.lastError = e.detail ?? e.code;
      } else if (e instanceof Error) {
        this.lastError = e.message;
      } else {
        this.lastError = 'Unknown error';
      }
      throw e;
    }
  }

  /**
   * v3 Phase O — transfer ownership of a vault to another member.
   * Replaces the vault's row in the live list with the server's fresh
   * DTO (new owner_user_id) so derived owner state updates in place.
   * Errors set `lastError` and rethrow so callers can render inline.
   */
  async transferOwnership(vaultID: string, userID: string): Promise<Vault> {
    this.lastError = null;
    try {
      const v = await api.transferOwnership(vaultID, userID);
      this.list = this.list.map((x) => (x.id === v.id ? v : x));
      return v;
    } catch (e) {
      if (e instanceof ApiError) {
        this.lastError = e.detail ?? e.code;
      } else if (e instanceof Error) {
        this.lastError = e.message;
      } else {
        this.lastError = 'Unknown error';
      }
      throw e;
    }
  }

  /**
   * v3 Phase O — send a copy of a vault to another user by username.
   * The fork belongs to the recipient (we're not a member of it), so
   * the local list is untouched; the returned DTO is only for the
   * confirmation message. Errors set `lastError` and rethrow.
   */
  async sendCopy(vaultID: string, recipientUsername: string): Promise<Vault> {
    this.lastError = null;
    try {
      return await api.copyVault(vaultID, recipientUsername);
    } catch (e) {
      if (e instanceof ApiError) {
        this.lastError = e.detail ?? e.code;
      } else if (e instanceof Error) {
        this.lastError = e.message;
      } else {
        this.lastError = 'Unknown error';
      }
      throw e;
    }
  }
}

export const vaults = new VaultStore();
