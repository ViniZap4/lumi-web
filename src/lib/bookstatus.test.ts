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
