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
}

export const vaults = new VaultStore();
