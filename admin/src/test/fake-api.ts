import { vi } from 'vitest';

export const TOKEN = 'lpa_' + 'A'.repeat(43);
export const USER_ID = '6f1c2a8e-4b1d-4c3e-9a7b-1d2e3f4a5b6c';
export const VAULT_ID = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
export const TOKEN_ID = '11111111-2222-4333-8444-555555555555';

export function user(over: Record<string, unknown> = {}) {
	return {
		id: USER_ID,
		username: 'ana',
		display_name: 'Ana',
		state: 'active',
		disabled_at: null,
		failed_logins: 0,
		locked_until: null,
		sessions: 1,
		owned_vaults: 0,
		vaults: 0,
		created_at: '2026-11-01T10:00:00Z',
		...over
	};
}

export function vault(over: Record<string, unknown> = {}) {
	return {
		id: VAULT_ID,
		slug: 'diario',
		name: 'Diário',
		owner: { id: USER_ID, username: 'ana' },
		members: 1,
		federated_members: 0,
		notes: 3,
		crdt_bytes: 2048,
		federation: null,
		created_at: '2026-11-01T10:00:00Z',
		...over
	};
}

export function status(over: Record<string, unknown> = {}) {
	return {
		version: '1.2.3',
		schema_version: 7,
		schema_dirty: false,
		pending_migrations: 0,
		users: 2,
		sessions: 3,
		vaults: 1,
		notes: 10,
		federations: 0,
		feed_connections: 0,
		ws_connections: 1,
		started_at: '2026-11-20T10:00:00Z',
		token: { id: TOKEN_ID, name: 'painel', expires_at: '2099-01-01T00:00:00Z' },
		...over
	};
}

export interface Call {
	method: string;
	url: URL;
	headers: Headers;
	body: unknown;
}

type Route = (call: Call) => Response | Promise<Response>;

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json', ...headers }
	});
}

export const noContent = () => new Response(null, { status: 204 });

/** A fake admin API on globalThis.fetch: `routes` keyed by "METHOD /path" (without /admin/v1). */
export function fakeApi(routes: Record<string, Route>) {
	const calls: Call[] = [];
	const fetch = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
		const url = new URL(String(input));
		const call: Call = {
			method: init.method ?? 'GET',
			url,
			headers: new Headers(init.headers),
			body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined
		};
		calls.push(call);
		const key = `${call.method} ${url.pathname.replace(/^\/admin\/v1/, '')}`;
		const route = routes[key];
		if (!route) return json({ error: 'not_found' }, 404);
		return route(call);
	});
	vi.stubGlobal('fetch', fetch);
	return { calls, fetch };
}
