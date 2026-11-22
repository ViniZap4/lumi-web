/**
 * Client for the lumi-server admin API (server/docs/ADMIN.md). It runs only in the panel's Node process: the
 * browser never talks to the admin listener and never sees the token. Responses are validated field by field, so a
 * changed contract fails loudly here instead of rendering garbage.
 */

export type UserState = 'active' | 'disabled' | 'locked';
export type TokenState = 'active' | 'expired' | 'revoked';
export type FederationStatus = 'active' | 'revoked' | 'severed';
export type FederationRole = 'home' | 'follower';
export type InviteState = 'active' | 'expired' | 'revoked' | 'exhausted';

export interface TokenRef {
	readonly id: string;
	readonly name: string;
	readonly expiresAt: string;
}

export interface AdminStatus {
	readonly version: string;
	readonly schemaVersion: number;
	readonly schemaDirty: boolean;
	readonly pendingMigrations: number;
	readonly users: number;
	readonly sessions: number;
	readonly vaults: number;
	readonly notes: number;
	readonly federations: number;
	readonly feedConnections: number;
	readonly wsConnections: number;
	readonly startedAt: string;
	readonly token: TokenRef;
	/** Round trip of a trivial query, in milliseconds. */
	readonly dbLatencyMs: number;
	readonly usersDisabled: number;
	readonly usersLocked: number;
	readonly crdtBytes: number;
	readonly logins24h: number;
	readonly loginFailures24h: number;
	readonly invitesActive: number;
	readonly goVersion: string;
}

export interface AdminUser {
	readonly id: string;
	readonly username: string;
	readonly displayName: string;
	readonly state: UserState;
	readonly disabledAt: string | null;
	readonly failedLogins: number;
	readonly lockedUntil: string | null;
	readonly sessions: number;
	readonly ownedVaults: number;
	readonly vaults: number;
	readonly createdAt: string;
	/** Newest auth.login in the audit log. */
	readonly lastLoginAt: string | null;
	/** Newest use of any live session. */
	readonly lastSeenAt: string | null;
	/** Only from GET /users/{id}. */
	readonly ownedVaultIds: readonly string[] | null;
}

export interface AdminSession {
	/** SHA-256 hex of the stored token: names the session, can't authenticate. */
	readonly id: string;
	readonly userId: string;
	readonly username: string;
	readonly createdAt: string;
	readonly lastUsedAt: string;
	readonly expiresAt: string;
}

export interface AdminVault {
	readonly id: string;
	readonly slug: string;
	readonly name: string;
	readonly owner: { readonly id: string; readonly username: string };
	readonly members: number;
	readonly federatedMembers: number;
	readonly notes: number;
	readonly crdtBytes: number;
	readonly federation: { readonly role: FederationRole; readonly activeLinks: number } | null;
	readonly createdAt: string;
	/** The vault's change sequence (vault_heads.seq). */
	readonly headSeq: number;
	readonly lastChangeAt: string | null;
	readonly invitesActive: number;
}

export interface Ref {
	readonly id: string;
	readonly username: string;
}

export interface VaultMember {
	readonly user: Ref;
	readonly displayName: string;
	readonly role: { readonly id: string; readonly name: string };
	readonly owner: boolean;
	readonly joinedAt: string;
}

export interface VaultRole {
	readonly id: string;
	readonly name: string;
	readonly seed: boolean;
	readonly members: number;
}

export interface VaultMembers {
	readonly members: readonly VaultMember[];
	readonly roles: readonly VaultRole[];
}

export interface AdminInvite {
	/** SHA-256 hex of the invite token: names the invite, can't be used to join. */
	readonly id: string;
	readonly vault: { readonly id: string; readonly slug: string; readonly name: string };
	readonly inviter: Ref;
	readonly role: { readonly id: string; readonly name: string };
	readonly emailHint: string | null;
	readonly maxUses: number;
	readonly useCount: number;
	readonly state: InviteState;
	readonly expiresAt: string;
	readonly createdAt: string;
	readonly revokedAt: string | null;
}

