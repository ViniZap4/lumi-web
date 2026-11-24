// v2 API client, one instance per account (SPEC-LIVROS W1).
//
// There is no global API_URL or global token any more. Every request
// runs through an `ApiClient` bound to exactly one account context:
// (server URL, token getter, account-scoped callbacks). A 401 on
// account A only notifies account A's handler — it can never drop the
// session of account B.
//
// The module-level helpers (`listNotes(vaultID, …)` etc.) are kept so
// stores and tests do not change shape. They do NOT use a "current
// token": vault-scoped calls are routed by vault id to the client of
// the account the book is bound to (the books registry guarantees at
// most one bound book per vault_id, §2.4). Account-level calls
// (listVaults, createVault, me, …) use the active book's account
// unless an explicit account key is passed. Routing is installed by
// the session layer via `setClientResolver`.
//
// Every non-2xx response is decoded as a ServerError and thrown as an
// ApiError. Callers `try/catch` and read `err.code` / `err.capability`.

import {
  ApiError,
  type Vault,
  type SessionResponse,
  type SessionUser,
  type NoteSummary,
  type NoteContent,
  type NoteFileKind,
  type NoteSnapshot,
  type NoteStateVector,
  type RemoteRole,
  type RemoteMember,
  type ServerError,
  type InviteAcceptSignupResponse,
  type InviteAcceptExistingResponse,
  type Invite,
  type InviteCreated,
  type Federation,
  type FederationInvite,
  type FederationJoinResponse,
  type FederatedMember,
  type ServerInfo,
  type ChangesResponse,
} from './types.ts';
import type { WsTicket } from './ws-ticket.ts';

/** Optional default/first server, baked at build time. Only used to
 *  prefill the "add server" form — never as an implicit target. */
export const DEFAULT_SERVER_URL: string | null =
  (import.meta.env.VITE_LUMI_SERVER_URL as string | undefined) || null;

/** True when an error means "the session is no longer valid". */
export function isAuthFailure(err: unknown): boolean {
  return (
    err instanceof ApiError &&
    (err.status === 401 || err.code === 'token_expired' || err.code === 'unauthorized')
  );
}

/** Network-level failure (DNS, offline, CORS, mixed content): fetch
 *  rejected before any HTTP status was available. */
export function isNetworkError(err: unknown): boolean {
  return err instanceof ApiError && err.status === 0 && err.code === 'network_error';
}

/** REST health classification fed into the sync-state reducer
 *  (restHealth, SPEC-LIVROS §4.2). */
export type RestOutcome = 'ok' | 'network' | 'auth' | 'server' | 'parse';

export interface AccountContext {
  /** Normalised server URL (lib/serverurl.ts). */
  serverUrl: string;
  /** Current token for this account (null = anonymous only). */
  getToken: () => string | null;
  /** Called when a request that carried the account's *current* token
   *  answered 401/token_expired. Never called for anonymous calls or
   *  for a late 401 of a token that was already rotated away. */
  onUnauthorized?: (err: ApiError) => void;
  /** Outcome of every token-bearing request (restHealth). */
  onOutcome?: (outcome: RestOutcome, err?: ApiError) => void;
  /** Injectable fetch (tests). Defaults to globalThis.fetch. */
  fetch?: typeof fetch;
}

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

export interface RequestOpts {
  method?: Method;
  body?: unknown;
  signal?: AbortSignal;
  /** Skip the token header (public endpoints: login, invite accept,
   *  /api/info). */
  anonymous?: boolean;
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

export interface CreateVaultInput {
  name: string;
  // Optional. Server auto-generates from name when omitted.
  slug?: string;
}

export interface CreateRoleInput {
  name: string;
  capabilities: string[];
}

export interface UpdateRoleInput {
  name?: string;
  capabilities?: string[];
}

export interface CreateInviteInput {
  role_id: string;
  max_uses: number;
  expires_at: string; // ISO 8601
  email_hint?: string;
}

export interface CreateFederationInviteInput {
  // Pin the invite to one follower server's URL (optional).
  server_url_hint?: string;
  // ISO 8601. Omitted = server default / no expiry.
  expires_at?: string;
}

export interface JoinFederationInput {
  home_url: string;
  token: string;
  // Operator-declared data-residency jurisdiction — shown to the
  // vault owner on the home server (LGPD residency notice).
  jurisdiction?: string;
}

export interface ListNotesOpts {
  limit?: number;
  offset?: number;
  signal?: AbortSignal;
}

export interface CreateNoteInput {
  title: string;
  body?: string;
  tags?: string[];
  /** `canvas` creates `<slug>.canvas` (empty body → empty canvas). */
  kind?: NoteFileKind;
}

export interface UpdateNoteInput {
  title?: string;
  body?: string;
  path?: string;
  tags?: string[];
}

const enc = encodeURIComponent;

export class ApiClient {
  readonly ctx: AccountContext;

