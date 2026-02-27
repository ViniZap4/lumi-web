// AES-GCM encryption for localStorage token storage.
// Prevents plaintext token exposure in browser storage.

const SALT = new TextEncoder().encode('lumi-token-key-v1');
const ITERATIONS = 100_000;

async function deriveKey() {
  const base = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode('lumi-local-storage-encryption'),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: SALT, iterations: ITERATIONS, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptToken(token) {
  const key = await deriveKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(token),
  );
  const payload = { iv: btoa(String.fromCharCode(...iv)), ct: btoa(String.fromCharCode(...new Uint8Array(ct))) };
  return JSON.stringify(payload);
}

export async function decryptToken(stored) {
  const { iv, ct } = JSON.parse(stored);
  const key = await deriveKey();
  const ivBuf = Uint8Array.from(atob(iv), c => c.charCodeAt(0));
  const ctBuf = Uint8Array.from(atob(ct), c => c.charCodeAt(0));
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: ivBuf },
    key,
    ctBuf,
  );
  return new TextDecoder().decode(plain);
}
