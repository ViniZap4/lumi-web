// Round-trip + tamper-resistance suite for the localStorage token
// encryption layer. The threats this guards against:
//   - Plaintext token in localStorage (XSS-readable, browser-extension-readable)
//   - Silent decryption of a tampered payload (auth tag bypass)
//   - Reused IV producing identical ciphertexts (catastrophic for AES-GCM)
//
// We deliberately stay in the default Node test environment — Web
// Crypto is a global since Node 19 and we don't need a DOM here.

import { describe, it, expect } from 'vitest';
import { encryptToken, decryptToken } from './crypto.ts';

describe('crypto', () => {
  it('round-trips a normal token', async () => {
    const tok = 'abc-XYZ_123';
    const enc = await encryptToken(tok);
    const dec = await decryptToken(enc);
    expect(dec).toBe(tok);
  });

  it('produces different ciphertexts each call (random IV)', async () => {
    // AES-GCM with a reused IV under the same key is a classical
    // catastrophic failure mode — verifying the IV changes across
    // encrypts is the cheapest possible signal that randomness is wired
    // up. encryptToken uses crypto.getRandomValues(new Uint8Array(12)).
    const a = await encryptToken('same value');
    const b = await encryptToken('same value');
    expect(a).not.toBe(b);
    // Specifically: the IVs in the two payloads must differ.
    expect(JSON.parse(a).iv).not.toBe(JSON.parse(b).iv);
  });

  it('rejects a tampered ciphertext', async () => {
    // Flip a byte inside the ciphertext. AES-GCM's auth tag should
    // make the decrypt throw. Without this guarantee an attacker who
    // could write to localStorage could forge tokens silently.
    const enc = await encryptToken('secret');
    const obj = JSON.parse(enc);
    const ct = atob(obj.ct);
    const tampered = String.fromCharCode(ct.charCodeAt(0) ^ 1) + ct.slice(1);
    obj.ct = btoa(tampered);
    await expect(decryptToken(JSON.stringify(obj))).rejects.toThrow();
  });

  it('rejects a tampered IV', async () => {
    const enc = await encryptToken('secret');
    const obj = JSON.parse(enc);
    const iv = atob(obj.iv);
    const tampered = String.fromCharCode(iv.charCodeAt(0) ^ 1) + iv.slice(1);
    obj.iv = btoa(tampered);
    await expect(decryptToken(JSON.stringify(obj))).rejects.toThrow();
  });

  it('rejects invalid JSON', async () => {
    await expect(decryptToken('not-json')).rejects.toThrow();
  });

  it('round-trips empty strings, unicode, and large inputs', async () => {
    for (const s of ['', '🎉 token ✓ café', 'a'.repeat(10_000)]) {
      const round = await decryptToken(await encryptToken(s));
      expect(round).toBe(s);
    }
  });
});
