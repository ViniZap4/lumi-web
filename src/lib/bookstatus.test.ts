// Table-driven test for bookStatus (SPEC-LIVROS §4). Cases live in a
// JSON fixture whose `spec_table` is copied verbatim from the spec and
// is shared with the Apple and TUI clients.

import { describe, it, expect } from 'vitest';
import cases from '../test/fixtures/bookstatus.cases.json';
import { bookStatus, type BookSyncState } from './bookstatus.ts';

type AnyObj = Record<string, any>;
const d = cases.defaults as AnyObj;

function input(c: AnyObj, key: string): any {
  if (key in c && c[key] === null) return null;
  return { ...d[key], ...(c[key] ?? {}) };
}

describe('bookStatus — spec table', () => {
  it('fixture carries the 7 spec states in precedence order', () => {
    expect(cases.spec_table.map((r) => r.estado)).toEqual([
      '**Não ligado** / Local',
      '**Precisa entrar** / Sign in',
      '**Erro** / Error',
      '**Offline**',
      '**Sincronizando** / Syncing',
      '**Somente leitura** / Read-only',
      '**Atualizado** / Up to date',
    ]);
  });

  for (const c of cases.cases as AnyObj[]) {
    it(c.name, () => {
      const out = bookStatus(
        input(c, 'book'),
        input(c, 'accountFeed'),
        input(c, 'catchUp'),
        input(c, 'editor'),
        input(c, 'restHealth'),
      );
      expect(out.state).toBe(c.expect as BookSyncState);
    });
  }

  it('every state is covered by at least one case', () => {
    const covered = new Set((cases.cases as AnyObj[]).map((c) => c.expect));
    for (const s of ['not_bound', 'needs_login', 'error', 'offline', 'syncing', 'read_only', 'up_to_date']) {
      expect(covered.has(s)).toBe(true);
    }
  });

  it('error carries a readable reason', () => {
    const out = bookStatus(
      { ...d.book, revoked: 'removed' }, d.accountFeed, d.catchUp, d.editor, d.restHealth,
    );
    expect(out.reason).toMatch(/removido/);
  });
});

// Web-only: the "Pendente" qualifier. It is NOT a state (the shared
// fixture keeps its seven states and 31 cases untouched); it rides on
// BookStatus.pending so Offline — which wins precedence — can still
// say that local edits are waiting.
describe('bookStatus — pending qualifier (web)', () => {
  const run = (over: AnyObj) =>
    bookStatus(
      { ...d.book, ...(over.book ?? {}) },
      'accountFeed' in over ? over.accountFeed : d.accountFeed,
      { ...d.catchUp, ...(over.catchUp ?? {}) },
      { ...d.editor, ...(over.editor ?? {}) },
      { ...d.restHealth, ...(over.restHealth ?? {}) },
    );

  it('the shared fixture still has its 31 cases', () => {
    expect(cases.cases).toHaveLength(31);
  });

  it('offline with unsent edits → state offline, pending true', () => {
    const out = run({ restHealth: { last: 'network', nonTransientFailures: 0 }, editor: { state: 'OFFLINE', pending: true } });
    expect(out).toMatchObject({ state: 'offline', pending: true });
  });

  it('feed open with unsent edits → syncing, pending true', () => {
    expect(run({ editor: { state: 'closed', pending: true } })).toMatchObject({ state: 'syncing', pending: true });
  });

  it('never pending for local books or when the user must sign in', () => {
    expect(run({ book: { kind: 'local', vault_id: null }, accountFeed: null, editor: { state: 'OFFLINE', pending: true } }).pending).toBe(false);
    expect(run({ accountFeed: { state: 'auth_dead' }, editor: { state: 'OFFLINE', pending: true } }).pending).toBe(false);
  });

  it('nothing pending → pending false', () => {
    expect(run({})).toMatchObject({ state: 'up_to_date', pending: false });
  });
});