export interface AdminFederation {
	readonly id: string;
	readonly vault: { readonly id: string; readonly slug: string; readonly name: string };
	readonly role: FederationRole;
	readonly peerUrl: string;
	readonly jurisdiction: string | null;
	readonly status: FederationStatus;
	readonly lastAckedSeq: number;
	readonly controlSeq: number | null;
	readonly createdAt: string;
	readonly revokedAt: string | null;
}

export interface AdminToken {
	readonly id: string;
	readonly name: string;
	readonly state: TokenState;
	readonly createdAt: string;
	readonly lastUsedAt: string | null;
	readonly expiresAt: string;
	readonly revokedAt: string | null;
	readonly current: boolean;
}

export interface AuditEntry {
	readonly id: number;
	readonly createdAt: string;
	readonly action: string;
	readonly userId: string | null;
	readonly vaultId: string | null;
	readonly ip: string | null;
	readonly userAgent: string | null;
	readonly payload: unknown;
}

export interface Page<T> {
	readonly items: readonly T[];
	readonly more: boolean;
	readonly next: string | null;
}

export interface AuditPage {
	readonly entries: readonly AuditEntry[];
	readonly more: boolean;
	readonly next: string | null;
}

export interface PageOptions {
	readonly after?: string;
	readonly limit?: number;
}

export interface AuditQuery {
	readonly before?: number;
	readonly limit?: number;
	readonly scope?: 'all' | 'admin';
	readonly user?: string;
	readonly vault?: string;
	/** An exact action, or a prefix written as "auth.*". */
	readonly action?: string;
	/** RFC 3339; created_at >= since. */
	readonly since?: string;
	/** RFC 3339; created_at < until. */
	readonly until?: string;
}

export type UserStateFilter = UserState;

/** The ?action= shape the API accepts (ADMIN.md): an exact action or a "prefix.*". */
export function isAuditAction(value: string): boolean {
	return value.length <= 64 && /^[a-z_]+(\.[a-z_]+)*(\.\*)?$/.test(value);
}

// ---- errors -------------------------------------------------------------------

export type AdminErrorKind =
	| 'unauthorized'
	| 'notFound'
	| 'invalid'
	| 'conflict'
	| 'soleAdminVaults'
	| 'tooLarge'
	| 'rateLimited'
	| 'server'
	| 'offline'
	| 'invalidResponse'
	| 'unexpectedStatus';

export class AdminError extends Error {
	override readonly name = 'AdminError';
	constructor(
		readonly kind: AdminErrorKind,
		readonly status?: number,
		readonly details: {
			readonly detail?: string;
			readonly field?: string;
			readonly retryAfter?: number | null;
			readonly vaultIds?: readonly string[];
		} = {},
		options?: ErrorOptions
	) {
		super(status === undefined ? kind : `${kind} (${status})`, options);
	}
}

function retrySeconds(raw: string | null, body: Record<string, unknown> | null): number | null {
	const fromBody = body?.retry_after_s;
	if (typeof fromBody === 'number' && Number.isFinite(fromBody)) return clampRetry(fromBody);
	if (raw === null || raw.trim() === '') return null;
	const n = Number(raw.trim());
	return Number.isFinite(n) ? clampRetry(n) : null;
}

function clampRetry(n: number): number {
	return Math.min(Math.max(Math.ceil(n), 0), 3600);
}

/** Maps the API's `{"error", "detail"?, "field"?}` bodies (ADMIN.md, Regras) onto an error kind. */
export function adminErrorFor(
	status: number,
	body: Record<string, unknown> | null,
	retryAfter: string | null
): AdminError {
	const code = typeof body?.error === 'string' ? body.error : undefined;
	const detail = typeof body?.detail === 'string' && body.detail ? body.detail : undefined;
	const field = typeof body?.field === 'string' && body.field ? body.field : undefined;
	// The API answers every bad token with the same 401; a 403 never comes from it, but means the same here.
	if (status === 401 || status === 403) return new AdminError('unauthorized', status);
	if (status === 404) return new AdminError('notFound', status);
	if (status === 400) return new AdminError('invalid', status, { detail, field });
	if (status === 409 && code === 'sole_admin_vaults') {
		const ids = Array.isArray(body?.vault_ids)
			? body.vault_ids.filter((v): v is string => typeof v === 'string' && isUUID(v))
			: [];
		return new AdminError('soleAdminVaults', status, { vaultIds: ids });
	}
	if (status === 409) return new AdminError('conflict', status, { detail });
	if (status === 413) return new AdminError('tooLarge', status);
	if (status === 429) {
		return new AdminError('rateLimited', status, { retryAfter: retrySeconds(retryAfter, body) });
	}
	if (status >= 500 && status <= 599) return new AdminError('server', status, { detail });
	return new AdminError('unexpectedStatus', status, { detail });
}

