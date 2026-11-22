import { afterEach, describe, expect, it, vi } from 'vitest';
import { load as overviewLoad } from '../routes/(painel)/+page.server.ts';
import { actions as usersActions, load as usersLoad } from '../routes/(painel)/usuarios/+page.server.ts';
import { actions as userActions } from '../routes/(painel)/usuarios/[id]/+page.server.ts';
import { actions as vaultActions, load as vaultLoad } from '../routes/(painel)/cofres/[id]/+page.server.ts';
import { actions as inviteActions } from '../routes/(painel)/convites/+page.server.ts';
import { load as auditLoad } from '../routes/(painel)/auditoria/+page.server.ts';
import { GET as exportAudit } from '../routes/(painel)/auditoria/exportar/+server.ts';
import { USER_ID, VAULT_ID, fakeApi, json, noContent, status, user, vault } from './fake-api.ts';
import { actionEvent, outcome } from './event.ts';

type Any = (e: never) => unknown;
const run = (fn: unknown, ev: unknown) => outcome(() => (fn as Any)(ev as never));
const empty = { items: [], more: false, next: null };
const INVITE = 'ab'.repeat(32);

function invite(over: Record<string, unknown> = {}) {
	return {
		id: INVITE,
		vault: { id: VAULT_ID, slug: 'diario', name: 'Diário' },
		inviter: { id: USER_ID, username: 'ana' },
		role: { id: '22222222-3333-4444-8555-666666666666', name: 'Editor' },
		email_hint: null,
		max_uses: 3,
		use_count: 1,
		state: 'active',
		expires_at: '2099-01-01T00:00:00Z',
		created_at: '2026-11-01T10:00:00Z',
		revoked_at: null,
		...over
	};
}

function entry(id: number, over: Record<string, unknown> = {}) {
	return { id, created_at: '2026-11-01T10:00:00Z', action: 'auth.login', user_id: null, vault_id: null, ip: null, user_agent: null, payload: null, ...over };
}

afterEach(() => vi.unstubAllGlobals());

describe('overview', () => {
	it('keeps the page up when a side panel fails', async () => {
		fakeApi({
			'GET /status': () => json(status()),
			'GET /audit': () => json({ error: 'internal' }, 500),
			'GET /users': () => json(empty),
			'GET /vaults': () =>
				json({ items: [vault({ id: VAULT_ID, crdt_bytes: 10 }), vault({ id: USER_ID, slug: 'big', crdt_bytes: 99 })], more: false, next: null })
		});
		const r = await run(overviewLoad, actionEvent({ path: '/' }));
		const data = r.value as { status: { dbLatencyMs: number }; recent: unknown; top: { slug: string }[] };
		expect(data.status.dbLatencyMs).toBe(1.25);
		expect(data.recent).toBeNull();
		expect(data.top.map((v) => v.slug)).toEqual(['big', 'diario']);
	});
});

describe('users', () => {
	it('passes the search and the state filter to the API, and drops unknown states', async () => {
		const api = fakeApi({ 'GET /users': () => json(empty) });
		await run(usersLoad, actionEvent({ path: '/usuarios?busca=%20an%20&estado=locked' }));
		await run(usersLoad, actionEvent({ path: '/usuarios?estado=root' }));
		expect(api.calls[0].url.searchParams.get('q')).toBe('an');
		expect(api.calls[0].url.searchParams.get('state')).toBe('locked');
		expect(api.calls[1].url.searchParams.has('state')).toBe(false);
	});

	it('creates a user with a generated password and returns it once', async () => {
		const api = fakeApi({ 'POST /users': () => json(user(), 201) });
		const r = await run(usersActions.create, actionEvent({ path: '/usuarios', form: { username: 'Ana', mode: 'gerar' } }));
		const data = r.value as { ok: boolean; generated: string; created: { id: string } };
		expect(data.ok).toBe(true);
		expect(data.created.id).toBe(USER_ID);
		expect((api.calls[0].body as { password: string }).password).toBe(data.generated);
		expect((api.calls[0].body as { username: string }).username).toBe('ana');
	});

	it('resets a password to a generated one, or to a typed pair that matches', async () => {
		const api = fakeApi({ [`POST /users/${USER_ID}/password`]: () => noContent() });
		const gen = await run(userActions.password, actionEvent({ path: `/usuarios/${USER_ID}`, params: { id: USER_ID }, form: { mode: 'gerar' } }));
		expect((gen.value as { generated: string }).generated).toBe((api.calls[0].body as { password: string }).password);
		const typed = await run(userActions.password, actionEvent({ path: `/usuarios/${USER_ID}`, params: { id: USER_ID }, form: { mode: 'definir', password: 'senha-longa-1', password_repeat: 'senha-longa-1' } }));
		expect(typed.value).toMatchObject({ ok: true, generated: null });
		const mismatch = await run(userActions.password, actionEvent({ path: `/usuarios/${USER_ID}`, params: { id: USER_ID }, form: { mode: 'definir', password: 'senha-longa-1', password_repeat: 'x' } }));
		expect(mismatch.value).toMatchObject({ status: 400 });
		expect(api.calls).toHaveLength(2);
	});

	it('ends every session of a user and says how many', async () => {
		const api = fakeApi({ [`DELETE /users/${USER_ID}/sessions`]: () => json({ revoked: 3 }) });
		const r = await run(userActions.logoutAll, actionEvent({ path: `/usuarios/${USER_ID}`, params: { id: USER_ID } }));
		expect(r.value).toEqual({ ok: true, message: '3 sessões encerradas.' });
		expect(api.calls[0].method).toBe('DELETE');
	});
});

