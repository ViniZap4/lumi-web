// Tests for the v3 federation API helpers — invite lifecycle,
// federation list/revoke, join, and federated-member CRUD. Like
// api_ownership.test.ts these exercise the real request helper with a
// stubbed global fetch, so the URL / method / body / header wiring
// and the error decoding are what's under test.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as api from './api.ts';
import { ApiError, type Federation, type FederationInvite } from './types.ts';

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

function emptyResponse(status: number): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: `status ${status}`,
    headers: { get: () => null },
  } as unknown as Response;
}

const sampleInvite: FederationInvite = {
  token: 'fed-tok-1',
  vault_id: 'v1',
  server_url_hint: 'https://follower.example',
  expires_at: '2026-08-01T00:00:00Z',
  created_at: '2026-07-02T00:00:00Z',
  used: false,
  revoked: false,
};

const sampleFederation: Federation = {
  id: 'fed-1',
  vault_id: 'v1',
  role: 'home',
  peer_url: 'https://follower.example',
  status: 'active',
  last_acked_seq: 41,
  jurisdiction: 'BR',
  created_at: '2026-07-02T00:00:00Z',
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

describe('api.createFederationInvite', () => {
  it('POSTs the input to /federation-invites with the session token', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(201, sampleInvite));

    const out = await api.createFederationInvite('v1', {
      server_url_hint: 'https://follower.example',
      expires_at: '2026-08-01T00:00:00Z',
    });
    expect(out.token).toBe('fed-tok-1');
    expect(out.used).toBe(false);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${api.API_URL}/api/vaults/v1/federation-invites`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({
      server_url_hint: 'https://follower.example',
      expires_at: '2026-08-01T00:00:00Z',
    });
    expect(init.headers['X-Lumi-Token']).toBe('tk-test');
  });

  it('decodes 403 capability_missing into ApiError', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(403, { error: 'capability_missing', capability: 'vault.federate' }),
    );
    await expect(api.createFederationInvite('v1', {})).rejects.toMatchObject({
      status: 403,
      code: 'capability_missing',
      capability: 'vault.federate',
    });
  });
});

describe('api.listFederationInvites', () => {
  it('GETs /federation-invites and unwraps {invites}', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { invites: [sampleInvite] }));
    const out = await api.listFederationInvites('v1');
    expect(out).toHaveLength(1);
    expect(out[0].token).toBe('fed-tok-1');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${api.API_URL}/api/vaults/v1/federation-invites`);
    expect(init.method).toBe('GET');
  });

  it('tolerates a null invites field', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { invites: null }));
    await expect(api.listFederationInvites('v1')).resolves.toEqual([]);
  });
});

describe('api.revokeFederationInvite', () => {
  it('DELETEs /federation-invites/:token with encoding', async () => {
    fetchMock.mockResolvedValueOnce(emptyResponse(204));
    await api.revokeFederationInvite('v1', 'tok/with slash');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      `${api.API_URL}/api/vaults/v1/federation-invites/${encodeURIComponent('tok/with slash')}`,
    );
    expect(init.method).toBe('DELETE');
  });
});

describe('api.listFederations', () => {
  it('GETs /federations and unwraps {federations}', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { federations: [sampleFederation] }));
    const out = await api.listFederations('v1');
    expect(out).toHaveLength(1);
    expect(out[0].role).toBe('home');
    expect(out[0].last_acked_seq).toBe(41);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${api.API_URL}/api/vaults/v1/federations`);
    expect(init.method).toBe('GET');
  });
});

describe('api.revokeFederation', () => {
  it('DELETEs /federations/:id', async () => {
    fetchMock.mockResolvedValueOnce(emptyResponse(204));
    await api.revokeFederation('v1', 'fed-1');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${api.API_URL}/api/vaults/v1/federations/fed-1`);
    expect(init.method).toBe('DELETE');
  });

  it('decodes 409 conflict (already revoked) into ApiError', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(409, { error: 'conflict' }));
    await expect(api.revokeFederation('v1', 'fed-1')).rejects.toMatchObject({
      status: 409,
      code: 'conflict',
    });
  });
});

describe('api.joinFederation', () => {
  it('POSTs {home_url, token, jurisdiction} to /api/federation/join', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(201, {
        vault: { id: 'v-replica', slug: 'work', name: 'Work' },
        federation: { ...sampleFederation, role: 'follower' },
      }),
    );

    const out = await api.joinFederation({
      home_url: 'https://home.example',
      token: 'fed-tok-1',
      jurisdiction: 'BR',
    });
    expect(out.vault.id).toBe('v-replica');
    expect(out.federation.role).toBe('follower');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${api.API_URL}/api/federation/join`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({
      home_url: 'https://home.example',
      token: 'fed-tok-1',
      jurisdiction: 'BR',
    });
    expect(init.headers['X-Lumi-Token']).toBe('tk-test');
  });

  it('decodes 400 validation into ApiError with message normalised', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(400, { error: 'validation', message: 'invite token expired' }),
    );
    const err = await api
      .joinFederation({ home_url: 'https://home.example', token: 'bad' })
      .catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe('validation');
    expect(err.detail).toBe('invite token expired');
  });
});

describe('api federated members', () => {
  it('GETs /federated-members and unwraps {federated_members}', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        federated_members: [
          {
            member_key: 'alice@https://follower.example',
            role_id: 'r1',
            role_name: 'Editor',
            joined_at: '2026-07-02T00:00:00Z',
          },
        ],
      }),
    );
    const out = await api.listFederatedMembers('v1');
    expect(out).toHaveLength(1);
    expect(out[0].member_key).toBe('alice@https://follower.example');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${api.API_URL}/api/vaults/v1/federated-members`);
    expect(init.method).toBe('GET');
  });

  it('POSTs {member_key, role_id} on add', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(201, {
        member_key: 'alice@https://follower.example',
        role_id: 'r1',
        role_name: 'Editor',
        joined_at: '2026-07-02T00:00:00Z',
      }),
    );
    await api.addFederatedMember('v1', 'alice@https://follower.example', 'r1');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${api.API_URL}/api/vaults/v1/federated-members`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({
      member_key: 'alice@https://follower.example',
      role_id: 'r1',
    });
  });

  it('PATCHes {member_key, role_id} on role change', async () => {
    fetchMock.mockResolvedValueOnce(emptyResponse(204));
    await api.updateFederatedMemberRole('v1', 'alice@https://follower.example', 'r2');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${api.API_URL}/api/vaults/v1/federated-members`);
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body)).toEqual({
      member_key: 'alice@https://follower.example',
      role_id: 'r2',
    });
  });

  it('DELETEs with {member_key} body on remove', async () => {
    fetchMock.mockResolvedValueOnce(emptyResponse(204));
    await api.removeFederatedMember('v1', 'alice@https://follower.example');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${api.API_URL}/api/vaults/v1/federated-members`);
    expect(init.method).toBe('DELETE');
    expect(JSON.parse(init.body)).toEqual({ member_key: 'alice@https://follower.example' });
  });

  it('decodes 400 validation (bad key / foreign role) into ApiError', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(400, { error: 'validation', message: 'malformed member_key' }),
    );
    await expect(api.addFederatedMember('v1', 'nope', 'r1')).rejects.toMatchObject({
      status: 400,
      code: 'validation',
      detail: 'malformed member_key',
    });
  });
});
