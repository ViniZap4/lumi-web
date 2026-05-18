// Reactive notes store per vault. Hydrates on vault selection; tracks
// the focused note and its rendered content. Slice 4.2 is read-only;
// 4.3 adds mutating actions (create/edit/delete), 4.4 swaps the
// editor for a Yjs-bound CodeMirror.

import { ApiError, type NoteSummary, type NoteContent } from './types.ts';
import * as api from './api.ts';

class NotesStore {
  vaultID = $state<string | null>(null);

  list = $state<NoteSummary[]>([]);
  loadingList = $state(false);
  listError = $state<string | null>(null);

  selectedID = $state<string | null>(null);
  selected = $derived<NoteSummary | null>(
    this.selectedID == null ? null : this.list.find((n) => n.id === this.selectedID) ?? null,
  );

  content = $state<NoteContent | null>(null);
  loadingContent = $state(false);
  contentError = $state<string | null>(null);

  /** Switch to a vault: clears state, fetches list. Idempotent. */
  async openVault(vaultID: string | null): Promise<void> {
    if (this.vaultID === vaultID) return;
    this.vaultID = vaultID;
    this.list = [];
    this.selectedID = null;
    this.content = null;
    this.listError = null;
    this.contentError = null;
    if (vaultID == null) return;
    await this.refresh();
  }

  async refresh(): Promise<void> {
    if (this.vaultID == null) return;
    this.loadingList = true;
    this.listError = null;
    try {
      const out = await api.listNotes(this.vaultID, { limit: 200 });
      this.list = out.notes;
      // Keep selectedID stable if the note still exists; drop it otherwise.
      if (this.selectedID && !this.list.some((n) => n.id === this.selectedID)) {
        this.selectedID = null;
        this.content = null;
      }
    } catch (e) {
      this.listError = describeError(e);
    } finally {
      this.loadingList = false;
    }
  }

  async select(id: string | null): Promise<void> {
    if (this.selectedID === id) return;
    this.selectedID = id;
    this.content = null;
    if (id == null || this.vaultID == null) return;
    this.loadingContent = true;
    this.contentError = null;
    try {
      this.content = await api.getNoteContent(this.vaultID, id);
    } catch (e) {
      this.contentError = describeError(e);
    } finally {
      this.loadingContent = false;
    }
  }
}

function describeError(err: unknown): string {
  if (err instanceof ApiError) return err.detail ?? err.code;
  if (err instanceof Error) return err.message;
  return 'Unknown error';
}

export const notes = new NotesStore();
