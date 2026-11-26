// Formatting and error text for the book settings modal.

import { ApiError, type FederationInvite, type Invite } from '../../lib/types.ts';

export function defaultExpiresAtInputValue(): string {
  // 7 days from now, formatted for <input type="datetime-local">
  // which expects local time without a Z suffix.
  const d = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function memberErrorText(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === 'owner_protected') {
      return 'The vault owner can’t be removed or demoted below Admin. Transfer ownership first.';
    }
    return e.detail ?? e.code;
  }
  return (e as Error).message;
}

export function transferErrorText(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 403) return 'Only the vault owner can transfer ownership.';
    switch (e.code) {
      case 'user_id_required':
        return 'Pick a member to transfer ownership to.';
      case 'validation':
        return 'That user isn’t a member of this vault.';
      default:
        return e.detail ?? e.code;
    }
  }
  return (e as Error).message;
}

export function copyErrorText(e: unknown, recipient: string): string {
  if (e instanceof ApiError) {
    switch (e.code) {
      case 'recipient_not_found':
        return `No user named “@${recipient}” on this server.`;
      case 'recipient_username_required':
        return 'Enter the recipient’s username.';
      case 'capability_missing':
        return 'You don’t have permission to export this vault.';
      default:
        return e.detail ?? e.code;
    }
  }
  return (e as Error).message;
}

export function fedErrorText(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === 'capability_missing' || e.code === 'forbidden') {
      return 'You don’t have permission for that action.';
    }
    if (e.code === 'conflict') {
      return 'That federation link was already revoked.';
    }
    return e.detail ?? e.code;
  }
  return (e as Error).message;
}

export function fedInviteStateLabel(i: FederationInvite): string {
  if (i.revoked) return 'revoked';
  if (i.used) return 'used';
  if (i.expires_at && new Date(i.expires_at).getTime() <= Date.now()) return 'expired';
  return 'active';
}

export function isFedInviteActive(i: FederationInvite): boolean {
  return fedInviteStateLabel(i) === 'active';
}

export function fmtDate(s: string | null | undefined): string {
  if (!s) return '—';
  return s.replace('T', ' ').slice(0, 16);
}

export function isInviteActive(i: Invite): boolean {
  if (i.revoked_at) return false;
  if (i.use_count >= i.max_uses) return false;
  return new Date(i.expires_at).getTime() > Date.now();
}

export function inviteStateLabel(i: Invite): string {
  if (i.revoked_at) return 'revoked';
  if (i.use_count >= i.max_uses) return 'exhausted';
  if (new Date(i.expires_at).getTime() <= Date.now()) return 'expired';
  return 'active';
}

export function capsSummary(caps: string[]): string {
  if (caps.length === 0) return 'no permissions';
  if (caps.includes('*')) return 'every permission';
  if (caps.length === 1) return caps[0];
  return `${caps.length} permissions`;
}