const fieldMessages: Record<string, string> = {
	username:
		'Nome de usuário inválido: de 3 a 32 caracteres entre a-z, 0-9, _ e -, em minúsculas, sem separador nas pontas.',
	password:
		'Senha inválida: de 8 a 72 bytes, não só dígitos; só com letras, pelo menos 10 caracteres.',
	display_name: 'Nome de exibição com no máximo 80 caracteres.'
};

const conflictMessages: [RegExp, string][] = [
	[/username/i, 'Esse nome de usuário já está em uso.'],
	[/not active|already revoked|revoked/i, 'Esse vínculo de federação já não estava ativo.']
];

/** A Portuguese sentence for an API failure; `overrides` replace the message for a kind. */
export function adminErrorMessage(
	error: unknown,
	overrides: Partial<Record<AdminErrorKind, string>> = {}
): string {
	if (!(error instanceof AdminError)) return 'O painel teve um erro inesperado.';
	const own = overrides[error.kind];
	if (own) return own;
	switch (error.kind) {
		case 'unauthorized':
			return 'O token deixou de valer (expirou ou foi revogado).';
		case 'notFound':
			return 'Não encontrado: talvez já tenha sido apagado.';
		case 'invalid': {
			const f = error.details.field;
			if (f && fieldMessages[f]) return fieldMessages[f];
			return error.details.detail
				? `O servidor recusou os dados: ${error.details.detail}`
				: 'O servidor recusou os dados.';
		}
		case 'conflict': {
			const d = error.details.detail ?? '';
			for (const [re, msg] of conflictMessages) if (re.test(d)) return msg;
			return d ? `Conflito: ${d}` : 'A ação conflita com o estado atual do servidor.';
		}
		case 'soleAdminVaults':
			return 'Este usuário é dono de cofres. Confirme que os cofres também serão apagados.';
		case 'tooLarge':
			return 'Os dados enviados são grandes demais.';
		case 'rateLimited': {
			const s = error.details.retryAfter;
			return s ? `Muitas tentativas. Tente de novo em ${s} s.` : 'Muitas tentativas. Aguarde um pouco.';
		}
		case 'server':
			return 'O servidor do lumi teve um erro interno. Veja os logs (component=admin).';
		case 'offline':
			return 'A API de administração não respondeu. O servidor está no ar e com LUMI_ADMIN_ADDR ligado?';
		case 'invalidResponse':
			return 'A API de administração respondeu num formato inesperado (versões diferentes?).';
		default:
			return `A API de administração respondeu com um status inesperado (${error.status ?? '?'}).`;
	}
}

// ---- decoding -------------------------------------------------------------------

class Shape extends Error {}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUUID(value: string): boolean {
	return UUID.test(value);
}

/** Session ids are the SHA-256 hex of the token (ADMIN.md, Formatos). */
export function isSessionId(value: string): boolean {
	return /^[0-9a-f]{64}$/.test(value);
}

/** Invite ids are the SHA-256 hex of the invite token, like sessions. */
export const isInviteId = isSessionId;