  constructor(ctx: AccountContext) {
    this.ctx = ctx;
  }

  get serverUrl(): string {
    return this.ctx.serverUrl;
  }

  async request<T>(path: string, opts: RequestOpts = {}): Promise<T> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const sentToken = !opts.anonymous ? this.ctx.getToken() : null;
    if (sentToken) headers['X-Lumi-Token'] = sentToken;
    const doFetch = this.ctx.fetch ?? globalThis.fetch.bind(globalThis);
    const report = (o: RestOutcome, e?: ApiError) => {
      if (opts.anonymous) return;
      try {
        this.ctx.onOutcome?.(o, e);
      } catch {
        // health reporting must never mask the result
      }
    };

    let res: Response;
    try {
      res = await doFetch(`${this.ctx.serverUrl}${path}`, {
        method: opts.method ?? 'GET',
        headers,
        body: opts.body != null ? JSON.stringify(opts.body) : undefined,
        signal: opts.signal,
        // Tokens travel in a header only; never send ambient cookies
        // to user-added servers.
        credentials: 'omit',
      });
    } catch (e) {
      if (isAbortError(e)) throw e;
      const err = new ApiError(0, {
        error: 'network_error',
        detail: e instanceof Error ? e.message : 'network error',
      });
      report('network', err);
      throw err;
    }

    if (res.status === 204) {
      report('ok');
      return undefined as T;
    }

    // Try to parse JSON in all cases — error responses use the same
    // envelope shape — but tolerate empty bodies.
    let payload: unknown = null;
    let malformed = false;
    const ct = res.headers.get('content-type') ?? '';
    if (ct.includes('application/json')) {
      try {
        payload = await res.json();
      } catch {
        malformed = true;
      }
    }

    if (!res.ok) {
      const errBody: ServerError =
        (payload as ServerError | null) ?? { error: 'unknown', detail: res.statusText };
      const err = new ApiError(res.status, errBody);
      if (isAuthFailure(err)) {
        report('auth', err);
        // Only react to auth failures of requests that actually carried
        // this account's token — and only if that token is still the
        // current one (a late 401 for a rotated token must not log the
        // fresh session out).
        if (!opts.anonymous && sentToken != null && sentToken === this.ctx.getToken()) {
          try {
            this.ctx.onUnauthorized?.(err);
          } catch {
            // handler failures must not mask the original error
          }
        }
      } else if (res.status >= 500) {
        report('server', err);
      } else {
        // 4xx other than auth: a request-level problem, not ill health.
        report('ok');
      }
      throw err;
    }
    if (malformed) {
      const err = new ApiError(res.status, { error: 'invalid_json', detail: 'Resposta JSON inválida.' });
      report('parse', err);
      throw err;
    }
    report('ok');
    return payload as T;
  }

  // ---- server ------------------------------------------------------------

  /** Public server descriptor (SPEC-LIVROS §3.5). Old servers 404. */
  info(signal?: AbortSignal): Promise<ServerInfo> {
    return this.request<ServerInfo>('/api/info', { anonymous: true, signal });
  }

  // ---- auth --------------------------------------------------------------

  login(username: string, password: string): Promise<SessionResponse> {
    return this.request<SessionResponse>('/api/auth/login', {
      method: 'POST',
      body: { username, password },
      anonymous: true,
    });
  }

  register(input: RegisterInput): Promise<SessionResponse> {
    return this.request<SessionResponse>('/api/auth/register', {
      method: 'POST',
      body: input,
      anonymous: true,
    });
  }

  async logout(): Promise<void> {
    await this.request<void>('/api/auth/logout', { method: 'POST' });
  }

