import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminClient, AdminError, adminErrorMessage, safeAddress } from './admin.ts';
import { TOKEN, USER_ID, fakeApi, json, noContent, status, user } from '../test/fake-api.ts';

afterEach(() => vi.unstubAllGlobals());

const client = (ip?: string) => new AdminClient('http://ts-api:8081/', TOKEN, { forwardedFor: ip });

describe('AdminClient', () => {
	it('sends the bearer token and the panel user address to /admin/v1', async () => {
		const api = fakeApi({ 'GET /status': () => json(status()) });
		const s = await client('100.64.0.7').status();
		expect(s.token.name).toBe('painel');
		expect(s.schemaDirty).toBe(false);
		const call = api.calls[0];
		expect(call.url.href).toBe('http://ts-api:8081/admin/v1/status');
		expect(call.headers.get('Authorization')).toBe(`Bearer ${TOKEN}`);
		expect(call.headers.get('X-Forwarded-For')).toBe('100.64.0.7');
	});

	it('never forwards something that is not an address', () => {
		expect(safeAddress('10.0.0.1')).toBe('10.0.0.1');
		expect(safeAddress('fd7a:115c::1')).toBe('fd7a:115c::1');
		expect(safeAddress('1.2.3.4, 5.6.7.8')).toBeUndefined();
		expect(safeAddress('evil\r\nX: y')).toBeUndefined();
		expect(safeAddress(undefined)).toBeUndefined();
	});

	it('maps the uniform 401 to unauthorized', async () => {
		fakeApi({ 'GET /status': () => json({ error: 'unauthorized' }, 401) });
		await expect(client().status()).rejects.toMatchObject({ kind: 'unauthorized', status: 401 });
	});

	it('reads 429 retry_after_s and the 409 sole_admin_vaults ids', async () => {
		const vid = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
		fakeApi({
			'GET /users': () => json({ error: 'rate_limited', retry_after_s: 12 }, 429, { 'Retry-After': '12' }),
			[`DELETE /users/${USER_ID}`]: () => json({ error: 'sole_admin_vaults', vault_ids: [vid, 'junk'] }, 409)
		});
		const rl = await client().users().catch((e: unknown) => e);
		expect(rl).toBeInstanceOf(AdminError);
		expect(adminErrorMessage(rl)).toContain('12 s');
		const sole = (await client().deleteUser(USER_ID).catch((e: unknown) => e)) as AdminError;
		expect(sole.kind).toBe('soleAdminVaults');
		expect(sole.details.vaultIds).toEqual([vid]);
	});

	it('adds delete_owned_vaults only when asked', async () => {
		const api = fakeApi({ [`DELETE /users/${USER_ID}`]: () => noContent() });
		await client().deleteUser(USER_ID);
		await client().deleteUser(USER_ID, true);
		expect(api.calls.map((c) => c.url.search)).toEqual(['', '?delete_owned_vaults=true']);
	});

	it('refuses malformed ids without calling the API', async () => {
		const api = fakeApi({});
		await expect(client().user('../tokens')).rejects.toMatchObject({ kind: 'notFound' });
		await expect(client().revokeSession('abc')).rejects.toMatchObject({ kind: 'notFound' });
		expect(api.calls).toHaveLength(0);
	});

	it('rejects a response that breaks the contract', async () => {
		fakeApi({ [`GET /users/${USER_ID}`]: () => json(user({ state: 'banned' })) });
		await expect(client().user(USER_ID)).rejects.toMatchObject({ kind: 'invalidResponse' });
	});

	it('decodes pages and the audit log', async () => {
		fakeApi({
			'GET /users': () => json({ items: [user({ owned_vault_ids: undefined })], more: true, next: 'YW5h' }),
			'GET /audit': (c) => {
				expect(c.url.searchParams.get('scope')).toBe('admin');
				expect(c.url.searchParams.get('before')).toBe('40');
				return json({
					entries: [{ id: 39, created_at: 'x', action: 'admin.user.disable', user_id: USER_ID, vault_id: null, ip: '100.64.0.7', user_agent: null, payload: { token_name: 'painel' } }],
					more: false,
					next: null
				});
			}
		});
		const p = await client().users({ limit: 50 });
		expect(p).toMatchObject({ more: true, next: 'YW5h' });
		expect(p.items[0].ownedVaultIds).toBeNull();
		const a = await client().audit({ scope: 'admin', before: 40 });
		expect(a.entries[0].payload).toEqual({ token_name: 'painel' });
	});

	it('reports an unreachable API as offline', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));
		await expect(client().status()).rejects.toMatchObject({ kind: 'offline' });
	});

	it('sends JSON bodies for create and password', async () => {
		const api = fakeApi({
			'POST /users': () => json(user(), 201),
			[`POST /users/${USER_ID}/password`]: () => noContent()
		});
		await client().createUser('ana', 'segredo-longo', '');
		await client().setPassword(USER_ID, 'outro-segredo');
		expect(api.calls[0].body).toEqual({ username: 'ana', password: 'segredo-longo' });
		expect(api.calls[0].headers.get('Content-Type')).toBe('application/json');
		expect(api.calls[1].body).toEqual({ password: 'outro-segredo' });
	});
});