function object(v: unknown): Record<string, unknown> {
	if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Shape('object');
	return v as Record<string, unknown>;
}
function str(v: unknown): string {
	if (typeof v !== 'string') throw new Shape('string');
	return v;
}
function strOrNull(v: unknown): string | null {
	return v === null || v === undefined ? null : str(v);
}
function int(v: unknown): number {
	if (typeof v !== 'number' || !Number.isSafeInteger(v)) throw new Shape('int');
	return v;
}
function intOrNull(v: unknown): number | null {
	return v === null || v === undefined ? null : int(v);
}
function num(v: unknown): number {
	if (typeof v !== 'number' || !Number.isFinite(v)) throw new Shape('number');
	return v;
}
function bool(v: unknown): boolean {
	if (typeof v !== 'boolean') throw new Shape('bool');
	return v;
}
function uuid(v: unknown): string {
	const s = str(v);
	if (!isUUID(s)) throw new Shape('uuid');
	return s.toLowerCase();
}
function uuidOrNull(v: unknown): string | null {
	return v === null || v === undefined ? null : uuid(v);
}
function oneOf<T extends string>(v: unknown, values: readonly T[]): T {
	const s = str(v);
	if (!(values as readonly string[]).includes(s)) throw new Shape('enum');
	return s as T;
}
function list<T>(v: unknown, item: (raw: unknown) => T): T[] {
	if (!Array.isArray(v)) throw new Shape('array');
	return v.map(item);
}
function page<T>(raw: unknown, item: (raw: unknown) => T): Page<T> {
	const o = object(raw);
	return { items: list(o.items, item), more: bool(o.more), next: strOrNull(o.next) };
}

export function decodeUser(raw: unknown): AdminUser {
	const o = object(raw);
	return {
		id: uuid(o.id),
		username: str(o.username),
		displayName: str(o.display_name),
		state: oneOf(o.state, ['active', 'disabled', 'locked'] as const),
		disabledAt: strOrNull(o.disabled_at),
		failedLogins: int(o.failed_logins),
		lockedUntil: strOrNull(o.locked_until),
		sessions: int(o.sessions),
		ownedVaults: int(o.owned_vaults),
		vaults: int(o.vaults),
		createdAt: str(o.created_at),
		lastLoginAt: strOrNull(o.last_login_at),
		lastSeenAt: strOrNull(o.last_seen_at),
		ownedVaultIds: o.owned_vault_ids === undefined ? null : list(o.owned_vault_ids, uuid)
	};
}

function decodeSession(raw: unknown): AdminSession {
	const o = object(raw);
	const id = str(o.id);
	if (!isSessionId(id)) throw new Shape('session id');
	return {
		id,
		userId: uuid(o.user_id),
		username: str(o.username),
		createdAt: str(o.created_at),
		lastUsedAt: str(o.last_used_at),
		expiresAt: str(o.expires_at)
	};
}

export function decodeVault(raw: unknown): AdminVault {
	const o = object(raw);
	const owner = object(o.owner);
	const fed = o.federation === null || o.federation === undefined ? null : object(o.federation);
	return {
		id: uuid(o.id),
		slug: str(o.slug),
		name: str(o.name),
		owner: { id: uuid(owner.id), username: str(owner.username) },
		members: int(o.members),
		federatedMembers: int(o.federated_members),
		notes: int(o.notes),
		crdtBytes: int(o.crdt_bytes),
		federation: fed
			? {
					role: oneOf(fed.role, ['home', 'follower'] as const),
					activeLinks: int(fed.active_links)
				}
			: null,
		createdAt: str(o.created_at),
		headSeq: int(o.head_seq),
		lastChangeAt: strOrNull(o.last_change_at),
		invitesActive: int(o.invites_active)
	};
}

function ref(raw: unknown): Ref {
	const o = object(raw);
	return { id: uuid(o.id), username: str(o.username) };
}

function roleRef(raw: unknown): { id: string; name: string } {
	const o = object(raw);
	return { id: uuid(o.id), name: str(o.name) };
}

export function decodeMembers(raw: unknown): VaultMembers {
	const o = object(raw);
	return {
		members: list(o.members, (m) => {
			const x = object(m);
			return {
				user: ref(x.user),
				displayName: str(x.display_name),
				role: roleRef(x.role),
				owner: bool(x.owner),
				joinedAt: str(x.joined_at)
			};
		}),
		roles: list(o.roles, (r) => {
			const x = object(r);
			return { id: uuid(x.id), name: str(x.name), seed: bool(x.seed), members: int(x.members) };
		})
	};
}

