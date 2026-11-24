import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import { actions as loginActions, load as loginLoad } from '../routes/entrar/+page.server.ts';
import { actions as logoutActions } from '../routes/sair/+page.server.ts';
import { actions as userActions } from '../routes/(painel)/usuarios/[id]/+page.server.ts';
import { actions as tokenActions } from '../routes/(painel)/tokens/+page.server.ts';
import { handle } from '../hooks.server.ts';
import { decodeLogin, decodeStatus } from '#lib/admin.ts';
import { loginThrottle, sessions } from '#lib/server/sessions.ts';
import { TOKEN_ID, USER_ID, fakeApi, json, noContent, status, user } from './fake-api.ts';
import { actionEvent, outcome } from './event.ts';

type Any = (e: never) => unknown;
const run = (fn: unknown, ev: unknown) => outcome(() => (fn as Any)(ev as never));

const LPS = 'lps_' + 'B'.repeat(43);
const SESSION_ID = '22222222-3333-4444-8555-666666666666';

function loginResponse(over: Record<string, unknown> = {}) {
	return {
		token: LPS,
		id: SESSION_ID,
		name: 'session',
		kind: 'session',
		expires_at: '2099-01-01T00:00:00Z',
		user: { id: USER_ID, username: 'ana' },
		...over
	};
}

function sessionFor(userId = USER_ID) {
	return sessions.create(LPS, {
		id: SESSION_ID,
		name: 'session',
		expiresAt: Number.MAX_SAFE_INTEGER,
		kind: 'session',
		userId,
		username: 'ana'
	});
}

afterEach(() => {
	vi.unstubAllGlobals();
	for (const k of ['100.64.0.7', '100.64.0.8', '100.64.0.9', 'user:ana', 'user:bia']) loginThrottle.succeed(k);
});

describe('login page', () => {
	it('opens on the username tab, and on the token tab with ?aba=token', async () => {
		const ev = actionEvent({ path: '/entrar', session: null });
		expect((await run(loginLoad, ev)).value).toMatchObject({ tab: 'usuario' });
		const tok = actionEvent({ path: '/entrar?aba=token', session: null });
		expect((await run(loginLoad, tok)).value).toMatchObject({ tab: 'token' });
	});
});

