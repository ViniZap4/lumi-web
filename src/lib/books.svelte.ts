// Books registry store (SPEC-LIVROS §2.3–§2.4, §5; web / W2).
//
// "Livro" is the UI word; underneath every book is a server vault
// bound to exactly one (server_url, account). The registry rows are
// persisted next to their account: books of remembered accounts in
// IndexedDB `books`, books of tab-only accounts in sessionStorage — a
// "don't remember me" sign-in leaves no book names on disk.
//
// The legacy `vaults` store stays as the view-facing facade (list of
// vault DTOs + selected vault id) so existing components keep working;
// this store drives it.

import { accounts as defaultAccounts, type AccountRegistry } from './accounts.svelte.ts';
import {
  bookAccountKey,
  bookForShortcut,
  groupByServer,
  reconcileBooks,
  resolveActive,
  selectorOrder,
  sortBooks,
  switchBinding,
  SORT_STEP,
  type AccountVaults,
  type Alternate,
  type Book,
} from './books-model.ts';
import { openDurableStore, type DurableStore } from './storage.ts';
import { offlineStore as defaultOfflineStore, scopeKey, type OfflineStore } from './offline-store.ts';
import { serverLabel } from './serverurl.ts';
import { vaults } from './vaults.svelte.ts';
import { ApiError, type Vault } from './types.ts';
import { setClientResolver, type ApiClient } from './api.ts';

export const ACTIVE_BOOK_KEY = 'lumi.activeBook';
export const ONBOARDING_KEY = 'lumi.onboarding.books.v1';
export const TAB_BOOKS_KEY = 'lumi.tab.books.v1';

export interface Banner {
  id: string;
  kind: 'added' | 'dedupe' | 'severed' | 'info';
  text: string;
  vault_id?: string;
}

export interface BooksDeps {
  accounts?: AccountRegistry;
  durable?: DurableStore;
  tab?: Storage | null;
  local?: Storage | null;
  now?: () => Date;
  /** Last-known vault DTOs per account (offline navigation). null = off. */
  offline?: OfflineStore | null;
}

function storage(name: 'localStorage' | 'sessionStorage'): Storage | null {
  try {
    return (globalThis as any)[name] ?? null;
  } catch {
    return null;
  }
}

function describe(e: unknown): string {
  if (e instanceof ApiError) return e.detail ?? e.code;
  if (e instanceof Error) return e.message;
  return 'erro desconhecido';
}

export class BooksStore {
  list = $state<Book[]>([]);
  /** vault_id → other (server, account) pairs (in memory only). */
  alternates = $state<Record<string, Alternate[]>>({});
  /** vault_id → DTO from the bound account. */
  info = $state<Record<string, Vault>>({});
  /** vault_id → can_edit (hello / vault.access / GET /api/vaults). */
  canEdit = $state<Record<string, boolean>>({});
  /** book id → vault.revoked reason. */
  revoked = $state<Record<string, string>>({});
  banners = $state<Banner[]>([]);
  activeID = $state<string | null>(null);
  /** Full-screen books selector ("← Livros"). */
  pickerOpen = $state(false);
  loading = $state(false);
  lastError = $state<string | null>(null);
  ready = $state(false);
  onboardingSeen = $state(true);

  ordered = $derived(selectorOrder(this.list));
  groups = $derived(groupByServer(this.list));
  active = $derived<Book | null>(this.list.find((b) => b.id === this.activeID) ?? null);

  readonly accounts: AccountRegistry;
  private durable: DurableStore;
  private tab: Storage | null;
  private local: Storage | null;
  private now: () => Date;
  private offline: OfflineStore | null;
  /** vault_id → the DTO came from the offline cache, not the server. */
  infoStale = $state<Record<string, boolean>>({});
  /** account key → last GET /api/vaults answer. */
  private sources = new Map<string, AccountVaults>();
  private bannerSeq = 0;

