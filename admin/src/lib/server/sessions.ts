import type { CredentialKind, TokenRef } from '../admin.ts';

const SESSION_COOKIE = 'lumi_admin';
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_SESSIONS = 200;

export interface PanelSession {
	readonly id: string;
	/**
	 * The lpa_ token or the lps_ session token. Lives only here, in this process's memory; never sent to the browser.
	 */
	readonly token: string;
	readonly meta: {
		readonly id: string;
		readonly name: string;
		readonly expiresAt: number;
		/** "session" when signed in with a username + password: "Sair" then revokes it on the server too. */
		readonly kind?: CredentialKind;
		readonly userId?: string;
		readonly username?: string;
	};
	readonly createdAt: number;
	readonly expiresAt: number;
}

export function randomId(): string {
	return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
}

export function tokenMeta(ref: TokenRef): PanelSession['meta'] {
	const expiresAt = Date.parse(ref.expiresAt);
	return {
		id: ref.id,
		name: ref.name,
		expiresAt: Number.isNaN(expiresAt) ? 0 : expiresAt,
		kind: ref.kind,
		userId: ref.user?.id,
		username: ref.user?.username
	};
}

/**
 * Sessions live only in this process's memory: a restart signs everyone out, and the token is never written to disk,
 * a cookie or a page. 12 hours, not sliding, and never past the token's own expiry.
 */
export class SessionStore {
	readonly #sessions = new Map<string, PanelSession>();
	readonly #now: () => number;

	constructor(now: () => number = Date.now) {
		this.#now = now;
	}

	get size(): number {
		return this.#sessions.size;
	}

	create(token: string, meta: PanelSession['meta']): PanelSession {
		const now = this.#now();
		this.sweep();
		while (this.#sessions.size >= MAX_SESSIONS) {
			const oldest = this.#sessions.keys().next().value;
			if (oldest === undefined) break;
			this.#sessions.delete(oldest);
		}
		const session: PanelSession = {
			id: randomId(),
			token,
			meta,
			createdAt: now,
			expiresAt: Math.min(now + SESSION_TTL_MS, meta.expiresAt)
		};
		this.#sessions.set(session.id, session);
		return session;
	}

	get(id: string | undefined): PanelSession | null {
		if (!id || id.length !== 43) return null;
		const session = this.#sessions.get(id);
		if (!session) return null;
		if (session.expiresAt <= this.#now()) {
			this.#sessions.delete(id);
			return null;
		}
		return session;
	}

	delete(id: string | undefined): void {
		if (id) this.#sessions.delete(id);
	}

	/** Every session of a token, e.g. after it was revoked from the panel. */
	deleteToken(tokenId: string): void {
		for (const [id, s] of this.#sessions) if (s.meta.id === tokenId) this.#sessions.delete(id);
	}

	sweep(): void {
		const now = this.#now();
		for (const [id, s] of this.#sessions) if (s.expiresAt <= now) this.#sessions.delete(id);
	}
}

/**
 * Failed logins per key (an IP, or "user:<name>" for the password form): a guard on the calls this panel makes to
 * the API. Short backoff (1 s, 2 s, 4 s… up to a minute) after a few free failures; a malformed token never reaches
 * the API and isn't counted. The API keeps its own limits as well (per IP and per user, and the account lockout).
 */
export class LoginThrottle {
	readonly #failures = new Map<string, { count: number; last: number }>();
	readonly #now: () => number;

	constructor(
		readonly free = 5,
		readonly maxDelayMs = 60_000,
		readonly forgetMs = 15 * 60 * 1000,
		readonly maxEntries = 10_000,
		now: () => number = Date.now
	) {
		this.#now = now;
	}

	get size(): number {
		return this.#failures.size;
	}

	/** Seconds to wait, or 0 when this IP may try. */
	retryAfter(ip: string): number {
		const entry = this.#failures.get(ip);
		if (!entry) return 0;
		const now = this.#now();
		if (now - entry.last >= this.forgetMs) {
			this.#failures.delete(ip);
			return 0;
		}
		if (entry.count < this.free) return 0;
		const delay = Math.min(1000 * 2 ** (entry.count - this.free), this.maxDelayMs);
		const left = entry.last + delay - now;
		return left > 0 ? Math.ceil(left / 1000) : 0;
	}

	fail(ip: string): void {
		const now = this.#now();
		const entry = this.#failures.get(ip);
		this.#failures.delete(ip);
		if (entry && now - entry.last < this.forgetMs) {
			this.#failures.set(ip, { count: Math.min(entry.count + 1, 64), last: now });
			return;
		}
		// Insertion order: the first key is the least recently failed address.
		while (this.#failures.size >= this.maxEntries) {
			const oldest = this.#failures.keys().next().value;
			if (oldest === undefined) break;
			this.#failures.delete(oldest);
		}
		this.#failures.set(ip, { count: 1, last: now });
	}

	succeed(ip: string): void {
		this.#failures.delete(ip);
	}
}

export function isLocalHost(hostname: string): boolean {
	const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
	return h === 'localhost' || h.endsWith('.localhost') || h === '::1' || /^127\./.test(h);
}

/**
 * `__Host-` makes the browser refuse the cookie unless it is Secure, host-only and on Path=/, so no other page can
 * plant or shadow it. Browsers may drop Secure cookies on http://localhost, so the local name stays plain.
 */
export function cookieName(url: URL): string {
	return isLocalHost(url.hostname) ? SESSION_COOKIE : `__Host-${SESSION_COOKIE}`;
}

export function cookieOptions(url: URL) {
	return {
		path: '/',
		httpOnly: true,
		sameSite: 'strict' as const,
		secure: !isLocalHost(url.hostname),
		maxAge: SESSION_TTL_MS / 1000
	};
}

export const sessions = new SessionStore();
export const loginThrottle = new LoginThrottle();