describe('password login', () => {
	it('keeps the lps_ token server-side and gives the browser only a random HttpOnly __Host- cookie', async () => {
		const api = fakeApi({ 'POST /session': () => json(loginResponse(), 201) });
		const ev = actionEvent({ path: '/entrar', form: { username: ' Ana ', password: 'correct horse 9' }, session: null });
		const r = await run(loginActions.usuario, ev);
		expect(r.redirect).toEqual({ status: 303, location: '/' });

		const [call] = api.calls;
		expect(call.method).toBe('POST');
		expect(call.headers.get('Authorization')).toBeNull();
		expect(call.headers.get('X-Forwarded-For')).toBe('100.64.0.7');
		expect(call.body).toEqual({ username: 'ana', password: 'correct horse 9' });

		const [[name, cookie]] = [...ev.cookies.jar.entries()];
		expect(name).toBe('__Host-lumi_admin');
		expect(cookie.options).toMatchObject({ httpOnly: true, secure: true, sameSite: 'strict', path: '/' });
		expect(cookie.value).not.toContain('lps_');
		const s = sessions.get(cookie.value);
		expect(s?.token).toBe(LPS);
		expect(s?.meta).toMatchObject({ kind: 'session', userId: USER_ID, username: 'ana', id: SESSION_ID });
		sessions.delete(s?.id);
	});

	it('answers every refusal with one generic message, keeps the username and never echoes the password', async () => {
		fakeApi({ 'POST /session': () => json({ error: 'invalid_credentials' }, 401) });
		const ev = actionEvent({ path: '/entrar', form: { username: 'ana', password: 'nope' }, session: null });
		const r = await run(loginActions.usuario, ev);
		expect(r.value).toMatchObject({
			status: 401,
			data: { tab: 'usuario', username: 'ana', message: expect.stringContaining('Usuário ou senha inválidos') }
		});
		expect(JSON.stringify(r.value)).not.toContain('nope');
		expect(ev.cookies.jar.size).toBe(0);
	});

	it('never sends a malformed username to the API, with the same answer', async () => {
		const api = fakeApi({});
		for (const username of ['a', 'Ana Maria', '-ana', 'x'.repeat(40)]) {
			const r = await run(
				loginActions.usuario,
				actionEvent({ path: '/entrar', form: { username, password: 'x' }, session: null, ip: '100.64.0.8' })
			);
			expect(r.value).toMatchObject({ status: 401, data: { message: expect.stringContaining('inválidos') } });
		}
		expect(api.calls).toHaveLength(0);
	});

	it('throttles per user across addresses, before calling the API', async () => {
		fakeApi({ 'POST /session': () => json({ error: 'invalid_credentials' }, 401) });
		for (let i = 0; i < 5; i++) {
			const ip = i % 2 === 0 ? '100.64.0.8' : '100.64.0.9';
			await run(loginActions.usuario, actionEvent({ path: '/entrar', form: { username: 'bia', password: 'x' }, session: null, ip }));
		}
		const api = fakeApi({ 'POST /session': () => json(loginResponse(), 201) });
		const r = await run(
			loginActions.usuario,
			actionEvent({ path: '/entrar', form: { username: 'bia', password: 'right one 1' }, session: null, ip: '100.64.0.7' })
		);
		expect(r.value).toMatchObject({ status: 429 });
		expect(api.calls).toHaveLength(0);
	});

	it('passes the API rate limit on as 429 with its wait', async () => {
		fakeApi({ 'POST /session': () => json({ error: 'rate_limited', retry_after_s: 42 }, 429, { 'Retry-After': '42' }) });
		const r = await run(loginActions.usuario, actionEvent({ path: '/entrar', form: { username: 'ana', password: 'x' }, session: null }));
		expect(r.value).toMatchObject({ status: 429, data: { message: 'Muitas tentativas. Tente de novo em 42 s.' } });
	});

	it('refuses a login answer that is not an lps_ session', () => {
		expect(() => decodeLogin(loginResponse({ token: 'lpa_' + 'A'.repeat(43) }))).toThrow();
		expect(() => decodeLogin(loginResponse({ kind: 'token' }))).toThrow();
		expect(() => decodeLogin(loginResponse({ user: null }))).toThrow();
		expect(decodeLogin(loginResponse()).ref).toMatchObject({ kind: 'session', user: { username: 'ana' } });
	});
});

describe('Sair', () => {
	it('revokes an lps_ session on the server, then ends the panel session', async () => {
		const api = fakeApi({ 'DELETE /session': () => noContent() });
		const s = sessionFor();
		const ev = actionEvent({ path: '/sair', session: s });
		const r = await run(logoutActions.default, ev);
		expect(r.redirect?.location).toBe('/entrar?motivo=saiu');
		expect(api.calls[0].method).toBe('DELETE');
		expect(api.calls[0].headers.get('Authorization')).toBe(`Bearer ${LPS}`);
		expect(sessions.get(s.id)).toBeNull();
		expect(ev.cookies.deleted).toContain('__Host-lumi_admin');
	});

	it('still signs out when the API is down, and never revokes an lpa_ token', async () => {
		fakeApi({ 'DELETE /session': () => json({ error: 'internal' }, 500) });
		const s = sessionFor();
		const r = await run(logoutActions.default, actionEvent({ path: '/sair', session: s }));
		expect(r.redirect?.location).toBe('/entrar?motivo=saiu');
		expect(sessions.get(s.id)).toBeNull();

		const api = fakeApi({});
		const ev = actionEvent({ path: '/sair' }); // an lpa_ token session
		await run(logoutActions.default, ev);
		expect(api.calls).toHaveLength(0);
	});
});