  constructor(deps: BooksDeps = {}) {
    this.accounts = deps.accounts ?? defaultAccounts;
    this.durable = deps.durable ?? openDurableStore();
    this.tab = deps.tab === undefined ? storage('sessionStorage') : deps.tab;
    this.local = deps.local === undefined ? storage('localStorage') : deps.local;
    this.now = deps.now ?? (() => new Date());
    this.offline = deps.offline === undefined ? defaultOfflineStore : deps.offline;
  }

  // ---- routing (api.ts module helpers) ----------------------------------------

  accountKeyOf(book: Pick<Book, 'server_url' | 'account'>): string {
    return bookAccountKey(book);
  }

  bookForVault(vaultID: string): Book | null {
    return this.list.find((b) => b.vault_id === vaultID) ?? null;
  }

  /** Account key of the active book, else the first usable account. */
  activeAccountKey(): string | null {
    const b = this.active;
    if (b) return this.accountKeyOf(b);
    return this.accounts.list.find((a) => a.status === 'ok')?.key ?? this.accounts.list[0]?.key ?? null;
  }

  clientForVault(vaultID: string): ApiClient | null {
    const b = this.bookForVault(vaultID);
    if (b) {
      const key = this.accountKeyOf(b);
      return this.accounts.get(key) ? this.accounts.client(key) : null;
    }
    // Not a book yet (e.g. just created/joined, list not reconciled):
    // only unambiguous with a single account.
    if (this.accounts.list.length === 1) return this.accounts.client(this.accounts.list[0].key);
    return null;
  }

  installResolver(): void {
    setClientResolver({
      forVault: (id) => this.clientForVault(id),
      active: () => {
        const k = this.activeAccountKey();
        return k ? this.accounts.client(k) : null;
      },
      forAccount: (k) => (this.accounts.get(k) ? this.accounts.client(k) : null),
    });
  }

  // ---- lifecycle -------------------------------------------------------------

  async init(): Promise<void> {
    const rows: Book[] = [];
    try {
      rows.push(...(await this.durable.getAll<Book>('books')));
    } catch (e) {
      console.warn('books: durable load failed', e);
    }
    try {
      const raw = this.tab?.getItem(TAB_BOOKS_KEY);
      const arr = raw ? (JSON.parse(raw) as Book[]) : [];
      if (Array.isArray(arr)) rows.push(...arr);
    } catch {
      // ignore
    }
    const seen = new Set<string>();
    this.list = sortBooks(
      rows.filter((b) => b && b.kind === 'bound' && b.vault_id && !seen.has(b.id) && seen.add(b.id)),
    );
    let wanted: string | null = null;
    try {
      wanted = this.local?.getItem(ACTIVE_BOOK_KEY) ?? null;
      this.onboardingSeen = this.local?.getItem(ONBOARDING_KEY) === '1';
    } catch {
      // ignore
    }
    this.activeID = resolveActive(this.list, wanted)?.id ?? null;
    this.installResolver();
    await this.loadVaultCache();
    this.ready = true;
    this.syncVaults();
  }

  /** Last-known vault DTOs (name, slug, role, can_edit) per account, so
   *  the selector and the open book look right before — or without —
   *  the network. Marked stale until GET /api/vaults answers. */
  private async loadVaultCache(): Promise<void> {
    if (!this.offline) return;
    const info: Record<string, Vault> = { ...this.info };
    const canEdit: Record<string, boolean> = { ...this.canEdit };
    const stale: Record<string, boolean> = { ...this.infoStale };
    for (const a of this.accounts.list) {
      if (!a.user_id) continue;
      try {
        const c = await this.offline.getCache<Vault[]>(scopeKey(a.server_url, a.user_id), 'vaults');
        for (const v of c?.value ?? []) {
          const b = this.bookForVault(v.id);
          if (!b || this.accountKeyOf(b) !== a.key || info[v.id]) continue;
          info[v.id] = v;
          stale[v.id] = true;
          if (typeof v.can_edit === 'boolean') canEdit[v.id] = v.can_edit;
        }
      } catch {
        // cache is best-effort
      }
    }
    this.info = info;
    this.canEdit = canEdit;
    this.infoStale = stale;
  }