export function decodeInvite(raw: unknown): AdminInvite {
	const o = object(raw);
	const id = str(o.id);
	if (!isInviteId(id)) throw new Shape('invite id');
	const v = object(o.vault);
	const inviter = object(o.inviter);
	return {
		id,
		vault: { id: uuid(v.id), slug: str(v.slug), name: str(v.name) },
		inviter: { id: uuid(inviter.id), username: str(inviter.username) },
		role: roleRef(o.role),
		emailHint: strOrNull(o.email_hint),
		maxUses: int(o.max_uses),
		useCount: int(o.use_count),
		state: oneOf(o.state, ['active', 'expired', 'revoked', 'exhausted'] as const),
		expiresAt: str(o.expires_at),
		createdAt: str(o.created_at),
		revokedAt: strOrNull(o.revoked_at)
	};
}

function decodeFederation(raw: unknown): AdminFederation {
	const o = object(raw);
	const v = object(o.vault);
	return {
		id: uuid(o.id),
		vault: { id: uuid(v.id), slug: str(v.slug), name: str(v.name) },
		role: oneOf(o.role, ['home', 'follower'] as const),
		peerUrl: str(o.peer_url),
		jurisdiction: strOrNull(o.jurisdiction),
		status: oneOf(o.status, ['active', 'revoked', 'severed'] as const),
		lastAckedSeq: int(o.last_acked_seq),
		controlSeq: intOrNull(o.control_seq),
		createdAt: str(o.created_at),
		revokedAt: strOrNull(o.revoked_at)
	};
}

function decodeToken(raw: unknown): AdminToken {
	const o = object(raw);
	return {
		id: uuid(o.id),
		name: str(o.name),
		state: oneOf(o.state, ['active', 'expired', 'revoked'] as const),
		createdAt: str(o.created_at),
		lastUsedAt: strOrNull(o.last_used_at),
		expiresAt: str(o.expires_at),
		revokedAt: strOrNull(o.revoked_at),
		current: bool(o.current)
	};
}

function decodeAudit(raw: unknown): AuditEntry {
	const o = object(raw);
	return {
		id: int(o.id),
		createdAt: str(o.created_at),
		action: str(o.action),
		userId: uuidOrNull(o.user_id),
		vaultId: uuidOrNull(o.vault_id),
		ip: strOrNull(o.ip),
		userAgent: strOrNull(o.user_agent),
		payload: o.payload ?? null
	};
}

export function decodeStatus(raw: unknown): AdminStatus {
	const o = object(raw);
	const t = object(o.token);
	return {
		version: str(o.version),
		schemaVersion: int(o.schema_version),
		schemaDirty: bool(o.schema_dirty),
		pendingMigrations: int(o.pending_migrations),
		users: int(o.users),
		sessions: int(o.sessions),
		vaults: int(o.vaults),
		notes: int(o.notes),
		federations: int(o.federations),
		feedConnections: int(o.feed_connections),
		wsConnections: int(o.ws_connections),
		startedAt: str(o.started_at),
		token: { id: uuid(t.id), name: str(t.name), expiresAt: str(t.expires_at) },
		dbLatencyMs: num(o.db_latency_ms),
		usersDisabled: int(o.users_disabled),
		usersLocked: int(o.users_locked),
		crdtBytes: int(o.crdt_bytes),
		logins24h: int(o.logins_24h),
		loginFailures24h: int(o.login_failures_24h),
		invitesActive: int(o.invites_active),
		goVersion: str(o.go_version)
	};
}

// ---- client ---------------------------------------------------------------------

export type AdminFetch = (input: string, init: RequestInit) => Promise<Response>;

export interface AdminClientOptions {
	readonly fetch?: AdminFetch;
	readonly timeoutMs?: number;
	/** The panel user's address, sent as X-Forwarded-For for the audit and the failure budget. */
	readonly forwardedFor?: string;
}

/** Only an address: anything else would let a header value reach the request unchecked. */
export function safeAddress(ip: string | undefined): string | undefined {
	const v = ip?.trim();
	return v && /^[0-9A-Fa-f:.]{2,45}$/.test(v) ? v : undefined;
}

