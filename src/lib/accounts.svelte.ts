// Account registry (SPEC-LIVROS §2.2, web / W1).
//
// An account is (server_url, username). Several accounts per server
// are allowed (owner decision 22/11/2026). The only secret is the
// session token — passwords are never stored.
//
// Token storage:
//   - "Lembrar neste aparelho" OFF (the default, owner decision): the
//     account lives only in this tab — metadata + token sealed with the
//     device key in sessionStorage, so it survives a reload of the tab
//     but disappears when the tab closes. (sessionStorage cannot hold a
//     CryptoKey, so the key stays in IndexedDB; without IndexedDB the
//     key is in-memory and the session dies with the page.)
//   - ON: IndexedDB `accounts`, token sealed with the non-extractable
//     `device-key` (see storage.ts for what this does and does NOT
//     protect against — in short: not XSS).
//
// Tokens are held in a private Map, never in reactive state, so they
// can't leak through devtools state inspection of the $state graph or
// into components.

import { ApiClient, createClient, type RestOutcome } from './api.ts';
import { ApiError, type SessionUser } from './types.ts';
import { accountKey } from './books-model.ts';
import { normalizeServerUrl } from './serverurl.ts';
import {
  getDeviceKey,
  openDurableStore,
  seal,
  unseal,
  type DurableStore,
  type Sealed,
} from './storage.ts';
import { LEGACY_DEFAULT_SERVER, LEGACY_SESSION_KEY, decryptLegacySession } from './legacy-session.ts';

export interface AccountMeta {
  server_url: string;
  username: string;
  user_id: string;
  display_name: string;
  added_at: string;
  expires_at: string | null;
  remember: boolean;
  /** Ed25519 key from GET /api/info, when the server exposes it. */
  public_key?: string | null;
}

export type AccountStatus = 'ok' | 'needs_login';

export interface Account extends AccountMeta {
  key: string;
  status: AccountStatus;
  statusReason: string | null;
}

interface StoredAccount {
  meta: AccountMeta;
  token: Sealed | null;
}

export const TAB_ACCOUNTS_KEY = 'lumi.tab.accounts.v1';

export interface AccountHooks {
  onNeedsLogin?: (key: string) => void;
  onOutcome?: (key: string, outcome: RestOutcome, err?: ApiError) => void;
  /** `account` = the row as it was right before removal. */
  onRemoved?: (key: string, account?: Account) => void;
  onAdded?: (key: string) => void;
}

export interface AccountRegistryDeps {
  durable?: DurableStore;
  tab?: Storage | null;
  legacy?: Storage | null;
  defaultServerUrl?: string | null;
  fetch?: typeof fetch;
  now?: () => Date;
}

function safeStorage(name: 'localStorage' | 'sessionStorage'): Storage | null {
  try {
    return (globalThis as any)[name] ?? null;
  } catch {
    return null;
  }
}

export class AccountRegistry {
  list = $state<Account[]>([]);
  ready = $state(false);

  private tokens = new Map<string, string>();
  private clients = new Map<string, ApiClient>();
  private hooks: AccountHooks = {};
  private deps: Required<Omit<AccountRegistryDeps, 'fetch' | 'defaultServerUrl'>> &
    Pick<AccountRegistryDeps, 'fetch' | 'defaultServerUrl'>;
  private keyP: Promise<CryptoKey> | null = null;

  constructor(deps: AccountRegistryDeps = {}) {
    this.deps = {
      durable: deps.durable ?? openDurableStore(),
      tab: deps.tab === undefined ? safeStorage('sessionStorage') : deps.tab,
      legacy: deps.legacy === undefined ? safeStorage('localStorage') : deps.legacy,
      defaultServerUrl: deps.defaultServerUrl,
      fetch: deps.fetch,
      now: deps.now ?? (() => new Date()),
    };
  }

  setHooks(h: AccountHooks): void {
    this.hooks = h;
  }

  private deviceKey(): Promise<CryptoKey> {
    if (!this.keyP) {
      this.keyP = getDeviceKey(this.deps.durable).catch((e) => {
        this.keyP = null;
        throw e;
      });
    }
    return this.keyP;
  }

  // ---- lifecycle -------------------------------------------------------------