  /** Refresh every account's vault list and reconcile. */
  async refreshAll(): Promise<void> {
    const keys = this.accounts.list.filter((a) => a.status === 'ok').map((a) => a.key);
    this.loading = true;
    this.lastError = null;
    try {
      await Promise.all(keys.map((k) => this.fetchAccount(k)));
      this.reconcile(false);
    } finally {
      this.loading = false;
    }
  }

  /** Refresh one account (sign-in, vault.access, hello with unknown
   *  vaults). `announce` shows "N livros adicionados de host". */
  async refreshAccount(key: string, announce = false): Promise<void> {
    if (await this.fetchAccount(key)) this.reconcile(announce);
  }

  private async fetchAccount(key: string): Promise<boolean> {
    const a = this.accounts.get(key);
    if (!a || a.status !== 'ok') return false;
    try {
      const vs = await this.accounts.client(key).listVaults();
      // The account may have been removed meanwhile.
      if (!this.accounts.get(key)) return false;
      this.sources.set(key, { server_url: a.server_url, username: a.username, added_at: a.added_at, vaults: vs });
      if (this.offline && a.user_id) {
        void this.offline.putCache(scopeKey(a.server_url, a.user_id), 'vaults', $state.snapshot(vs)).catch(() => {});
      }
      if (vs.some((v) => this.infoStale[v.id])) {
        const st = { ...this.infoStale };
        for (const v of vs) delete st[v.id];
        this.infoStale = st;
      }
      return true;
    } catch (e) {
      this.lastError = `${serverLabel(a.server_url)}: ${describe(e)}`;
      return false;
    }
  }

  private reconcile(announce: boolean): void {
    const r = reconcileBooks(this.list, [...this.sources.values()], this.now().toISOString());
    const info: Record<string, Vault> = { ...this.info };
    const canEdit: Record<string, boolean> = { ...this.canEdit };
    for (const b of r.books) {
      const src = this.sources.get(this.accountKeyOf(b));
      const v = src?.vaults.find((x) => x.id === b.vault_id);
      if (v) {
        info[b.vault_id] = v;
        if (typeof v.can_edit === 'boolean') canEdit[b.vault_id] = v.can_edit;
      }
    }
    const revoked = { ...this.revoked };
    for (const id of r.missing) revoked[id] ??= 'removed';
    // Books that reappeared are no longer revoked.
    for (const b of r.books) if (!r.missing.includes(b.id) && revoked[b.id] === 'removed') {
      const src = this.sources.get(this.accountKeyOf(b));
      if (src?.vaults.some((v) => v.id === b.vault_id)) delete revoked[b.id];
    }
    this.list = r.books;
    this.alternates = r.alternates;
    this.info = info;
    this.canEdit = canEdit;
    this.revoked = revoked;
    for (const d of r.dedupe) {
      this.pushBanner({
        kind: 'dedupe',
        vault_id: d.vault_id,
        text: `Este livro também está em ${d.others.map(serverLabel).join(', ')}. Ele sincroniza por ${serverLabel(d.bound)}.`,
      });
    }
    if (announce) {
      for (const a of r.added) {
        this.pushBanner({
          kind: 'added',
          text: `${a.count} ${a.count === 1 ? 'livro adicionado' : 'livros adicionados'} de ${serverLabel(a.server_url)}`,
        });
      }
    }
    if (!this.active) this.activeID = resolveActive(this.list, this.activeID)?.id ?? null;
    void this.persist();
    this.syncVaults();
  }

  // ---- selection -------------------------------------------------------------

  setActive(id: string): void {
    const b = this.list.find((x) => x.id === id);
    if (!b) return;
    this.activeID = id;
    this.pickerOpen = false;
    const at = this.now().toISOString();
    this.list = this.list.map((x) => (x.id === id ? { ...x, last_opened_at: at } : x));
    try {
      this.local?.setItem(ACTIVE_BOOK_KEY, id);
    } catch {
      // ignore
    }
    void this.persist();
    this.syncVaults();
  }

  openByVault(vaultID: string | null): void {
    if (vaultID == null) {
      this.openPicker();
      return;
    }
    const b = this.bookForVault(vaultID);
    if (b) this.setActive(b.id);
  }