  // Accept an invite as a brand-new user. The response does NOT include
  // the SessionUser — callers fetch /me to populate it.
  acceptInviteWithSignup(token: string, signup: RegisterInput): Promise<InviteAcceptSignupResponse> {
    return this.request<InviteAcceptSignupResponse>(`/api/invites/${enc(token)}/accept`, {
      method: 'POST',
      body: signup,
      anonymous: true,
    });
  }

  // Accept an invite as this account. Session is unchanged.
  acceptInviteAsCurrentUser(token: string): Promise<InviteAcceptExistingResponse> {
    return this.request<InviteAcceptExistingResponse>(`/api/invites/${enc(token)}/accept`, {
      method: 'POST',
    });
  }

  me(): Promise<SessionUser> {
    return this.request<SessionUser>('/api/users/me');
  }

  // ---- vaults ------------------------------------------------------------

  async listVaults(): Promise<Vault[]> {
    const out = await this.request<{ vaults: Vault[] }>('/api/vaults');
    return out?.vaults ?? [];
  }

  getVault(id: string): Promise<Vault> {
    return this.request<Vault>(`/api/vaults/${id}`);
  }

  createVault(input: CreateVaultInput): Promise<Vault> {
    return this.request<Vault>('/api/vaults', { method: 'POST', body: input });
  }

  /** Rename for everyone (SPEC-LIVROS §2.3, needs vault.manage). */
  renameVault(id: string, name: string): Promise<Vault> {
    return this.request<Vault>(`/api/vaults/${id}`, { method: 'PATCH', body: { name } });
  }

  /** Incremental note changes (SPEC-LIVROS §3.5). 410 resync_required
   *  below the tombstone floor. */
  getChanges(id: string, after: number, limit = 500, signal?: AbortSignal): Promise<ChangesResponse> {
    return this.request<ChangesResponse>(
      `/api/vaults/${id}/changes?after=${after}&limit=${limit}`,
      { signal },
    );
  }

  transferOwnership(vaultID: string, userID: string): Promise<Vault> {
    return this.request<Vault>(`/api/vaults/${vaultID}/transfer-ownership`, {
      method: 'POST',
      body: { user_id: userID },
    });
  }

  copyVault(vaultID: string, recipientUsername: string): Promise<Vault> {
    return this.request<Vault>(`/api/vaults/${vaultID}/copies`, {
      method: 'POST',
      body: { recipient_username: recipientUsername },
    });
  }

  async listVaultRoles(vaultID: string): Promise<RemoteRole[]> {
    const out = await this.request<{ roles: RemoteRole[] }>(`/api/vaults/${vaultID}/roles`);
    return out?.roles ?? [];
  }

  createRole(vaultID: string, input: CreateRoleInput): Promise<RemoteRole> {
    return this.request<RemoteRole>(`/api/vaults/${vaultID}/roles`, { method: 'POST', body: input });
  }

  updateRole(vaultID: string, roleID: string, input: UpdateRoleInput): Promise<RemoteRole> {
    return this.request<RemoteRole>(`/api/vaults/${vaultID}/roles/${enc(roleID)}`, {
      method: 'PATCH',
      body: input,
    });
  }

  async deleteRole(vaultID: string, roleID: string): Promise<void> {
    await this.request<void>(`/api/vaults/${vaultID}/roles/${enc(roleID)}`, { method: 'DELETE' });
  }

  async listVaultMembers(vaultID: string): Promise<RemoteMember[]> {
    const out = await this.request<{ members: RemoteMember[] }>(`/api/vaults/${vaultID}/members`);
    return out?.members ?? [];
  }

  async updateMemberRole(vaultID: string, userID: string, roleID: string): Promise<void> {
    await this.request<void>(`/api/vaults/${vaultID}/members/${userID}`, {
      method: 'PATCH',
      body: { role_id: roleID },
    });
  }

  async removeMember(vaultID: string, userID: string): Promise<void> {
    await this.request<void>(`/api/vaults/${vaultID}/members/${userID}`, { method: 'DELETE' });
  }

  // ---- invites (vault-scoped management) ----------------------------------