  /** Load remembered + tab accounts and migrate the legacy session. */
  async init(): Promise<void> {
    const loaded: Account[] = [];
    const add = async (s: StoredAccount) => {
      const key = accountKey(s.meta.server_url, s.meta.username);
      if (loaded.some((a) => a.key === key)) return;
      let status: AccountStatus = 'needs_login';
      if (s.token) {
        try {
          this.tokens.set(key, await unseal(await this.deviceKey(), s.token, key));
          status = 'ok';
        } catch {
          // Device key rotated / profile copied: the token is unusable.
        }
      }
      loaded.push({ ...s.meta, key, status, statusReason: status === 'ok' ? null : 'entre novamente' });
    };

    try {
      for (const s of await this.deps.durable.getAll<StoredAccount>('accounts')) await add(s);
    } catch (e) {
      console.warn('accounts: durable load failed', e);
    }
    for (const s of this.readTab()) {
      this.tabCache.set(accountKey(s.meta.server_url, s.meta.username), s);
      await add(s);
    }
    this.list = loaded;
    await this.migrateLegacy();
    this.ready = true;
  }

  /** §2.5: `lumi.v2.session` → account (remembered: the user had a
   *  persistent session before). The old entry is removed once the new
   *  one is written, or when it can't be decrypted at all. */
  private async migrateLegacy(): Promise<void> {
    const ls = this.deps.legacy;
    let raw: string | null = null;
    try {
      raw = ls?.getItem(LEGACY_SESSION_KEY) ?? null;
    } catch {
      return;
    }
    if (!raw) return;
    try {
      const sess = await decryptLegacySession(raw);
      const serverUrl = normalizeServerUrl(this.deps.defaultServerUrl || LEGACY_DEFAULT_SERVER);
      await this.add(
        {
          server_url: serverUrl,
          username: sess.user.username,
          user_id: sess.user.id,
          display_name: sess.user.display_name,
          added_at: this.deps.now().toISOString(),
          expires_at: sess.expires_at ?? null,
          remember: true,
        },
        sess.token,
      );
    } catch (e) {
      console.warn('accounts: legacy session not migrated', e);
    }
    try {
      ls?.removeItem(LEGACY_SESSION_KEY);
    } catch {
      // ignore
    }
  }

  // ---- queries ---------------------------------------------------------------

  get(key: string): Account | null {
    return this.list.find((a) => a.key === key) ?? null;
  }

  /** Token for `key` — only for transports that need it verbatim (the
   *  editor WebSocket's ?token=, a server-side constraint of the Yjs
   *  route). Never store or log the result. */
  tokenFor(key: string): string | null {
    return this.tokens.get(key) ?? null;
  }

  hasToken(key: string): boolean {
    return this.tokens.has(key);
  }

  user(key: string): SessionUser | null {
    const a = this.get(key);
    return a ? { id: a.user_id, username: a.username, display_name: a.display_name } : null;
  }

  /** The account-bound API client. Its 401 handler only touches this
   *  account. */
  client(key: string): ApiClient {
    let c = this.clients.get(key);
    if (c) return c;
    const a = this.get(key);
    const serverUrl = a?.server_url ?? key.slice(0, key.lastIndexOf('#'));
    c = createClient(serverUrl, () => this.tokens.get(key) ?? null, {
      fetch: this.deps.fetch,
      onUnauthorized: () => this.markNeedsLogin(key, 'sessão expirada'),
      onOutcome: (o, e) => this.hooks.onOutcome?.(key, o, e),
    });
    this.clients.set(key, c);
    return c;
  }

  /** Anonymous client for a server (login, register, /api/info). */
  anonymous(serverUrl: string): ApiClient {
    return createClient(serverUrl, () => null, { fetch: this.deps.fetch });
  }

  /** Account already registered on a server answering `publicKey`
   *  under a different URL (§2.1 duplicate detection). */
  findByPublicKey(publicKey: string | null | undefined, exceptUrl: string): Account | null {
    if (!publicKey) return null;
    return this.list.find((a) => a.public_key === publicKey && a.server_url !== exceptUrl) ?? null;
  }

  // ---- mutations -------------------------------------------------------------

