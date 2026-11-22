// App boot: load accounts (+ migrate the legacy single session), load
// the books registry, install API routing, start one feed per account
// and refresh every account's vault list in the background.

import { accounts } from './accounts.svelte.ts';
import { books } from './books.svelte.ts';
import { sync } from './sync.svelte.ts';
import { auth } from './auth.svelte.ts';

let booted: Promise<void> | null = null;

export function boot(): Promise<void> {
  if (!booted) {
    booted = (async () => {
      try {
        await accounts.init();
        await books.init();
        sync.start();
        // Validate sessions + discover books without blocking first
        // paint: a 401 here marks only that account "Precisa entrar".
        void books.refreshAll();
      } finally {
        auth.initialising = false;
      }
    })();
  }
  return booted;
}
