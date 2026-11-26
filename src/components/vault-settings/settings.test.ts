// The book settings modal's controller and formatting helpers (moved
// out of VaultSettingsModal.svelte); the modal's DOM is covered by
// federation-panel.svelte.test.ts.

import { describe, it, expect } from 'vitest';
import { ApiError, type FederationInvite, type Invite, type RemoteMember } from '../../lib/types.ts';
import { VaultSettingsController } from './settings.svelte.ts';
import {
  capsSummary, copyErrorText, fedErrorText, fedInviteStateLabel, fmtDate, inviteStateLabel, isInviteActive,
  memberErrorText, transferErrorText, defaultExpiresAtInputValue,
} from './format.ts';

const future = new Date(Date.now() + 86_400_000).toISOString();
const past = new Date(Date.now() - 86_400_000).toISOString();
const invite = (o: Partial<Invite>): Invite => ({ token: 't', url: 'u', role_id: 'r', max_uses: 1, use_count: 0, expires_at: future, revoked_at: null, ...o }) as Invite;

describe('format helpers', () => {
  it('invite state: revoked, exhausted, expired, active', () => {
    expect(inviteStateLabel(invite({ revoked_at: past }))).toBe('revoked');
    expect(inviteStateLabel(invite({ use_count: 1 }))).toBe('exhausted');
    expect(inviteStateLabel(invite({ expires_at: past }))).toBe('expired');
    expect(inviteStateLabel(invite({}))).toBe('active');
    expect(isInviteActive(invite({}))).toBe(true);
    expect(isInviteActive(invite({ use_count: 1 }))).toBe(false);
  });

  it('federation invite state', () => {
    const fi = (o: Partial<FederationInvite>) => ({ revoked: false, used: false, expires_at: future, ...o }) as FederationInvite;
    expect(fedInviteStateLabel(fi({ revoked: true }))).toBe('revoked');
    expect(fedInviteStateLabel(fi({ used: true }))).toBe('used');
    expect(fedInviteStateLabel(fi({ expires_at: past }))).toBe('expired');
    expect(fedInviteStateLabel(fi({}))).toBe('active');
  });

  it('error text is friendly for the known codes', () => {
    expect(memberErrorText(new ApiError(409, { error: 'owner_protected' }))).toMatch(/Transfer ownership first/);
    expect(transferErrorText(new ApiError(403, { error: 'forbidden' }))).toBe('Only the vault owner can transfer ownership.');
    expect(copyErrorText(new ApiError(404, { error: 'recipient_not_found' }), 'bo')).toBe('No user named “@bo” on this server.');
    expect(fedErrorText(new ApiError(409, { error: 'conflict' }))).toBe('That federation link was already revoked.');
    expect(fedErrorText(new Error('net'))).toBe('net');
  });

  it('dates, caps and the default expiry', () => {
    expect(fmtDate('2026-11-26T10:20:30Z')).toBe('2026-11-26 10:20');
    expect(fmtDate(null)).toBe('—');
    expect(capsSummary([])).toBe('no permissions');
    expect(capsSummary(['*'])).toBe('every permission');
    expect(capsSummary(['note.read'])).toBe('note.read');
    expect(capsSummary(['a', 'b'])).toBe('2 permissions');
    expect(defaultExpiresAtInputValue()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });
});

describe('VaultSettingsController.dismiss (Esc)', () => {
  it('closes the topmost layer first, then reports nothing open', () => {
    const s = new VaultSettingsController();
    const m = { user_id: 'u2', username: 'bo' } as RemoteMember;
    s.pendingRemove = m;
    s.pendingTransfer = m;
    s.roleEditorOpen = true;
    s.createOpen = true;
    s.fedInviteOpen = true;
    const order: string[] = [];
    while (s.dismiss()) {
      order.push(
        s.pendingRemove ? 'x' : s.pendingTransfer ? 'remove' : s.roleEditorOpen ? 'transfer' : s.createOpen ? 'role' : s.fedInviteOpen ? 'create' : 'fed',
      );
    }
    expect(order).toEqual(['remove', 'transfer', 'role', 'create', 'fed']);
    expect(s.dismiss()).toBe(false);
  });

  it('closing the role editor clears its error', () => {
    const s = new VaultSettingsController();
    s.openCreateRole();
    s.roleEditorError = 'bad';
    expect(s.dismiss()).toBe(true);
    expect(s.roleEditorOpen).toBe(false);
    expect(s.roleEditorError).toBeNull();
  });

  it('toggleCap replaces the set (reactive) and round-trips', () => {
    const s = new VaultSettingsController();
    const before = s.roleEditorCaps;
    s.toggleCap('note.read');
    expect(s.roleEditorCaps).not.toBe(before);
    expect([...s.roleEditorCaps]).toEqual(['note.read']);
    s.toggleCap('note.read');
    expect(s.roleEditorCaps.size).toBe(0);
  });
});