function pathId(value: string): string {
	if (!isUUID(value)) throw new AdminError('notFound', 404);
	return value.toLowerCase();
}

function query(params: Record<string, string | number | boolean | undefined>): string {
	const q = new URLSearchParams();
	for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') q.set(k, String(v));
	const s = q.toString();
	return s ? `?${s}` : '';
}

export class AdminClient {
	readonly baseURL: string;
	readonly #token: string;
	readonly #fetch: AdminFetch;
	readonly #timeoutMs: number;
	readonly #forwardedFor: string | undefined;

	constructor(baseURL: string, token: string, options: AdminClientOptions = {}) {
		const url = new URL(baseURL);
		if (url.protocol !== 'http:' && url.protocol !== 'https:') {
			throw new TypeError('the admin API URL must be http or https');
		}
		this.baseURL = url.href.replace(/\/+$/, '');
		this.#token = token;
		this.#fetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
		this.#timeoutMs = options.timeoutMs ?? 15_000;
		this.#forwardedFor = safeAddress(options.forwardedFor);
	}

	async status(): Promise<AdminStatus> {
		return this.#json('GET', '/status', undefined, decodeStatus);
	}

	async users(o: PageOptions & { q?: string; state?: UserStateFilter } = {}): Promise<Page<AdminUser>> {
		const qs = query({ q: o.q, state: o.state, after: o.after, limit: o.limit });
		return this.#json('GET', `/users${qs}`, undefined, (r) => page(r, decodeUser));
	}

	async user(id: string): Promise<AdminUser> {
		return this.#json('GET', `/users/${pathId(id)}`, undefined, decodeUser);
	}

	async createUser(username: string, password: string, displayName = ''): Promise<AdminUser> {
		const body: Record<string, string> = { username, password };
		if (displayName) body.display_name = displayName;
		return this.#json('POST', '/users', body, decodeUser);
	}

	async setPassword(id: string, password: string): Promise<void> {
		return this.#empty('POST', `/users/${pathId(id)}/password`, { password });
	}

	async disableUser(id: string): Promise<void> {
		return this.#empty('POST', `/users/${pathId(id)}/disable`);
	}

	async enableUser(id: string): Promise<void> {
		return this.#empty('POST', `/users/${pathId(id)}/enable`);
	}

	async unlockUser(id: string): Promise<void> {
		return this.#empty('POST', `/users/${pathId(id)}/unlock`);
	}

	/** Ends every session of the user; resolves to how many there were. */
	async revokeUserSessions(id: string): Promise<number> {
		return this.#json('DELETE', `/users/${pathId(id)}/sessions`, undefined, (r) => int(object(r).revoked));
	}

	async deleteUser(id: string, deleteOwnedVaults = false): Promise<void> {
		const q = deleteOwnedVaults ? '?delete_owned_vaults=true' : '';
		return this.#empty('DELETE', `/users/${pathId(id)}${q}`);
	}