  async listVaultInvites(vaultID: string): Promise<Invite[]> {
    const out = await this.request<{ invites: Invite[] }>(`/api/vaults/${vaultID}/invites`);
    return out?.invites ?? [];
  }

  createInvite(vaultID: string, input: CreateInviteInput): Promise<InviteCreated> {
    return this.request<InviteCreated>(`/api/vaults/${vaultID}/invites`, { method: 'POST', body: input });
  }

  async revokeInvite(vaultID: string, token: string): Promise<void> {
    await this.request<void>(`/api/vaults/${vaultID}/invites/${enc(token)}`, { method: 'DELETE' });
  }

  // ---- federation ----------------------------------------------------------

  createFederationInvite(vaultID: string, input: CreateFederationInviteInput): Promise<FederationInvite> {
    return this.request<FederationInvite>(`/api/vaults/${vaultID}/federation-invites`, {
      method: 'POST',
      body: input,
    });
  }

  async listFederationInvites(vaultID: string): Promise<FederationInvite[]> {
    const out = await this.request<{ invites: FederationInvite[] }>(
      `/api/vaults/${vaultID}/federation-invites`,
    );
    return out?.invites ?? [];
  }

  async revokeFederationInvite(vaultID: string, token: string): Promise<void> {
    await this.request<void>(`/api/vaults/${vaultID}/federation-invites/${enc(token)}`, {
      method: 'DELETE',
    });
  }

  async listFederations(vaultID: string): Promise<Federation[]> {
    const out = await this.request<{ federations: Federation[] }>(`/api/vaults/${vaultID}/federations`);
    return out?.federations ?? [];
  }

  // 409 {"error":"conflict"} when already revoked. The peer keeps its
  // copy of the data — the UI must say so.
  async revokeFederation(vaultID: string, federationID: string): Promise<void> {
    await this.request<void>(`/api/vaults/${vaultID}/federations/${enc(federationID)}`, {
      method: 'DELETE',
    });
  }

  joinFederation(input: JoinFederationInput): Promise<FederationJoinResponse> {
    return this.request<FederationJoinResponse>('/api/federation/join', { method: 'POST', body: input });
  }

  async listFederatedMembers(vaultID: string): Promise<FederatedMember[]> {
    const out = await this.request<{ federated_members: FederatedMember[] }>(
      `/api/vaults/${vaultID}/federated-members`,
    );
    return out?.federated_members ?? [];
  }

  addFederatedMember(vaultID: string, memberKey: string, roleID: string): Promise<FederatedMember> {
    return this.request<FederatedMember>(`/api/vaults/${vaultID}/federated-members`, {
      method: 'POST',
      body: { member_key: memberKey, role_id: roleID },
    });
  }

  async updateFederatedMemberRole(vaultID: string, memberKey: string, roleID: string): Promise<void> {
    await this.request<void>(`/api/vaults/${vaultID}/federated-members`, {
      method: 'PATCH',
      body: { member_key: memberKey, role_id: roleID },
    });
  }

  async removeFederatedMember(vaultID: string, memberKey: string): Promise<void> {
    await this.request<void>(`/api/vaults/${vaultID}/federated-members`, {
      method: 'DELETE',
      body: { member_key: memberKey },
    });
  }

  // ---- notes -----------------------------------------------------------------

  listNotes(
    vaultID: string,
    opts: ListNotesOpts = {},
  ): Promise<{ notes: NoteSummary[]; limit: number; offset: number }> {
    const qs = new URLSearchParams();
    if (opts.limit != null) qs.set('limit', String(opts.limit));
    if (opts.offset != null) qs.set('offset', String(opts.offset));
    const q = qs.toString();
    return this.request(`/api/vaults/${vaultID}/notes${q ? '?' + q : ''}`, { signal: opts.signal });
  }

  getNote(vaultID: string, noteID: string): Promise<NoteSummary> {
    return this.request(`/api/vaults/${vaultID}/notes/${enc(noteID)}`);
  }

  getNoteContent(vaultID: string, noteID: string, signal?: AbortSignal): Promise<NoteContent> {
    return this.request(`/api/vaults/${vaultID}/notes/${enc(noteID)}/content`, { signal });
  }

  createNote(vaultID: string, input: CreateNoteInput): Promise<NoteSummary> {
    return this.request(`/api/vaults/${vaultID}/notes`, { method: 'POST', body: input });
  }