describe('vaults and invites', () => {
	it('loads members, invites and activity for a vault', async () => {
		fakeApi({
			[`GET /vaults/${VAULT_ID}`]: () => json(vault()),
			'GET /federations': () => json(empty),
			[`GET /vaults/${VAULT_ID}/members`]: () =>
				json({
					members: [{ user: { id: USER_ID, username: 'ana' }, display_name: 'Ana', role: { id: VAULT_ID, name: 'Admin' }, owner: true, joined_at: 'x' }],
					roles: [{ id: VAULT_ID, name: 'Admin', seed: true, members: 1 }]
				}),
			'GET /invites': () => json({ items: [invite()], more: false, next: null }),
			'GET /audit': () => json({ entries: [entry(1)], more: false, next: null })
		});
		const r = await run(vaultLoad, actionEvent({ path: `/cofres/${VAULT_ID}`, params: { id: VAULT_ID } }));
		const data = r.value as { members: unknown[]; invites: { id: string }[]; activity: unknown[] };
		expect(data.members).toHaveLength(1);
		expect(data.invites[0].id).toBe(INVITE);
		expect(data.activity).toHaveLength(1);
	});

	it('revokes an invite by its hash id, and refuses anything else without calling the API', async () => {
		const api = fakeApi({ [`DELETE /invites/${INVITE}`]: () => noContent() });
		const bad = await run(inviteActions.revoke, actionEvent({ path: '/convites', form: { invite: '../tokens' } }));
		expect(bad.value).toMatchObject({ status: 400 });
		expect(api.calls).toHaveLength(0);
		const ok = await run(vaultActions.revokeInvite, actionEvent({ path: `/cofres/${VAULT_ID}`, params: { id: VAULT_ID }, form: { invite: INVITE } }));
		expect(ok.value).toMatchObject({ ok: true });
		expect(api.calls[0].url.pathname).toBe(`/admin/v1/invites/${INVITE}`);
	});

	it('rejects an invite payload that carries no valid hash id', async () => {
		fakeApi({
			[`GET /vaults/${VAULT_ID}`]: () => json(vault()),
			'GET /federations': () => json(empty),
			[`GET /vaults/${VAULT_ID}/members`]: () => json({ members: [], roles: [] }),
			'GET /invites': () => json({ items: [invite({ id: 'raw-secret-token' })], more: false, next: null }),
			'GET /audit': () => json({ entries: [], more: false, next: null })
		});
		const r = await run(vaultLoad, actionEvent({ path: `/cofres/${VAULT_ID}`, params: { id: VAULT_ID } }));
		expect((r.value as { invites: unknown }).invites).toBeNull();
	});
});

describe('audit', () => {
	it('resolves a username to its id before asking for the log, and sends the date range', async () => {
		const api = fakeApi({
			'GET /users': () => json({ items: [user({ username: 'anabela', id: VAULT_ID }), user()], more: false, next: null }),
			'GET /audit': () => json({ entries: [entry(2)], more: false, next: null })
		});
		const r = await run(auditLoad, actionEvent({ path: '/auditoria?usuario=ana&de=2026-11-01&acao=auth.*' }));
		expect((r.value as { userLabel: string }).userLabel).toBe('ana');
		const q = api.calls[1].url.searchParams;
		expect(q.get('user')).toBe(USER_ID);
		expect(q.get('since')).toBe('2026-11-01T00:00:00-03:00');
		expect(q.get('action')).toBe('auth.*');
	});

	it('shows an empty log for a username that does not exist, without querying the log', async () => {
		const api = fakeApi({ 'GET /users': () => json(empty) });
		const r = await run(auditLoad, actionEvent({ path: '/auditoria?usuario=ninguem' }));
		expect(r.value).toMatchObject({ entries: [], unknown: ['usuario'] });
		expect(api.calls.map((c) => c.url.pathname)).toEqual(['/admin/v1/users']);
	});

	it('exports every page as CSV, guarded against formulas', async () => {
		const api = fakeApi({
			'GET /audit': (c) =>
				c.url.searchParams.get('before') === '5'
					? json({ entries: [entry(4, { user_agent: '=evil()' })], more: false, next: null })
					: json({ entries: [entry(6), entry(5)], more: true, next: '5' })
		});
		const ev = { ...actionEvent({ path: '/auditoria/exportar?escopo=admin' }) };
		const res = (await (exportAudit as unknown as Any)(ev as never)) as Response;
		expect(res.headers.get('Content-Type')).toBe('text/csv; charset=utf-8');
		expect(res.headers.get('Cache-Control')).toBe('no-store');
		const text = await res.text();
		const lines = text.trim().split('\r\n');
		expect(lines).toHaveLength(4);
		expect(text).toContain(`"'=evil()"`);
		expect(api.calls.every((c) => c.url.searchParams.get('scope') === 'admin')).toBe(true);
	});

	it('refuses an export without a panel session', async () => {
		const api = fakeApi({});
		const r = await run(exportAudit, actionEvent({ path: '/auditoria/exportar', session: null }));
		expect(r.error?.status).toBe(401);
		expect(api.calls).toHaveLength(0);
	});
});
