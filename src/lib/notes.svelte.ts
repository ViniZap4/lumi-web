// Reactive notes store per vault. Hydrates on vault selection; tracks
// the focused note and its rendered content. Slice 4.2 is read-only;
// 4.3 adds mutating actions (create/edit/delete), 4.4 swaps the
// editor for a Yjs-bound CodeMirror.

import { ApiError, type NoteSummary, type NoteContent } from './types.ts';
import * as api from './api.ts';

// Request sequencing
// -------------------
// Every async action captures a ticket before awaiting and re-checks
// it afterwards; a stale response (the user switched vault/note, or a
// newer refresh started) is dropped instead of overwriting newer
// state. In-flight fetches that became irrelevant are also aborted so
// they stop consuming bandwidth.
//
//   - `vaultEpoch` bumps on every vault switch and invalidates
//     everything started under the previous vault.
//   - `listSeq` orders list fetches (refresh); only the newest wins.
//   - `contentSeq` orders content fetches (select / update refetch).

class NotesStore {
  vaultID = $state<string | null>(null);

  list = $state<NoteSummary[]>([]);
  loadingList = $state(false);
  listError = $state<string | null>(null);
  // HTTP status behind listError (null for non-API failures). Lets the
  // view special-case 403 — e.g. a federated replica whose home server
  // hasn't granted this account access yet — without string-matching.
  listErrorStatus = $state<number | null>(null);

  selectedID = $state<string | null>(null);
  selected = $derived<NoteSummary | null>(
    this.selectedID == null ? null : this.list.find((n) => n.id === this.selectedID) ?? null,
  );

  content = $state<NoteContent | null>(null);
  loadingContent = $state(false);
  contentError = $state<string | null>(null);

  private vaultEpoch = 0;
  private listSeq = 0;
  private contentSeq = 0;
  private listAbort: AbortController | null = null;
  private contentAbort: AbortController | null = null;

  /** Switch to a vault: clears state, fetches list. Idempotent. */
  async openVault(vaultID: string | null): Promise<void> {
    if (this.vaultID === vaultID) return;
    this.vaultEpoch++;
    this.abortList();
    this.abortContent();
    this.vaultID = vaultID;
    this.list = [];
    this.selectedID = null;
    this.content = null;
    this.listError = null;
    this.listErrorStatus = null;
    this.contentError = null;
    this.loadingList = false;
    this.loadingContent = false;
    if (vaultID == null) return;
    await this.refresh();
  }

  async refresh(): Promise<void> {
    const vaultID = this.vaultID;
    if (vaultID == null) return;
    const seq = ++this.listSeq;
    this.abortList();
    const ctrl = new AbortController();
    this.listAbort = ctrl;
    this.loadingList = true;
    this.listError = null;
    this.listErrorStatus = null;
    try {
      const out = await api.listNotes(vaultID, { limit: 200, signal: ctrl.signal });
      if (seq !== this.listSeq || vaultID !== this.vaultID) return;
      this.list = out.notes;
      // Keep selectedID stable if the note still exists; drop it otherwise.
      if (this.selectedID && !this.list.some((n) => n.id === this.selectedID)) {
        this.selectedID = null;
        this.content = null;
        this.abortContent();
        this.contentSeq++;
        this.loadingContent = false;
      }
    } catch (e) {
      if (seq !== this.listSeq || vaultID !== this.vaultID || isAbort(e)) return;
      this.listError = describeError(e);
      this.listErrorStatus = e instanceof ApiError ? e.status : null;
    } finally {
      if (seq === this.listSeq) {
        this.loadingList = false;
        this.listAbort = null;
      }
    }
  }

  async select(id: string | null): Promise<void> {
    if (this.selectedID === id) return;
    const vaultID = this.vaultID;
    const seq = ++this.contentSeq;
    this.abortContent();
    this.selectedID = id;
    this.content = null;
    this.contentError = null;
    if (id == null || vaultID == null) {
      this.loadingContent = false;
      return;
    }
    const ctrl = new AbortController();
    this.contentAbort = ctrl;
    this.loadingContent = true;
    try {
      const content = await api.getNoteContent(vaultID, id, ctrl.signal);
      if (seq !== this.contentSeq || vaultID !== this.vaultID) return;
      this.content = content;
    } catch (e) {
      if (seq !== this.contentSeq || vaultID !== this.vaultID || isAbort(e)) return;
      this.contentError = describeError(e);
    } finally {
      if (seq === this.contentSeq) {
        this.loadingContent = false;
        this.contentAbort = null;
      }
    }
  }

  // ---- mutations (slice 4.3) ---------------------------------------------

  /** Create a new note in the current vault, refresh the list, and
   * select the new note. Returns the created summary on success.
   * Server-side conflicts (duplicate-after-slugify) bubble up via
   * the standard ApiError. */
  async create(input: api.CreateNoteInput): Promise<NoteSummary | null> {
    const vaultID = this.vaultID;
    if (vaultID == null) return null;
    const epoch = this.vaultEpoch;
    const created = await api.createNote(vaultID, input);
    if (epoch !== this.vaultEpoch) return created; // user left the vault
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
    const vaultID = this.vaultID;
    const id = this.selectedID;
    if (vaultID == null || id == null) return null;
    const epoch = this.vaultEpoch;
    const updated = await api.updateNote(vaultID, id, input);
    if (epoch !== this.vaultEpoch) return updated;
    this.list = this.list.map((n) => (n.id === updated.id ? updated : n));
    // Re-fetch content so the preview reflects the new body / FS-
    // round-tripped frontmatter — but only if the user is still on
    // that note, and only if no newer content fetch supersedes ours.
    if (
      (input.body != null || input.title != null || input.tags != null) &&
      this.selectedID === updated.id
    ) {
      const seq = ++this.contentSeq;
      this.abortContent();
      const ctrl = new AbortController();
      this.contentAbort = ctrl;
      try {
        const content = await api.getNoteContent(vaultID, updated.id, ctrl.signal);
        if (seq === this.contentSeq && epoch === this.vaultEpoch && this.selectedID === updated.id) {
          this.content = content;
        }
      } catch (e) {
        if (!isAbort(e)) throw e;
      } finally {
        if (seq === this.contentSeq) this.contentAbort = null;
      }
    }
    return updated;
  }

  /** DELETE the focused note. Clears selection on success. */
  async deleteSelected(): Promise<void> {
    const vaultID = this.vaultID;
    const id = this.selectedID;
    if (vaultID == null || id == null) return;
    const epoch = this.vaultEpoch;
    await api.deleteNote(vaultID, id);
    if (epoch !== this.vaultEpoch) return;
    this.list = this.list.filter((n) => n.id !== id);
    if (this.selectedID === id) {
      this.contentSeq++;
      this.abortContent();
      this.selectedID = null;
      this.content = null;
      this.loadingContent = false;
    }
  }

  private abortList(): void {
    this.listAbort?.abort();
    this.listAbort = null;
  }

  private abortContent(): void {
    this.contentAbort?.abort();
    this.contentAbort = null;
  }
}

function isAbort(err: unknown): boolean {
  return (
    (err instanceof DOMException && err.name === 'AbortError') ||
    (err instanceof Error && err.name === 'AbortError')
  );
}

function describeError(err: unknown): string {
  if (err instanceof ApiError) return err.detail ?? err.code;
  if (err instanceof Error) return err.message;
  return 'Unknown error';
}

export const notes = new NotesStore();