  updateNote(vaultID: string, noteID: string, input: UpdateNoteInput): Promise<NoteSummary> {
    return this.request(`/api/vaults/${vaultID}/notes/${enc(noteID)}`, { method: 'PATCH', body: input });
  }

  async deleteNote(vaultID: string, noteID: string): Promise<void> {
    await this.request<void>(`/api/vaults/${vaultID}/notes/${enc(noteID)}`, { method: 'DELETE' });
  }

  /** Single-use, 30 s ticket for the note sync WebSocket (wave 3).
   *  Older servers answer 404 — callers fall back to `?token=`. */
  createNoteWsTicket(vaultID: string, noteID: string): Promise<WsTicket> {
    return this.request(`/api/vaults/${vaultID}/notes/${enc(noteID)}/ws-ticket`, { method: 'POST' });
  }

  getNoteSnapshot(vaultID: string, noteID: string): Promise<NoteSnapshot> {
    return this.request(`/api/vaults/${vaultID}/notes/${enc(noteID)}/snapshot`);
  }

  /** Whether this server has GET …/state-vector (null = not probed). */
  stateVectorSupported: boolean | null = null;

  /**
   * `{crdt_epoch, state_vector}` without the document (ack confirmation,
   * lineage). Servers without the route answer 404/405/501: fall back
   * to /snapshot (mapped to the same shape) and remember that, so later
   * calls go straight to /snapshot. A 404 is ambiguous (old server vs.
   * note gone): the fallback settles it — a /snapshot 404 propagates as
   * "note gone" and does NOT mark the route unsupported.
   */
  async getNoteStateVector(vaultID: string, noteID: string): Promise<NoteStateVector> {
    if (this.stateVectorSupported !== false) {
      try {
        const r = await this.request<NoteStateVector>(`/api/vaults/${vaultID}/notes/${enc(noteID)}/state-vector`);
        this.stateVectorSupported = true;
        return r;
      } catch (e) {
        const routeMissing =
          e instanceof ApiError && (e.status === 405 || e.status === 501 || (e.status === 404 && this.stateVectorSupported !== true));
        if (!routeMissing) throw e;
      }
    }
    const snap = await this.getNoteSnapshot(vaultID, noteID);
    this.stateVectorSupported = false;
    return { id: snap.id, crdt_epoch: snap.crdt_epoch ?? null, state_vector: snap.vector_clock };
  }

  applyNoteDiff(vaultID: string, noteID: string, text: string, baseClock?: string): Promise<NoteSnapshot> {
    return this.request(`/api/vaults/${vaultID}/notes/${enc(noteID)}/diff`, {
      method: 'POST',
      body: { text, base_clock: baseClock, origin: 'web' },
    });
  }
}

/** Build a client for one account. `getToken` is read on every request
 *  so token rotation (re-login) is transparent. */
export function createClient(
  serverUrl: string,
  getToken: () => string | null = () => null,
  extra: Omit<AccountContext, 'serverUrl' | 'getToken'> = {},
): ApiClient {
  return new ApiClient({ serverUrl, getToken, ...extra });
}

// ---- routing for the module-level helpers ------------------------------------

export interface ClientResolver {
  /** Client of the account the book for `vaultID` is bound to. */
  forVault(vaultID: string): ApiClient | null;
  /** Client of the active book's account (or the only account). */
  active(): ApiClient | null;
  /** Client of a specific account key (`server_url#username`). */
  forAccount(key: string): ApiClient | null;
}

let resolver: ClientResolver | null = null;

export function setClientResolver(r: ClientResolver | null): void {
  resolver = r;
}

function noAccount(): ApiError {
  return new ApiError(0, {
    error: 'no_account',
    detail: 'Nenhuma conta deste aparelho está ligada a este livro.',
  });
}

function vc(vaultID: string): ApiClient {
  const c = resolver?.forVault(vaultID) ?? null;
  if (!c) throw noAccount();
  return c;
}

function ac(accountKey?: string): ApiClient {
  const c = (accountKey ? resolver?.forAccount(accountKey) : resolver?.active()) ?? null;
  if (!c) throw noAccount();
  return c;
}

// Thin wrappers. `async` so routing failures surface as rejections,
// never synchronous throws.