  /** g1–g9 / ⌃⌘1–9. Returns the book opened, if any. */
  openShortcut(n: number): Book | null {
    const b = bookForShortcut(this.list, n);
    if (b) this.setActive(b.id);
    return b;
  }

  openPicker(): void {
    this.pickerOpen = true;
    this.syncVaults();
  }

  closePicker(): void {
    if (!this.active) return;
    this.pickerOpen = false;
    this.syncVaults();
  }

  dismissOnboarding(): void {
    this.onboardingSeen = true;
    try {
      this.local?.setItem(ONBOARDING_KEY, '1');
    } catch {
      // ignore
    }
  }

  // ---- mutations -------------------------------------------------------------

  /** Rename for everyone (PATCH /api/vaults/:vault, needs vault.manage). */
  async rename(bookID: string, name: string): Promise<void> {
    const b = this.list.find((x) => x.id === bookID);
    const n = name.trim();
    if (!b || !n) return;
    const v = await this.accounts.client(this.accountKeyOf(b)).renameVault(b.vault_id, n);
    this.applyVaultUpdate(b.vault_id, v ?? { ...(this.info[b.vault_id] as Vault), name: n });
  }

  /** `vault.updated` / rename result: refresh name + DTO cache. */
  applyVaultUpdate(vaultID: string, v: Vault): void {
    this.info = { ...this.info, [vaultID]: v };
    if (typeof v.can_edit === 'boolean') this.canEdit = { ...this.canEdit, [vaultID]: v.can_edit };
    this.list = this.list.map((b) => (b.vault_id === vaultID && v.name ? { ...b, name: v.name } : b));
    void this.persist();
    this.syncVaults();
  }

  /** "Trocar servidor…" (§2.4.5). The caller resets cursor/list cache;
   *  persisted Y.Docs (none on the web today) would be kept. */
  switchServer(bookID: string, alt: Alternate): void {
    const b = this.list.find((x) => x.id === bookID);
    if (!b) return;
    const prevAlt: Alternate = {
      server_url: b.server_url,
      account: b.account,
      federation_role: this.info[b.vault_id]?.federation?.role ?? null,
    };
    const nb = switchBinding(b, alt);
    this.list = this.list.map((x) => (x.id === bookID ? nb : x));
    const others = (this.alternates[b.vault_id] ?? []).filter(
      (a) => !(a.server_url === alt.server_url && a.account === alt.account),
    );
    this.alternates = { ...this.alternates, [b.vault_id]: [...others, prevAlt] };
    const src = this.sources.get(bookAccountKey(nb));
    const v = src?.vaults.find((x) => x.id === b.vault_id);
    const info = { ...this.info };
    if (v) info[b.vault_id] = v;
    else delete info[b.vault_id];
    this.info = info;
    const revoked = { ...this.revoked };
    delete revoked[bookID];
    this.revoked = revoked;
    void this.persist();
    this.syncVaults();
  }

  /** "Remover da lista": local only — never deletes the server vault. */
  removeFromList(bookID: string): void {
    const b = this.list.find((x) => x.id === bookID);
    if (!b) return;
    this.list = this.list.filter((x) => x.id !== bookID);
    for (const src of this.sources.values()) src.vaults = src.vaults.filter((v) => v.id !== b.vault_id);
    const revoked = { ...this.revoked };
    delete revoked[bookID];
    this.revoked = revoked;
    void this.durable.delete('books', bookID).catch(() => {});
    if (this.activeID === bookID) this.activeID = resolveActive(this.list, null)?.id ?? null;
    if (!this.active) this.pickerOpen = true;
    void this.persist();
    this.syncVaults();
  }

  /** Account removed from this device: its books go too (§LGPD). */
  removeAccount(key: string): void {
    this.sources.delete(key);
    const gone = this.list.filter((b) => this.accountKeyOf(b) === key);
    for (const b of gone) void this.durable.delete('books', b.id).catch(() => {});
    this.list = this.list.filter((b) => this.accountKeyOf(b) !== key);
    const alts: Record<string, Alternate[]> = {};
    for (const [vid, list] of Object.entries(this.alternates)) {
      const f = list.filter((a) => `${a.server_url}#${a.account}` !== key);
      if (f.length) alts[vid] = f;
    }
    this.alternates = alts;
    if (this.active == null) this.activeID = resolveActive(this.list, null)?.id ?? null;
    void this.persist();
    this.syncVaults();
  }