	async sessions(o: PageOptions & { user?: string } = {}): Promise<Page<AdminSession>> {
		const user = o.user === undefined ? undefined : pathId(o.user);
		return this.#json(
			'GET',
			`/sessions${query({ user, after: o.after, limit: o.limit })}`,
			undefined,
			(r) => page(r, decodeSession)
		);
	}

	async revokeSession(id: string): Promise<void> {
		if (!isSessionId(id)) return Promise.reject(new AdminError('notFound', 404));
		return this.#empty('DELETE', `/sessions/${id}`);
	}

	async vaults(o: PageOptions & { user?: string; q?: string } = {}): Promise<Page<AdminVault>> {
		const user = o.user === undefined ? undefined : pathId(o.user);
		return this.#json(
			'GET',
			`/vaults${query({ user, q: o.q, after: o.after, limit: o.limit })}`,
			undefined,
			(r) => page(r, decodeVault)
		);
	}

	async vault(id: string): Promise<AdminVault> {
		return this.#json('GET', `/vaults/${pathId(id)}`, undefined, decodeVault);
	}

	async deleteVault(id: string): Promise<void> {
		return this.#empty('DELETE', `/vaults/${pathId(id)}`);
	}

	async vaultMembers(id: string): Promise<VaultMembers> {
		return this.#json('GET', `/vaults/${pathId(id)}/members`, undefined, decodeMembers);
	}

	async invites(o: PageOptions & { vault?: string; state?: 'active' | 'all' } = {}): Promise<Page<AdminInvite>> {
		const vault = o.vault === undefined ? undefined : pathId(o.vault);
		const qs = query({ vault, state: o.state, after: o.after, limit: o.limit });
		return this.#json('GET', `/invites${qs}`, undefined, (r) => page(r, decodeInvite));
	}

	async revokeInvite(id: string): Promise<void> {
		if (!isInviteId(id)) return Promise.reject(new AdminError('notFound', 404));
		return this.#empty('DELETE', `/invites/${id}`);
	}

	async federations(o: PageOptions & { vault?: string } = {}): Promise<Page<AdminFederation>> {
		const vault = o.vault === undefined ? undefined : pathId(o.vault);
		return this.#json(
			'GET',
			`/federations${query({ vault, after: o.after, limit: o.limit })}`,
			undefined,
			(r) => page(r, decodeFederation)
		);
	}

	async revokeFederation(id: string): Promise<void> {
		return this.#empty('DELETE', `/federations/${pathId(id)}`);
	}

	async tokens(o: PageOptions = {}): Promise<Page<AdminToken>> {
		return this.#json('GET', `/tokens${query({ after: o.after, limit: o.limit })}`, undefined, (r) =>
			page(r, decodeToken)
		);
	}

	async revokeToken(id: string): Promise<void> {
		return this.#empty('DELETE', `/tokens/${pathId(id)}`);
	}

	async audit(q: AuditQuery = {}): Promise<AuditPage> {
		const user = q.user === undefined ? undefined : pathId(q.user);
		const vault = q.vault === undefined ? undefined : pathId(q.vault);
		if (q.action !== undefined && !isAuditAction(q.action)) throw new AdminError('invalid', 400, { field: 'action' });
		const qs = query({
			before: q.before,
			limit: q.limit,
			scope: q.scope,
			user,
			vault,
			action: q.action,
			since: q.since,
			until: q.until
		});
		return this.#json('GET', `/audit${qs}`, undefined, (raw) => {
			const o = object(raw);
			return { entries: list(o.entries, decodeAudit), more: bool(o.more), next: strOrNull(o.next) };
		});
	}

	async #json<T>(method: string, path: string, body: unknown, decode: (raw: unknown) => T): Promise<T> {
		const res = await this.#send(method, path, body);
		let raw: unknown;
		try {
			raw = await res.json();
		} catch (cause) {
			throw new AdminError('invalidResponse', res.status, {}, { cause });
		}
		try {
			return decode(raw);
		} catch (cause) {
			throw new AdminError('invalidResponse', res.status, {}, { cause });
		}
	}

	async #empty(method: string, path: string, body?: unknown): Promise<void> {
		const res = await this.#send(method, path, body);
		if (res.status !== 204) {
			await res.body?.cancel();
			throw new AdminError('unexpectedStatus', res.status);
		}
	}

	async #send(method: string, path: string, body: unknown): Promise<Response> {
		const headers: Record<string, string> = {
			Authorization: `Bearer ${this.#token}`,
			Accept: 'application/json'
		};
		if (this.#forwardedFor) headers['X-Forwarded-For'] = this.#forwardedFor;
		if (body !== undefined) headers['Content-Type'] = 'application/json';
		let res: Response;
		try {
			res = await this.#fetch(`${this.baseURL}/admin/v1${path}`, {
				method,
				headers,
				body: body === undefined ? undefined : JSON.stringify(body),
				redirect: 'error',
				signal: AbortSignal.timeout(this.#timeoutMs)
			});
		} catch (cause) {
			throw new AdminError('offline', undefined, {}, { cause });
		}
		if (res.ok) return res;
		let parsed: Record<string, unknown> | null = null;
		try {
			const raw: unknown = await res.json();
			parsed = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
		} catch {
			parsed = null;
		}
		throw adminErrorFor(res.status, parsed, res.headers.get('Retry-After'));
	}
}