  /** Add or re-authenticate an account. Re-login of an existing key
   *  keeps `added_at` (it decides dedupe ties) and replaces the token. */
  async add(meta: AccountMeta, token: string): Promise<Account> {
    const key = accountKey(meta.server_url, meta.username);
    const prev = this.get(key);
    const full: AccountMeta = { ...meta, added_at: prev?.added_at ?? meta.added_at };
    this.tokens.set(key, token);
    const acct: Account = { ...full, key, status: 'ok', statusReason: null };
    this.list = prev ? this.list.map((a) => (a.key === key ? acct : a)) : [...this.list, acct];
    await this.persist(key, prev?.remember);
    this.hooks.onAdded?.(key);
    return acct;
  }

  /** 401 / session.ended / editor auth failure. Idempotent. Only this
   *  account is affected. */
  markNeedsLogin(key: string, reason = 'sessão expirada'): void {
    const a = this.get(key);
    if (!a) return;
    const had = this.tokens.delete(key);
    if (a.status === 'needs_login' && !had) return;
    this.list = this.list.map((x) => (x.key === key ? { ...x, status: 'needs_login', statusReason: reason } : x));
    void this.persist(key);
    this.hooks.onNeedsLogin?.(key);
  }

  /** "Sair deste aparelho": best-effort server logout, then forget the
   *  account (token, metadata) locally. */
  async signOut(key: string): Promise<void> {
    if (this.tokens.has(key)) {
      try {
        await this.client(key).logout();
      } catch {
        // offline / already expired: local removal still happens
      }
    }
    await this.forget(key);
  }

  async forget(key: string): Promise<void> {
    const removed = this.get(key) ?? undefined;
    this.tokens.delete(key);
    this.clients.delete(key);
    this.list = this.list.filter((a) => a.key !== key);
    try {
      await this.deps.durable.delete('accounts', key);
    } catch {
      // ignore
    }
    this.writeTab();
    this.hooks.onRemoved?.(key, removed);
  }

  // ---- persistence -------------------------------------------------------------

  private readTab(): StoredAccount[] {
    try {
      const raw = this.deps.tab?.getItem(TAB_ACCOUNTS_KEY);
      const arr = raw ? (JSON.parse(raw) as StoredAccount[]) : [];
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }

  private tabCache = new Map<string, StoredAccount>();

  private writeTab(): void {
    for (const k of [...this.tabCache.keys()]) {
      const a = this.get(k);
      if (!a || a.remember) this.tabCache.delete(k);
    }
    try {
      const arr = [...this.tabCache.values()];
      if (arr.length === 0) this.deps.tab?.removeItem(TAB_ACCOUNTS_KEY);
      else this.deps.tab?.setItem(TAB_ACCOUNTS_KEY, JSON.stringify(arr));
    } catch {
      // storage full / disabled: the session just won't survive reload
    }
  }

  private async persist(key: string, previouslyRemembered?: boolean): Promise<void> {
    const a = this.get(key);
    if (!a) return;
    const meta: AccountMeta = {
      server_url: a.server_url,
      username: a.username,
      user_id: a.user_id,
      display_name: a.display_name,
      added_at: a.added_at,
      expires_at: a.expires_at,
      remember: a.remember,
      public_key: a.public_key ?? null,
    };
    let sealed: Sealed | null = null;
    const token = this.tokens.get(key);
    if (token) {
      try {
        sealed = await seal(await this.deviceKey(), token, key);
      } catch (e) {
        console.warn('accounts: cannot seal token; it will not survive reload', e);
      }
    }
    const rec: StoredAccount = { meta, token: sealed };
    if (a.remember) {
      this.tabCache.delete(key);
      this.writeTab();
      try {
        await this.deps.durable.put('accounts', key, rec);
      } catch (e) {
        console.warn('accounts: durable write failed', e);
      }
    } else {
      if (previouslyRemembered) {
        try {
          await this.deps.durable.delete('accounts', key);
        } catch {
          // ignore
        }
      }
      this.tabCache.set(key, rec);
      this.writeTab();
    }
  }
}

export const accounts = new AccountRegistry({
  defaultServerUrl: (import.meta.env.VITE_LUMI_SERVER_URL as string | undefined) || null,
});