  /** A vault created through this client: becomes a book right away. */
  addCreated(v: Vault, key: string | null): void {
    const k = key ?? this.activeAccountKey();
    const a = k ? this.accounts.get(k) : null;
    if (!a) return;
    const src = this.sources.get(a.key) ?? { server_url: a.server_url, username: a.username, added_at: a.added_at, vaults: [] };
    src.vaults = [v, ...src.vaults.filter((x) => x.id !== v.id)];
    this.sources.set(a.key, src);
    this.reconcile(false);
  }

  markRevoked(vaultID: string, accountKeyOf: string, reason: string): void {
    const b = this.bookForVault(vaultID);
    // Events for a vault bound to ANOTHER account (an alternate) are
    // ignored (§2.4.4).
    if (!b || this.accountKeyOf(b) !== accountKeyOf) return;
    this.revoked = { ...this.revoked, [b.id]: reason };
  }

  clearRevoked(vaultID: string): void {
    const b = this.bookForVault(vaultID);
    if (!b || !(b.id in this.revoked)) return;
    const r = { ...this.revoked };
    delete r[b.id];
    this.revoked = r;
  }

  setCanEdit(vaultID: string, can: boolean | undefined): void {
    if (typeof can !== 'boolean' || this.canEdit[vaultID] === can) return;
    this.canEdit = { ...this.canEdit, [vaultID]: can };
  }

  pushBanner(b: Omit<Banner, 'id'>): void {
    if (this.banners.some((x) => x.kind === b.kind && x.text === b.text)) return;
    this.banners = [...this.banners, { ...b, id: `b${++this.bannerSeq}` }];
  }

  dismissBanner(id: string): void {
    this.banners = this.banners.filter((b) => b.id !== id);
  }

  /** Next `sort` value (passos de 10). */
  nextSort(): number {
    return this.list.reduce((m, b) => Math.max(m, b.sort), 0) + SORT_STEP;
  }

  clear(): void {
    this.list = [];
    this.alternates = {};
    this.info = {};
    this.canEdit = {};
    this.revoked = {};
    this.banners = [];
    this.activeID = null;
    this.pickerOpen = false;
    this.sources.clear();
    this.syncVaults();
  }

  // ---- persistence + facade ------------------------------------------------------

  private async persist(): Promise<void> {
    const tabRows: Book[] = [];
    for (const b of this.list) {
      const a = this.accounts.get(this.accountKeyOf(b));
      if (a?.remember) {
        try {
          await this.durable.put('books', b.id, $state.snapshot(b));
        } catch (e) {
          console.warn('books: durable write failed', e);
        }
      } else {
        tabRows.push($state.snapshot(b) as Book);
        // Was it remembered before (account switched to tab-only)?
        void this.durable.delete('books', b.id).catch(() => {});
      }
    }
    try {
      if (tabRows.length) this.tab?.setItem(TAB_BOOKS_KEY, JSON.stringify(tabRows));
      else this.tab?.removeItem(TAB_BOOKS_KEY);
    } catch {
      // ignore
    }
  }

  /** Drive the legacy `vaults` facade used by existing components. */
  syncVaults(): void {
    vaults.list = this.ordered.map(
      (b) =>
        this.info[b.vault_id] ?? {
          id: b.vault_id,
          slug: '',
          name: b.name,
          created_by: '',
          created_at: b.added_at,
          owner_user_id: '',
        },
    );
    vaults.selectedID = this.pickerOpen ? null : (this.active?.vault_id ?? null);
  }
}

export const books = new BooksStore();

// Legacy facade hooks: `vaults.load/select/create` route through books.
vaults.hooks = {
  load: () => books.refreshAll(),
  select: (id) => books.openByVault(id),
  created: (v, key) => books.addCreated(v, key ?? null),
};