describe('server admin flag', () => {
	const path = `/usuarios/${USER_ID}`;
	const route = `POST /users/${USER_ID}/server-admin`;

	it('sends {enabled} and reports the last-admin refusal in Portuguese', async () => {
		const api = fakeApi({
			[route]: (c) =>
				(c.body as { enabled: boolean }).enabled
					? noContent()
					: json({ error: 'conflict', detail: 'last_server_admin' }, 409)
		});
		const ok = await run(userActions.serverAdmin, actionEvent({ path, params: { id: USER_ID }, form: { enabled: 'true' } }));
		expect(ok.value).toMatchObject({ ok: true });
		expect(api.calls[0].body).toEqual({ enabled: true });
		const last = await run(userActions.serverAdmin, actionEvent({ path, params: { id: USER_ID }, form: { enabled: 'false' } }));
		expect(last.value).toMatchObject({ status: 409, data: { message: expect.stringContaining('último administrador') } });
		const bad = await run(userActions.serverAdmin, actionEvent({ path, params: { id: USER_ID }, form: { enabled: 'yes' } }));
		expect(bad.value).toMatchObject({ status: 400 });
	});

	it('signs out when you drop your own flag', async () => {
		fakeApi({ [route]: () => noContent() });
		const s = sessionFor(USER_ID);
		const ev = actionEvent({ path, params: { id: USER_ID }, form: { enabled: 'false' }, session: s });
		const r = await run(userActions.serverAdmin, ev);
		expect(r.redirect?.location).toBe('/entrar?motivo=token');
		expect(sessions.get(s.id)).toBeNull();
	});

	it('decodes server_admin, and treats an older server (no field) as false', async () => {
		const { decodeUser } = await import('#lib/admin.ts');
		expect(decodeUser(user({ server_admin: true })).serverAdmin).toBe(true);
		expect(decodeUser(user()).serverAdmin).toBe(false);
	});
});

describe('sessions in the tokens page', () => {
	it('confirms a session revoke with the username, and decodes kind + user', async () => {
		const items = [
			{ id: TOKEN_ID, name: 'painel', state: 'active', created_at: 'x', last_used_at: null, expires_at: 'y', revoked_at: null, current: true, kind: 'token', user: null },
			{ id: SESSION_ID, name: 'session', state: 'active', created_at: 'x', last_used_at: null, expires_at: 'y', revoked_at: null, current: false, kind: 'session', user: { id: USER_ID, username: 'ana' } }
		];
		const api = fakeApi({
			'GET /tokens': () => json({ items, more: false, next: null }),
			[`DELETE /tokens/${SESSION_ID}`]: () => noContent()
		});
		const bad = await run(tokenActions.revoke, actionEvent({ path: '/tokens', form: { token: SESSION_ID, confirm: 'session' } }));
		expect(bad.value).toMatchObject({ status: 400 });
		const ok = await run(tokenActions.revoke, actionEvent({ path: '/tokens', form: { token: SESSION_ID, confirm: 'ana' } }));
		expect(ok.value).toMatchObject({ ok: true, message: 'Sessão de “ana” encerrada.' });
		expect(api.calls.filter((c) => c.method === 'DELETE')).toHaveLength(1);
	});

	it('reads the credential in /status', () => {
		const s = decodeStatus(status({ token: { id: SESSION_ID, name: 'session', expires_at: 'z', kind: 'session', user: { id: USER_ID, username: 'ana' } } }));
		expect(s.token).toMatchObject({ kind: 'session', user: { username: 'ana' } });
		expect(decodeStatus(status()).token).toMatchObject({ kind: 'token', user: null });
	});
});

describe('Origin check', () => {
	function post(origin: string | null, path = '/entrar?/usuario') {
		const headers: Record<string, string> = {};
		if (origin) headers.origin = origin;
		return {
			url: new URL(`https://lumi-admin.tail1234.ts.net${path}`),
			request: new Request(`https://lumi-admin.tail1234.ts.net${path}`, { method: 'POST', headers }),
			cookies: { get: () => undefined },
			locals: {}
		} as unknown as RequestEvent;
	}

	it('refuses a state-changing request from another origin or without one, with no-store', async () => {
		let resolved = 0;
		const resolve = async () => {
			resolved++;
			return new Response('ok');
		};
		for (const origin of [null, 'https://evil.example', 'null', 'http://lumi-admin.tail1234.ts.net']) {
			const res = await handle({ event: post(origin), resolve });
			expect(res.status, String(origin)).toBe(403);
			expect(res.headers.get('Cache-Control')).toBe('no-store');
		}
		expect(resolved).toBe(0);
		const same = await handle({ event: post('https://lumi-admin.tail1234.ts.net'), resolve });
		expect(same.status).toBe(200);
		expect(resolved).toBe(1);
	});
});
