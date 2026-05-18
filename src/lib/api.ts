// v2 API client. Token-bearing, vault-scoped, server-error-aware.
//
// Token management lives in lib/auth.svelte.ts. This module is a pure
// transport — it asks `getToken()` from the auth module on every
// request so token rotation (logout, register, accept-invite) is
// transparent.
//
// Every non-2xx response is decoded as a ServerError and thrown as
// an ApiError. Callers `try/catch` and read `err.code` /
// `err.capability` to drive UI.

import {
  ApiError,
  type Vault,
  type SessionResponse,
  type SessionUser,
  type NoteSummary,
  type NoteContent,
  type NoteSnapshot,
  type RemoteRole,
  type RemoteMember,
  type ServerError,
} from './types.ts';

export const API_URL: string =
  import.meta.env.VITE_LUMI_SERVER_URL || 'http://localhost:8080';

// Token holder. The auth module sets/clears it; we never persist
// here. Keeping a module-level variable lets fetch wrappers stay
// synchronous and avoids re-resolving a store on every request.
let token: string | null = null;
export function setToken(t: string | null): void {
  token = t;
}
export function getToken(): string | null {
  return token;
}

// ---- core request helper ---------------------------------------------------

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

interface RequestOpts {
  method?: Method;
  body?: unknown;
  signal?: AbortSignal;
  // Skip the X-Lumi-Token header (used for public endpoints like
  // /auth/login and /invites/:token/accept).
  anonymous?: boolean;
}

async function request<T>(path: string, opts: RequestOpts = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (!opts.anonymous && token) {
    headers['X-Lumi-Token'] = token;
  }
  const res = await fetch(`${API_URL}${path}`, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body != null ? JSON.stringify(opts.body) : undefined,
    signal: opts.signal,
  });

  if (res.status === 204) {
    return undefined as T;
  }

  // Try to parse JSON in all cases — error responses use the same
  // envelope shape — but tolerate empty bodies.
  let payload: unknown = null;
  const ct = res.headers.get('content-type') ?? '';
  if (ct.includes('application/json')) {
    try {
      payload = await res.json();
    } catch {
      // empty or malformed JSON; treat as null
    }
  }

  if (!res.ok) {
    const errBody: ServerError =
      (payload as ServerError | null) ?? { error: 'unknown', detail: res.statusText };
    throw new ApiError(res.status, errBody);
  }
  return payload as T;
}

// ---- auth ------------------------------------------------------------------

export async function login(username: string, password: string): Promise<SessionResponse> {
  return request<SessionResponse>('/api/auth/login', {
    method: 'POST',
    body: { username, password },
    anonymous: true,
  });
}

export interface RegisterInput {
  username: string;
  password: string;
  display_name: string;
  consent?: {
    tos_version: string;
    privacy_version: string;
    accepted_at: string;
  };
}

export async function register(input: RegisterInput): Promise<SessionResponse> {
  return request<SessionResponse>('/api/auth/register', {
    method: 'POST',
    body: input,
    anonymous: true,
  });
}

export async function logout(): Promise<void> {
  await request<void>('/api/auth/logout', { method: 'POST' });
}

export async function me(): Promise<SessionUser> {
  // /api/users/me returns the user payload directly.
  return request<SessionUser>('/api/users/me');
}

// ---- vaults ----------------------------------------------------------------

export async function listVaults(): Promise<Vault[]> {
  const out = await request<{ vaults: Vault[] }>('/api/vaults');
  return out.vaults ?? [];
}

export async function getVault(id: string): Promise<Vault> {
  return request<Vault>(`/api/vaults/${id}`);
}

export async function listVaultRoles(vaultID: string): Promise<RemoteRole[]> {
  const out = await request<{ roles: RemoteRole[] }>(`/api/vaults/${vaultID}/roles`);
  return out.roles ?? [];
}

export async function listVaultMembers(vaultID: string): Promise<RemoteMember[]> {
  const out = await request<{ members: RemoteMember[] }>(`/api/vaults/${vaultID}/members`);
  return out.members ?? [];
}

// ---- notes -----------------------------------------------------------------

export interface ListNotesOpts {
  limit?: number;
  offset?: number;
}

export async function listNotes(
  vaultID: string,
  opts: ListNotesOpts = {},
): Promise<{ notes: NoteSummary[]; limit: number; offset: number }> {
  const qs = new URLSearchParams();
  if (opts.limit != null) qs.set('limit', String(opts.limit));
  if (opts.offset != null) qs.set('offset', String(opts.offset));
  const q = qs.toString();
  return request(`/api/vaults/${vaultID}/notes${q ? '?' + q : ''}`);
}

export async function getNote(vaultID: string, noteID: string): Promise<NoteSummary> {
  return request(`/api/vaults/${vaultID}/notes/${encodeURIComponent(noteID)}`);
}

export async function getNoteContent(vaultID: string, noteID: string): Promise<NoteContent> {
  return request(`/api/vaults/${vaultID}/notes/${encodeURIComponent(noteID)}/content`);
}

export interface CreateNoteInput {
  title: string;
  body?: string;
  tags?: string[];
}

export async function createNote(vaultID: string, input: CreateNoteInput): Promise<NoteSummary> {
  return request(`/api/vaults/${vaultID}/notes`, { method: 'POST', body: input });
}

export interface UpdateNoteInput {
  title?: string;
  body?: string;
  path?: string;
  tags?: string[];
}

export async function updateNote(
  vaultID: string,
  noteID: string,
  input: UpdateNoteInput,
): Promise<NoteSummary> {
  return request(`/api/vaults/${vaultID}/notes/${encodeURIComponent(noteID)}`, {
    method: 'PATCH',
    body: input,
  });
}

export async function deleteNote(vaultID: string, noteID: string): Promise<void> {
  await request<void>(`/api/vaults/${vaultID}/notes/${encodeURIComponent(noteID)}`, {
    method: 'DELETE',
  });
}

export async function getNoteSnapshot(vaultID: string, noteID: string): Promise<NoteSnapshot> {
  return request(`/api/vaults/${vaultID}/notes/${encodeURIComponent(noteID)}/snapshot`);
}

export async function applyNoteDiff(
  vaultID: string,
  noteID: string,
  text: string,
  baseClock?: string,
): Promise<NoteSnapshot> {
  return request(`/api/vaults/${vaultID}/notes/${encodeURIComponent(noteID)}/diff`, {
    method: 'POST',
    body: { text, base_clock: baseClock, origin: 'web' },
  });
}
