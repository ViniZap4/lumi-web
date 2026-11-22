// MIGRATION ONLY (SPEC-LIVROS §2.5). Remove one release after wave 2.
//
// Before wave 2 the web client kept ONE session in
// localStorage['lumi.v2.session'], AES-GCM-encrypted with a key derived
// from constants in the source — obfuscation, not protection. This
// module only *reads* that blob once at boot so the migration can move
// the session into the account registry (re-sealed with the
// non-extractable device key) and then delete the old entry. Nothing
// new is ever encrypted with this key.

import type { SessionUser } from './types.ts';

export const LEGACY_SESSION_KEY = 'lumi.v2.session';
/** The build-time default before wave 2; the legacy session belonged
 *  to whatever API_URL the bundle was built with. */
export const LEGACY_DEFAULT_SERVER = 'http://localhost:8080';

export interface LegacySession {
  token: string;
  expires_at: string;
  user: SessionUser;
}

async function legacyKey(): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode('lumi-local-storage-encryption'),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: new TextEncoder().encode('lumi-token-key-v1'), iterations: 100_000, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** Decrypt + validate the legacy blob. Throws on anything unexpected. */
export async function decryptLegacySession(stored: string): Promise<LegacySession> {
  const { iv, ct } = JSON.parse(stored);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(iv) }, await legacyKey(), fromB64(ct));
  const sess = JSON.parse(new TextDecoder().decode(pt)) as LegacySession;
  if (!sess || typeof sess.token !== 'string' || !sess.user || typeof sess.user.username !== 'string') {
    throw new Error('legacy session: unexpected shape');
  }
  return sess;
}

/** Test helper: produce a blob exactly as the pre-wave-2 client did. */
export async function encryptLegacySessionForTest(sess: LegacySession): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await legacyKey(),
    new TextEncoder().encode(JSON.stringify(sess)),
  );
  const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
  return JSON.stringify({ iv: b64(iv), ct: b64(new Uint8Array(ct)) });
}
