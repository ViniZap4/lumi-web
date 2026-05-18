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

  // ---- mutations (slice 4.3) ---------------------------------------------

  /** Create a new note in the current vault, refresh the list, and
   * select the new note. Returns the created summary on success.
   * Server-side conflicts (duplicate-after-slugify) bubble up via
   * the standard ApiError. */
  async create(input: api.CreateNoteInput): Promise<NoteSummary | null> {
    if (this.vaultID == null) return null;
    const created = await api.createNote(this.vaultID, input);
    // Optimistically prepend; refresh anyway to pick up server-side
    // mutations (slug suffixing on title collision, etc).
    this.list = [created, ...this.list.filter((n) => n.id !== created.id)];
    void this.refresh();
    await this.select(created.id);
    return created;
  }

  /** PATCH the focused note. Pass any subset of {title, body, tags,
   * path}. Updates the list entry in place + refreshes content. */
  async update(input: api.UpdateNoteInput): Promise<NoteSummary | null> {
    if (this.vaultID == null || this.selectedID == null) return null;
    const id = this.selectedID;
    const updated = await api.updateNote(this.vaultID, id, input);
    this.list = this.list.map((n) => (n.id === updated.id ? updated : n));
    // Re-fetch content so the preview reflects the new body / FS-
    // round-tripped frontmatter.
    if (input.body != null || input.title != null || input.tags != null) {
      this.content = await api.getNoteContent(this.vaultID, updated.id);
    }
    return updated;
  }

  /** DELETE the focused note. Clears selection on success. */
  async deleteSelected(): Promise<void> {
    if (this.vaultID == null || this.selectedID == null) return;
    const id = this.selectedID;
    await api.deleteNote(this.vaultID, id);
    this.list = this.list.filter((n) => n.id !== id);
    this.selectedID = null;
    this.content = null;
  }
}

function describeError(err: unknown): string {
  if (err instanceof ApiError) return err.detail ?? err.code;
  if (err instanceof Error) return err.message;
  return 'Unknown error';
}

export const notes = new NotesStore();
