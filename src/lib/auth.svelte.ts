// Reactive auth store. Holds the active session and exposes
// sign-in/sign-up/sign-out/restore lifecycle helpers. Persists the
// session token encrypted under localStorage so a reload doesn't
// log the user out.
//
// Persistence shape:
//   localStorage['lumi.v2.session'] = encryptToken(JSON.stringify({
//     token, expires_at, user: { id, username, display_name }
//   }))
//
// The encryption is symmetric with a derived key — protection against
// trivial localStorage scraping by third-party JS, NOT a hard secret.
// True security comes from the server-side session TTL + revocation.

import { encryptToken, decryptToken } from './crypto.ts';
import {
  ApiError,
  type SessionResponse,
  type SessionUser,
} from './types.ts';
import * as api from './api.ts';

const STORAGE_KEY = 'lumi.v2.session';

interface PersistedSession {
  token: string;
  expires_at: string;
  user: SessionUser;
}

class AuthStore {
  // ---- reactive surface ----
  user = $state<SessionUser | null>(null);
  expiresAt = $state<string | null>(null);
  initialising = $state(true);
  lastError = $state<string | null>(null);

  /** True once we have a validated session. */
  authenticated = $derived(this.user != null);

  // ---- lifecycle ----

  /**
   * Read the persisted session from localStorage (if any), set the
   * API token, and validate against /api/users/me. On 401 the
   * persisted session is dropped silently. Call once at app boot.
   */
  async restore(): Promise<void> {
    this.initialising = true;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const json = await decryptToken(raw);
      const sess = JSON.parse(json) as PersistedSession;
      api.setToken(sess.token);
      // Validate. If invalid (401), me() throws and we fall through.
      const u = await api.me();
      this.user = u;
      this.expiresAt = sess.expires_at;
    } catch (e) {
      // Either the storage is corrupt, the key derivation rotated,
      // or the server doesn't recognise us. Drop everything.
      console.warn('auth restore failed:', e);
      this.clearSession();
    } finally {
      this.initialising = false;
    }
  }

  async signIn(username: string, password: string): Promise<void> {
    this.lastError = null;
    try {
      const sess = await api.login(username, password);
      await this.acceptSession(sess);
    } catch (e) {
      this.lastError = describeError(e);
      throw e;
    }
  }

  async signUp(input: api.RegisterInput): Promise<void> {
    this.lastError = null;
    try {
      const sess = await api.register(input);
      await this.acceptSession(sess);
    } catch (e) {
      this.lastError = describeError(e);
      throw e;
    }
  }

  async signOut(): Promise<void> {
    // Best-effort server logout. Even if it fails (network, expired
    // token), drop local state.
    try {
      await api.logout();
    } catch {
      // ignore
    }
    this.clearSession();
  }

  // ---- helpers ----

  private async acceptSession(sess: SessionResponse): Promise<void> {
    api.setToken(sess.token);
    this.user = sess.user;
    this.expiresAt = sess.expires_at;
    const persisted: PersistedSession = {
      token: sess.token,
      expires_at: sess.expires_at,
      user: sess.user,
    };
    try {
      const encrypted = await encryptToken(JSON.stringify(persisted));
      localStorage.setItem(STORAGE_KEY, encrypted);
    } catch (e) {
      // Persistence failure is non-fatal — user just won't survive
      // a reload.
      console.warn('auth persist failed:', e);
    }
  }

  private clearSession(): void {
    api.setToken(null);
    this.user = null;
    this.expiresAt = null;
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }
}

function describeError(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'invalid_credentials':
        return 'Invalid username or password.';
      case 'registration_closed':
        return 'This server does not accept sign-ups. Ask an admin for an invite link.';
      case 'consent_required':
        return 'You must accept the Terms of Service and Privacy Policy.';
      case 'username_taken':
        return 'That username is already in use.';
      case 'validation_failed':
        return err.detail ?? 'The form has invalid fields.';
      case 'rate_limited':
        return 'Too many attempts. Wait a moment and try again.';
      case 'token_expired':
      case 'unauthorized':
        return 'Your session expired. Sign in again.';
      default:
        return err.detail ?? err.code;
    }
  }
  if (err instanceof Error) return err.message;
  return 'Unknown error.';
}

export const auth = new AuthStore();
