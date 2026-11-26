// Conflict copies (lineage mismatch / deleted note / revoked access):
// the local text that was never merged, offered for export or copy.

import { bundleMarkdown, downloadText, exportFilename } from '../../lib/offline.svelte.ts';
import type { ConflictCopy } from '../../lib/offline-store.ts';

export function exportConflict(c: ConflictCopy): void {
  downloadText(exportFilename([{ vaultID: c.vaultID, noteID: c.noteID, title: c.title, text: c.text }]), c.text);
}

export async function copyConflict(c: ConflictCopy): Promise<void> {
  try {
    await navigator.clipboard.writeText(c.text);
  } catch {
    exportConflict(c);
  }
}

export function exportAllConflicts(list: ConflictCopy[]): void {
  const items = list.map((c) => ({ vaultID: c.vaultID, noteID: c.noteID, title: c.title, text: c.text }));
  if (items.length) downloadText(exportFilename(items), bundleMarkdown(items));
}
