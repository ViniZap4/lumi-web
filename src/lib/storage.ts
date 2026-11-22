// Durable client storage (SPEC-LIVROS §2.2/§2.3, web).
//
// IndexedDB database `lumi` with three object stores:
//   - `keys`     — the per-browser device key (`device-key`), a
//                  NON-EXTRACTABLE AES-GCM CryptoKey (structured clone
//                  keeps it non-extractable; its raw bytes are never
//                  readable from JS).
//   - `accounts` — remembered accounts: metadata + token sealed with
//                  the device key.
//   - `books`    — the books registry rows of remembered accounts
//                  (same JSON shape as books.yaml §2.3, no `path`).
//
// Threat model, honestly (§2.2): the non-extractable key keeps the
// token out of plaintext copies of storage (devtools dumps, storage-
// reading extensions, logs, a copied localStorage). It does NOT stop
// XSS — a script running in this origin can simply call decrypt() —
// and it does not stop someone who copies the whole browser profile.
// The real defences are elsewhere: strict CSP (`script-src 'self'`),
// no runtime-loaded dependencies, the server's sliding TTL,
// revocation and "Sair deste aparelho".

export type StoreName = 'keys' | 'accounts' | 'books';

export interface DurableStore {
  get<T>(store: StoreName, key: string): Promise<T | undefined>;
  getAll<T>(store: StoreName): Promise<T[]>;
  put(store: StoreName, key: string, value: unknown): Promise<void>;
  delete(store: StoreName, key: string): Promise<void>;
  clear(store: StoreName): Promise<void>;
}

const DB_NAME = 'lumi';
const DB_VERSION = 1;
const STORES: StoreName[] = ['keys', 'accounts', 'books'];

function promisify<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export class IndexedDBStore implements DurableStore {
  private dbp: Promise<IDBDatabase>;

  constructor(factory: IDBFactory, name = DB_NAME) {
    this.dbp = new Promise((resolve, reject) => {
      const req = factory.open(name, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('indexeddb blocked'));
    });
  }

  private async tx(store: StoreName, mode: IDBTransactionMode): Promise<IDBObjectStore> {
    const db = await this.dbp;
    return db.transaction(store, mode).objectStore(store);
  }

  async get<T>(store: StoreName, key: string): Promise<T | undefined> {
    return promisify((await this.tx(store, 'readonly')).get(key)) as Promise<T | undefined>;
  }
  async getAll<T>(store: StoreName): Promise<T[]> {
    return promisify((await this.tx(store, 'readonly')).getAll()) as Promise<T[]>;
  }
  async put(store: StoreName, key: string, value: unknown): Promise<void> {
    await promisify((await this.tx(store, 'readwrite')).put(value, key));
  }
  async delete(store: StoreName, key: string): Promise<void> {
    await promisify((await this.tx(store, 'readwrite')).delete(key));
  }
  async clear(store: StoreName): Promise<void> {
    await promisify((await this.tx(store, 'readwrite')).clear());
  }
}

/** In-memory store (tests, or browsers where IndexedDB is unavailable —
 *  then nothing survives the tab, which is the safe failure mode). */
export class MemoryStore implements DurableStore {
  private data = new Map<StoreName, Map<string, unknown>>();
  private m(s: StoreName): Map<string, unknown> {
    let x = this.data.get(s);
    if (!x) this.data.set(s, (x = new Map()));
    return x;
  }
  async get<T>(s: StoreName, k: string): Promise<T | undefined> {
    return this.m(s).get(k) as T | undefined;
  }
  async getAll<T>(s: StoreName): Promise<T[]> {
    return Array.from(this.m(s).values()) as T[];
  }
  async put(s: StoreName, k: string, v: unknown): Promise<void> {
    this.m(s).set(k, v);
  }
  async delete(s: StoreName, k: string): Promise<void> {
    this.m(s).delete(k);
  }
  async clear(s: StoreName): Promise<void> {
    this.m(s).clear();
  }
}

export function openDurableStore(): DurableStore {
  try {
    if (typeof indexedDB !== 'undefined' && indexedDB) return new IndexedDBStore(indexedDB);
  } catch {
    // fall through
  }
  return new MemoryStore();
}

// ---- device key + sealing --------------------------------------------------

export interface Sealed {
  iv: string; // base64
  ct: string; // base64
}

const DEVICE_KEY_ID = 'device-key';

/** Load the per-browser device key, generating it on first use. The key
 *  is created with `extractable: false`, so exportKey() fails and the
 *  raw key bytes never exist in JS-visible memory. */
export async function getDeviceKey(store: DurableStore): Promise<CryptoKey> {
  const existing = await store.get<CryptoKey>('keys', DEVICE_KEY_ID);
  if (existing) return existing;
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);
  await store.put('keys', DEVICE_KEY_ID, key);
  // Re-read: if two tabs raced, both converge on whichever key won.
  return (await store.get<CryptoKey>('keys', DEVICE_KEY_ID)) ?? key;
}

function b64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
function unb64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** AES-GCM seal. `aad` binds the ciphertext to its owner (the account
 *  key), so a sealed token cannot be swapped onto another account row. */
export async function seal(key: CryptoKey, plaintext: string, aad: string): Promise<Sealed> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(aad) },
    key,
    new TextEncoder().encode(plaintext),
  );
  return { iv: b64(iv), ct: b64(new Uint8Array(ct)) };
}

export async function unseal(key: CryptoKey, sealed: Sealed, aad: string): Promise<string> {
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: unb64(sealed.iv), additionalData: new TextEncoder().encode(aad) },
    key,
    unb64(sealed.ct),
  );
  return new TextDecoder().decode(pt);
}
