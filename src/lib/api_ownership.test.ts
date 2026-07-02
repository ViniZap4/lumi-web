// Tests for the v3 Phase O API helpers — transferOwnership and
// copyVault — plus the ApiError `message`-field normalisation the
// owner_protected envelope relies on. Unlike the store suites (which
// mock api.ts), these exercise the real request helper with a stubbed
// global fetch so the URL / method / body / header wiring and the
// error decoding are what's under test.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as api from './api.ts';
import { ApiError, type Vault } from './types.ts';

const fetchMock = vi.fn();

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: `status ${status}`,
    headers: { get: (k: string) => (k.toLowerCase() === 'content-type' ? 'application/json' : null) },
    json: async () => body,
  } as unknown as Response;
}

const forkVault: Vault = {
  id: 'v-fork',
  slug: 'work-copy',
  name: 'Work',
  created_by: 'u-alice',
  created_at: '2026-07-02T00:00:00Z',
  owner_user_id: 'u-bob',
  copied_from: {
    vault_id: 'v1',
    slug: 'work',
    copied_by: 'u-alice',
    copied_at: '2026-07-02T00:00:00Z',
  },
};

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  api.setToken('tk-test');
});

afterEach(() => {
  api.setToken(null);
  vi.unstubAllGlobals();
});

describe('api.transferOwnership', () => {
  it('POSTs {user_id} to /transfer-ownership with the session token', async () => {
    const owned: Vault = { ...forkVault, id: 'v1', slug: 'work', copied_from: undefined };
    fetchMock.mockResolvedValueOnce(jsonResponse(200, owned));

    const out = await api.transferOwnership('v1', 'u-bob');
    expect(out.owner_user_id).toBe('u-bob');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${api.API_URL}/api/vaults/v1/transfer-ownership`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ user_id: 'u-bob' });
    expect(init.headers['X-Lumi-Token']).toBe('tk-test');
  });

  it('decodes 400 validation (target not a member) into ApiError', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(400, { error: 'validation' }));
    await expect(api.transferOwnership('v1', 'u-ghost')).rejects.toMatchObject({
      status: 400,
      code: 'validation',
    });
  });

  it('decodes 400 user_id_required into ApiError', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(400, { error: 'user_id_required' }));
    await expect(api.transferOwnership('v1', '')).rejects.toMatchObject({
      status: 400,
      code: 'user_id_required',
    });
  });

  it('decodes 403 (caller is not the owner) into ApiError', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(403, { error: 'forbidden' }));
    await expect(api.transferOwnership('v1', 'u-bob')).rejects.toMatchObject({
      status: 403,
    });
  });
});

describe('api.copyVault', () => {
  it('POSTs {recipient_username} to /copies and returns the fork DTO', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(201, forkVault));

    const out = await api.copyVault('v1', 'bob');
    expect(out.id).toBe('v-fork');
    expect(out.copied_from?.slug).toBe('work');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${api.API_URL}/api/vaults/v1/copies`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ recipient_username: 'bob' });
  });

  it('decodes 400 recipient_not_found into ApiError', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(400, { error: 'recipient_not_found' }));
    await expect(api.copyVault('v1', 'ghost')).rejects.toMatchObject({
      status: 400,
      code: 'recipient_not_found',
    });
  });

  it('decodes 400 recipient_username_required into ApiError', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(400, { error: 'recipient_username_required' }));
    await expect(api.copyVault('v1', '')).rejects.toMatchObject({
      code: 'recipient_username_required',
    });
  });
});

describe('owner_protected envelope (message field)', () => {
  it('normalises {error, message} into ApiError.detail', async () => {
    // Member removal / role-change can now 409 with a `message` field
    // instead of `detail` — the constructor must pick it up so inline
    // error rendering (e.detail ?? e.code) shows the human text.
    fetchMock.mockResolvedValueOnce(
      jsonResponse(409, {
        error: 'owner_protected',
        message: 'the vault owner cannot be removed',
      }),
    );
    const err = await api.removeMember('v1', 'u-owner').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(409);
    expect(err.code).toBe('owner_protected');
    expect(err.detail).toBe('the vault owner cannot be removed');
    expect(err.message).toBe('the vault owner cannot be removed');
  });
});
