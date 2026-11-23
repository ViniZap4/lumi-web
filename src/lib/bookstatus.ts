// Per-book sync state (SPEC-LIVROS §4). ONE pure function, shared
// semantics with the Apple and TUI clients; the table-driven test in
// bookstatus.test.ts runs the same case file
// (src/test/fixtures/bookstatus.cases.json) the other clients copy.
//
// Precedence (first match wins):
//   Não ligado → Precisa entrar → Erro → Offline → Sincronizando
//   → Somente leitura → Atualizado.

import type { FeedState } from './feed.ts';

export type BookSyncState =
  | 'not_bound'
  | 'needs_login'
  | 'error'
  | 'offline'
  | 'syncing'
  | 'read_only'
  | 'up_to_date';

export interface BookInput {
  kind: 'local' | 'bound';
  vault_id: string | null;
  can_edit: boolean;
  /** `vault.revoked` reason (removed | deleted | severed_unreadable). */
  revoked: string | null;
}

/** null = no account for this book on this client, or no token. */
export type AccountFeedInput = { state: FeedState } | null;

export interface CatchUpInput {
  state: 'idle' | 'running' | 'failed';
  /** Consecutive failures (only meaningful when state = failed). */
  failures: number;
  reason?: string | null;
  cursor: number;
  head: number;
}

/** CRDT-CLIENT-PROTOCOL §2.1 states, plus `closed` = no editor open. */
export type EditorState = 'closed' | 'CONNECTING' | 'SYNCING' | 'LIVE' | 'OFFLINE' | 'CLOSED';

export interface EditorInput {
  state: EditorState;
  /** Local edits the server has not confirmed: the open editor's
   *  unsent edits, or persisted replicas of this book with unsent edits
   *  (web offline). */
  pending: boolean;
}

export interface RestHealthInput {
  /** Outcome of the last REST call for the account (null = none yet). */
  last: null | 'ok' | 'network' | 'auth' | 'server' | 'parse';
  /** Consecutive non-transient failures (5xx, invalid JSON). */
  nonTransientFailures: number;
  reason?: string | null;
}

export interface BookStatus {
  state: BookSyncState;
  reason: string | null;
  /** "Pendente" (SPEC-LIVROS §4.2): local edits not yet confirmed by
   *  the server. NOT an extra state — the §4.1 table has seven states
   *  and pending is an input to "Sincronizando". It is surfaced as a
   *  qualifier so a book that is Offline (which wins precedence) can
   *  still say that it holds unsent edits ("Offline · pendente").
   *  Always false for local books and when the user must sign in. */
  pending: boolean;
}

/** Failures in a row before a book shows "Erro" (§4.1). */
export const ERROR_THRESHOLD = 3;

const REVOKED_REASON: Record<string, string> = {
  removed: 'você foi removido deste livro',
  deleted: 'o livro foi excluído no servidor',
  severed_unreadable: 'este servidor perdeu a réplica do livro',
};

export function bookStatus(
  book: BookInput,
  accountFeed: AccountFeedInput,
  catchUp: CatchUpInput,
  editor: EditorInput,
  restHealth: RestHealthInput,
): BookStatus {
  const r = bookState(book, accountFeed, catchUp, editor, restHealth);
  const pending = editor.pending && r.state !== 'not_bound' && r.state !== 'needs_login';
  return { ...r, pending };
}

function bookState(
  book: BookInput,
  accountFeed: AccountFeedInput,
  catchUp: CatchUpInput,
  editor: EditorInput,
  restHealth: RestHealthInput,
): Omit<BookStatus, 'pending'> {
  // 1. Não ligado
  if (book.kind === 'local') return { state: 'not_bound', reason: null };

  // 2. Precisa entrar: no account/token here, 401, session.ended.
  if (accountFeed == null) return { state: 'needs_login', reason: 'sem sessão neste aparelho' };
  if (accountFeed.state === 'auth_dead' || restHealth.last === 'auth') {
    return { state: 'needs_login', reason: 'sessão expirada ou encerrada' };
  }

  // 3. Erro: null vault_id / revoked are immediate; transport errors
  //    after ERROR_THRESHOLD consecutive non-transient failures.
  if (book.vault_id == null) return { state: 'error', reason: 'ligação incompleta' };
  if (book.revoked != null) {
    return { state: 'error', reason: REVOKED_REASON[book.revoked] ?? `acesso revogado (${book.revoked})` };
  }
  if (catchUp.state === 'failed' && catchUp.failures >= ERROR_THRESHOLD) {
    return { state: 'error', reason: catchUp.reason ?? 'falha ao buscar mudanças' };
  }
  if (restHealth.nonTransientFailures >= ERROR_THRESHOLD) {
    return { state: 'error', reason: restHealth.reason ?? 'o servidor respondeu com erro' };
  }

  // 4. Offline: feed not open (connecting, backoff, disabled) or a
  //    network error on REST — no need to wait for the feed.
  if (restHealth.last === 'network') return { state: 'offline', reason: 'rede indisponível' };
  if (accountFeed.state !== 'open') {
    const reason =
      accountFeed.state === 'disabled'
        ? 'feed indisponível neste servidor'
        : accountFeed.state === 'connecting'
          ? 'conectando'
          : 'reconectando';
    return { state: 'offline', reason };
  }

  // 5. Sincronizando: feed open and something still in flight.
  const editorBusy =
    editor.state === 'CONNECTING' || editor.state === 'SYNCING' || editor.state === 'OFFLINE';
  if (catchUp.state === 'running' || catchUp.head > catchUp.cursor || editorBusy || editor.pending) {
    return { state: 'syncing', reason: null };
  }

  // 6/7. Up to date — locked when the account cannot edit.
  if (!book.can_edit) return { state: 'read_only', reason: null };
  return { state: 'up_to_date', reason: null };
}

/** Qualifier label for `pending` (pt-BR / en). */
export const PENDING_LABEL = { pt: 'Pendente', en: 'Pending' };

/** UI labels (pt-BR / en), §4.1. */
export const STATE_LABEL: Record<BookSyncState, { pt: string; en: string }> = {
  not_bound: { pt: 'Não ligado', en: 'Local' },
  needs_login: { pt: 'Precisa entrar', en: 'Sign in' },
  error: { pt: 'Erro', en: 'Error' },
  offline: { pt: 'Offline', en: 'Offline' },
  syncing: { pt: 'Sincronizando', en: 'Syncing' },
  read_only: { pt: 'Somente leitura', en: 'Read-only' },
  up_to_date: { pt: 'Atualizado', en: 'Up to date' },
};
