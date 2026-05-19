// @vitest-environment jsdom
//
// Tests for the invite-accept paths added to AuthStore in the 4.x
// slice. We mock the api module so the round-trip stays pure logic.
// crypto.ts stays real (works in jsdom) so the localStorage-encrypt
// path is exercised — that's also security-critical and was already
// covered by crypto.test.ts.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./api.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api.ts')>();
  return {
    ...actual,
    setToken: vi.fn(),
    getToken: vi.fn(() => null),
    me: vi.fn(),
    acceptInviteWithSignup: vi.fn(),
    acceptInviteAsCurrentUser: vi.fn(),
  };
});

import { auth } from './auth.svelte.ts';
import * as api from './api.ts';
import { ApiError } from './types.ts';

beforeEach(() => {
  localStorage.clear();
  // Reset the singleton's reactive state to a known baseline. The
  // store doesn't expose a reset() so we poke at the public fields.
  auth.user = null;
  auth.expiresAt = null;
  auth.lastError = null;
  vi.clearAllMocks();
});

describe('AuthStore.signUpViaInvite', () => {
  it('completes the round-trip: accept → setToken → me → acceptSession', async () => {
    vi.mocked(api.acceptInviteWithSignup).mockResolvedValueOnce({
      token: 'tk-abc',
      expires_at: '2026-12-31T00:00:00Z',
      vault: { id: 'v9', slug: 'demo', name: 'Demo' },
    });
    vi.mocked(api.me).mockResolvedValueOnce({
      id: 'u9',
      username: 'invited',
      display_name: 'Invited',
    });

    const out = await auth.signUpViaInvite('inv-token-123', {
      username: 'invited',
      password: 'pw',
      display_name: 'Invited',
    });

    expect(out.vaultID).toBe('v9');
    expect(api.setToken).toHaveBeenCalledWith('tk-abc');
    expect(api.me).toHaveBeenCalled();
    expect(auth.user?.username).toBe('invited');
    expect(auth.expiresAt).toBe('2026-12-31T00:00:00Z');
    // Persisted session should be in localStorage (encrypted; we don't
    // crack it open here — crypto.test.ts already covers that layer).
    expect(localStorage.getItem('lumi.v2.session')).not.toBeNull();
  });

  it('surfaces invite_expired error to lastError and rethrows', async () => {
    vi.mocked(api.acceptInviteWithSignup).mockRejectedValueOnce(
      new ApiError(410, { error: 'invite_expired' }),
    );
    await expect(
      auth.signUpViaInvite('exp', { username: 'x', password: 'y', display_name: 'X' }),
    ).rejects.toBeInstanceOf(ApiError);
    expect(auth.lastError).toBe('This invite has expired. Ask for a new one.');
    expect(auth.user).toBeNull();
  });
});

describe('AuthStore.acceptInvite (already signed in)', () => {
  it('returns the vault id and leaves the session untouched', async () => {
    // Pretend we're already signed in.
    auth.user = { id: 'u1', username: 'alice', display_name: 'Alice' };
    auth.expiresAt = '2026-12-31T00:00:00Z';

    vi.mocked(api.acceptInviteAsCurrentUser).mockResolvedValueOnce({
      vault: { id: 'v5', slug: 'team', name: 'Team' },
    });

    const out = await auth.acceptInvite('inv-token-456');
    expect(out.vaultID).toBe('v5');
    expect(api.setToken).not.toHaveBeenCalled();
    expect(auth.user?.username).toBe('alice');
  });

  it('surfaces invite_revoked into lastError', async () => {
    auth.user = { id: 'u1', username: 'alice', display_name: 'Alice' };
    vi.mocked(api.acceptInviteAsCurrentUser).mockRejectedValueOnce(
      new ApiError(410, { error: 'invite_revoked' }),
    );
    await expect(auth.acceptInvite('bad')).rejects.toBeInstanceOf(ApiError);
    expect(auth.lastError).toBe('This invite was revoked.');
  });
});
