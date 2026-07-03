// Mirror of server/internal/domain/capability_test.go in spirit —
// any divergence here means the client pre-gates a button the server
// would deny (or vice versa).

import { describe, it, expect } from 'vitest';
import { hasCapability, CAPABILITY_CATALOGUE } from './capabilities.ts';

describe('hasCapability', () => {
  it('exact string matches itself', () => {
    expect(hasCapability(['note.edit'], 'note.edit')).toBe(true);
    expect(hasCapability(['note.edit'], 'note.read')).toBe(false);
  });

  it('"*" grants every capability', () => {
    expect(hasCapability(['*'], 'note.read')).toBe(true);
    expect(hasCapability(['*'], 'vault.manage')).toBe(true);
    expect(hasCapability(['*'], 'audit.read')).toBe(true);
  });

  it('"note.*" grants every note.X but not "note" alone', () => {
    expect(hasCapability(['note.*'], 'note.read')).toBe(true);
    expect(hasCapability(['note.*'], 'note.edit')).toBe(true);
    // Same shape on the server's Has(): length must EXCEED the prefix.
    expect(hasCapability(['note.*'], 'note.')).toBe(false);
    // Cross-namespace must not leak.
    expect(hasCapability(['note.*'], 'members.invite')).toBe(false);
  });

  it('"members.*" grants every members.X but no other namespace', () => {
    expect(hasCapability(['members.*'], 'members.manage')).toBe(true);
    expect(hasCapability(['members.*'], 'members.invite')).toBe(true);
    expect(hasCapability(['members.*'], 'note.read')).toBe(false);
  });

  it('similar-prefix decoys are rejected (anti-foot-gun)', () => {
    // A set granting "notebooks.*" must NOT match "note.read" just
    // because the strings share a prefix.
    expect(hasCapability(['notebooks.*'], 'note.read')).toBe(false);
  });

  it('multi-grant sets combine with OR semantics', () => {
    const set = ['note.read', 'members.invite'];
    expect(hasCapability(set, 'note.read')).toBe(true);
    expect(hasCapability(set, 'members.invite')).toBe(true);
    expect(hasCapability(set, 'members.manage')).toBe(false);
  });

  it('empty set grants nothing', () => {
    expect(hasCapability([], 'note.read')).toBe(false);
  });
});

describe('CAPABILITY_CATALOGUE', () => {
  it('exposes only concrete (non-wildcard) capabilities', () => {
    for (const c of CAPABILITY_CATALOGUE) {
      expect(c.id).not.toContain('*');
      expect(c.id).toMatch(/^[a-z]+\.[a-z]+$/);
    }
  });

  it('covers every concrete capability the server enforces', () => {
    // Must stay in sync with server/internal/domain/capability.go.
    const expected = new Set([
      'note.read', 'note.create', 'note.edit', 'note.delete', 'note.move',
      'members.invite', 'members.manage',
      'roles.manage',
      'vault.manage', 'vault.export', 'vault.federate',
      'audit.read',
    ]);
    const got = new Set(CAPABILITY_CATALOGUE.map((c) => c.id));
    expect(got).toEqual(expected);
  });
});
