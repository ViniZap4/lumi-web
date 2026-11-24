// Remote activity pulses (SPEC-PARTE2 §1, "a sync dot that pulses on a
// remote change"). Whoever sees a change made elsewhere — the account
// feed advancing a book's head, a remote Yjs transaction in an open
// editor — bumps the book's counter; SyncDot pulses when it grows.
// A per-vault counter, nothing else: no content, no identities.

class RemoteActivity {
  private counts = $state<Record<string, number>>({});

  /** A change made elsewhere reached `vaultID`. */
  bump(vaultID: string | null | undefined): void {
    if (!vaultID) return;
    this.counts = { ...this.counts, [vaultID]: (this.counts[vaultID] ?? 0) + 1 };
  }

  /** Reactive counter for `vaultID` (0 until something happens). */
  tick(vaultID: string | null | undefined): number {
    return vaultID ? (this.counts[vaultID] ?? 0) : 0;
  }

  reset(): void {
    this.counts = {};
  }
}

export const remoteActivity = new RemoteActivity();
