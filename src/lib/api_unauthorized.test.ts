// @vitest-environment jsdom
//
// Global 401 handling: any token-bearing request that answers 401 /
// token_expired must clear the session (via the auth store's
// registered handler) so the app falls back to the login view.
// Anonymous requests and late 401s for a rotated token must not.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as api from './api.ts';
import { auth } from './auth.svelte.ts';
import { ApiError } from './types.ts';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  api.setToken(null);
  auth.user = null;
  auth.lastError = null;
});

describe('api.request global 401 handling', () => {
  it('clears the auth session on 401 from a token-bearing request', async () => {
    api.setToken('tk-1');
    auth.user = { id: 'u1', username: 'ana', display_name: 'Ana' } as any;
    localStorage.setItem('lumi.v2.session', 'encrypted-blob');
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { error: 'token_expired' }));

    await expect(api.listVaults()).rejects.toBeInstanceOf(ApiError);

    expect(auth.user).toBeNull();
    expect(api.getToken()).toBeNull();
    expect(localStorage.getItem('lumi.v2.session')).toBeNull();
    expect(auth.lastError).toMatch(/expired/i);
  });

  it('does not fire for anonymous requests (bad login credentials)', async () => {
    const handler = vi.fn();
    api.onUnauthorized(handler);
    try {
      api.setToken('tk-1');
      fetchMock.mockResolvedValueOnce(jsonResponse(401, { error: 'invalid_credentials' }));
      await expect(api.login('ana', 'wrong')).rejects.toBeInstanceOf(ApiError);
      expect(handler).not.toHaveBeenCalled();
      expect(api.getToken()).toBe('tk-1');
    } finally {
      api.onUnauthorized(() => auth.handleSessionLost());
    }
  });

  it('ignores a late 401 for a token that was already rotated', async () => {
    const handler = vi.fn();
    api.onUnauthorized(handler);
    try {
      api.setToken('old');
      let resolve!: (r: Response) => void;
      fetchMock.mockReturnValueOnce(new Promise<Response>((r) => (resolve = r)));
      const p = api.listVaults();
      api.setToken('new'); // user signed in again meanwhile
      resolve(jsonResponse(401, { error: 'unauthorized' }));
      await expect(p).rejects.toBeInstanceOf(ApiError);
      expect(handler).not.toHaveBeenCalled();
    } finally {
      api.onUnauthorized(() => auth.handleSessionLost());
    }
  });

  it('does not fire on 403 capability errors', async () => {
    const handler = vi.fn();
    api.onUnauthorized(handler);
    try {
      api.setToken('tk');
      fetchMock.mockResolvedValueOnce(jsonResponse(403, { error: 'capability_missing' }));
      await expect(api.listVaults()).rejects.toBeInstanceOf(ApiError);
      expect(handler).not.toHaveBeenCalled();
    } finally {
      api.onUnauthorized(() => auth.handleSessionLost());
    }
  });
});
