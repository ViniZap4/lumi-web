// v2 wire types — kept in sync with the lumi-server v2 API surface.
//
// Reflects the JSON envelopes the server emits today; once we generate
// these from an OpenAPI spec (Phase 6 hardening) this file becomes the
// authoritative client view.

export interface SessionUser {
  id: string;
  username: string;
  display_name: string;
}

export interface SessionResponse {
  token: string;
  expires_at: string;
  user: SessionUser;
}

// Provenance stamp on a vault created via "share a copy" (v3 Phase O).
// Records where the fork came from; absent on organically-created vaults.
export interface VaultCopiedFrom {
  vault_id: string;
  slug: string;
  copied_by: string;
  copied_at: string;
}

export interface Vault {
  id: string;
  slug: string;
  name: string;
  created_by: string;
  created_at: string;
  // v3 Phase O: every vault has exactly one owner. The owner always
  // holds an Admin-equivalent grant that members.manage can't remove.
  owner_user_id: string;
  // Present only on vaults forked via POST /copies.
  copied_from?: VaultCopiedFrom | null;
}

// The server's invite-accept endpoints return a slimmer vault payload
// (just identity, no audit fields). Modelled separately so callers
// don't pretend the full Vault is available straight from the invite.
export interface InviteVaultSummary {
  id: string;
  slug: string;
  name: string;
}

// Anonymous-signup invite-accept response: a fresh session + the
// vault joined. The endpoint does NOT include a SessionUser, so the
// client must call /api/users/me to populate it.
export interface InviteAcceptSignupResponse {
  token: string;
  expires_at: string;
  vault: InviteVaultSummary;
}

// Authenticated invite-accept response: just the vault joined; the
// caller's session is unchanged.
export interface InviteAcceptExistingResponse {
  vault: InviteVaultSummary;
}

// Server's invite list shape — these are the admin-facing rows for
// managing existing invite links inside a vault. The token field is
// the raw invite token; build the link with the same URL pattern
// LoginView consumes (`/?invite=<token>`).
export interface Invite {
  token: string;
  vault_id: string;
  role_id: string;
  inviter_user_id: string;
  email_hint?: string;
  max_uses: number;
  use_count: number;
  expires_at: string;
  created_at: string;
  revoked_at?: string | null;
}

// Server's response when an invite is freshly created. Includes the
// pre-built URL so the UI doesn't have to guess the right origin.
export interface InviteCreated {
  token: string;
  url: string;
  expires_at: string;
  max_uses: number;
  use_count: number;
}

export interface RemoteRole {
  id: string;
  vault_id: string;
  name: string;
  capabilities: string[];
  is_seed: boolean;
}

export interface RemoteMember {
  vault_id: string;
  user_id: string;
  role_id: string;
  username: string;
  display_name: string;
  role_name: string;
  capabilities: string[];
  joined_at: string;
}

export interface NoteSummary {
  id: string;
  vault_id: string;
  path: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface NoteContent {
  id: string;
  vault_id: string;
  path: string;
  frontmatter: Record<string, unknown>;
  body: string;
}

export interface NoteSnapshot {
  id: string;
  path: string;
  text: string;
  vector_clock: string; // base64
}

// Server error envelope — every 4xx / 5xx response. detail is optional
// and free-form; callers usually surface error verbatim. Some newer
// endpoints (owner_protected, Phase O) put the human-readable text in
// `message` instead of `detail` — ApiError normalises both into detail.
export interface ServerError {
  error: string;
  detail?: string;
  message?: string;
  capability?: string; // present on capability_missing
}

// Thrown by the API client on non-2xx. Code mirrors the server's
// `error` field; status is the HTTP status.
export class ApiError extends Error {
  status: number;
  code: string;
  detail?: string;
  capability?: string;

  constructor(status: number, body: ServerError) {
    super(body.detail ?? body.message ?? body.error);
    this.status = status;
    this.code = body.error;
    this.detail = body.detail ?? body.message;
    this.capability = body.capability;
  }
}

// View identifiers for the top-level router. Names match the URL
// fragments slice 4.x may eventually use.
export type RouteKind = 'login' | 'vaults' | 'vault';

// Kept for compatibility with lib/themes.ts which is shared with TUI
// and site.
export type ThemeMode = 'dark' | 'light' | 'auto';