export async function me(accountKey?: string): Promise<SessionUser> {
  return ac(accountKey).me();
}
export async function acceptInviteAsCurrentUser(token: string, accountKey?: string) {
  return ac(accountKey).acceptInviteAsCurrentUser(token);
}
export async function listVaults(accountKey?: string): Promise<Vault[]> {
  return ac(accountKey).listVaults();
}
export async function createVault(input: CreateVaultInput, accountKey?: string): Promise<Vault> {
  return ac(accountKey).createVault(input);
}
export async function joinFederation(input: JoinFederationInput, accountKey?: string) {
  return ac(accountKey).joinFederation(input);
}

export async function getVault(id: string) { return vc(id).getVault(id); }
export async function renameVault(id: string, name: string) { return vc(id).renameVault(id, name); }
export async function transferOwnership(v: string, u: string) { return vc(v).transferOwnership(v, u); }
export async function copyVault(v: string, r: string) { return vc(v).copyVault(v, r); }
export async function listVaultRoles(v: string) { return vc(v).listVaultRoles(v); }
export async function createRole(v: string, i: CreateRoleInput) { return vc(v).createRole(v, i); }
export async function updateRole(v: string, r: string, i: UpdateRoleInput) { return vc(v).updateRole(v, r, i); }
export async function deleteRole(v: string, r: string) { return vc(v).deleteRole(v, r); }
export async function listVaultMembers(v: string) { return vc(v).listVaultMembers(v); }
export async function updateMemberRole(v: string, u: string, r: string) { return vc(v).updateMemberRole(v, u, r); }
export async function removeMember(v: string, u: string) { return vc(v).removeMember(v, u); }
export async function listVaultInvites(v: string) { return vc(v).listVaultInvites(v); }
export async function createInvite(v: string, i: CreateInviteInput) { return vc(v).createInvite(v, i); }
export async function revokeInvite(v: string, t: string) { return vc(v).revokeInvite(v, t); }
export async function createFederationInvite(v: string, i: CreateFederationInviteInput) { return vc(v).createFederationInvite(v, i); }
export async function listFederationInvites(v: string) { return vc(v).listFederationInvites(v); }
export async function revokeFederationInvite(v: string, t: string) { return vc(v).revokeFederationInvite(v, t); }
export async function listFederations(v: string) { return vc(v).listFederations(v); }
export async function revokeFederation(v: string, f: string) { return vc(v).revokeFederation(v, f); }
export async function listFederatedMembers(v: string) { return vc(v).listFederatedMembers(v); }
export async function addFederatedMember(v: string, m: string, r: string) { return vc(v).addFederatedMember(v, m, r); }
export async function updateFederatedMemberRole(v: string, m: string, r: string) { return vc(v).updateFederatedMemberRole(v, m, r); }
export async function removeFederatedMember(v: string, m: string) { return vc(v).removeFederatedMember(v, m); }
export async function listNotes(v: string, o: ListNotesOpts = {}) { return vc(v).listNotes(v, o); }
export async function getNote(v: string, n: string) { return vc(v).getNote(v, n); }
export async function getNoteContent(v: string, n: string, s?: AbortSignal) { return vc(v).getNoteContent(v, n, s); }
export async function createNote(v: string, i: CreateNoteInput) { return vc(v).createNote(v, i); }
export async function updateNote(v: string, n: string, i: UpdateNoteInput) { return vc(v).updateNote(v, n, i); }
export async function deleteNote(v: string, n: string) { return vc(v).deleteNote(v, n); }
export async function createNoteWsTicket(v: string, n: string) { return vc(v).createNoteWsTicket(v, n); }
export async function getNoteSnapshot(v: string, n: string) { return vc(v).getNoteSnapshot(v, n); }
export async function getNoteStateVector(v: string, n: string) { return vc(v).getNoteStateVector(v, n); }
export async function applyNoteDiff(v: string, n: string, t: string, b?: string) { return vc(v).applyNoteDiff(v, n, t, b); }

export function isAbortError(err: unknown): boolean {
  return (
    (typeof DOMException !== 'undefined' && err instanceof DOMException && err.name === 'AbortError') ||
    (err instanceof Error && err.name === 'AbortError')
  );
}
