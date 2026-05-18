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

export interface Vault {
  id: string;
  slug: string;
  name: string;
  created_by: string;
  created_at: string;
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
// and free-form; callers usually surface error verbatim.
export interface ServerError {
  error: string;
  detail?: string;
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
    super(body.detail ?? body.error);
    this.status = status;
    this.code = body.error;
    this.detail = body.detail;
    this.capability = body.capability;
  }
}

// View identifiers for the top-level router. Names match the URL
// fragments slice 4.x may eventually use.
export type RouteKind = 'login' | 'vaults' | 'vault';

// Kept for compatibility with lib/themes.ts which is shared with TUI
// and site.
export type ThemeMode = 'dark' | 'light' | 'auto';
