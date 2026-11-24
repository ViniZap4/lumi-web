import { afterEach, describe, expect, it, vi } from 'vitest';
import { actions as loginActions } from '../routes/entrar/+page.server.ts';
import { actions as userActions, load as userLoad } from '../routes/(painel)/usuarios/[id]/+page.server.ts';
import { actions as vaultActions } from '../routes/(painel)/cofres/[id]/+page.server.ts';
import { actions as tokenActions } from '../routes/(painel)/tokens/+page.server.ts';
import { actions as fedActions } from '../routes/(painel)/federacoes/+page.server.ts';
import { load as statusLoad } from '../routes/(painel)/+page.server.ts';
import { loginThrottle, sessions } from '#lib/server/sessions.ts';
import { TOKEN, TOKEN_ID, USER_ID, VAULT_ID, fakeApi, json, noContent, status, user, vault } from './fake-api.ts';
import { actionEvent, outcome } from './event.ts';

// The Kit types for these handlers want the full RequestEvent; the fake carries what they use.
type Any = (e: never) => unknown;
const run = (fn: unknown, ev: unknown) => outcome(() => (fn as Any)(ev as never));

afterEach(() => {
	vi.unstubAllGlobals();
	loginThrottle.succeed('100.64.0.7');
});

describe('login', () => {
	it('never sends a malformed token to the API', async () => {
		const api = fakeApi({});
		const ev = actionEvent({ path: '/entrar', form: { token: 'lpa_short' }, session: null });
		const r = await run(loginActions.token, ev);
		expect(r.value).toMatchObject({ status: 400 });
		expect(api.calls).toHaveLength(0);
	});

	it('refuses a token the API rejects, without a session or cookie', async () => {
		fakeApi({ 'GET /status': () => json({ error: 'unauthorized' }, 401) });
		const ev = actionEvent({ path: '/entrar', form: { token: TOKEN }, session: null });
		const r = await run(loginActions.token, ev);
		expect(r.value).toMatchObject({ status: 401, data: { message: 'Token inválido, expirado ou revogado.' } });
		expect(ev.cookies.jar.size).toBe(0);
	});

	it('starts a server-side session with an HttpOnly cookie that holds only a random id', async () => {
		const api = fakeApi({ 'GET /status': () => json(status()) });
		const ev = actionEvent({ path: '/entrar', form: { token: ` ${TOKEN} ` }, session: null });
		const r = await run(loginActions.token, ev);
		expect(r.redirect).toEqual({ status: 303, location: '/' });
		expect(api.calls[0].headers.get('X-Forwarded-For')).toBe('100.64.0.7');
		const [[name, cookie]] = [...ev.cookies.jar.entries()];
		expect(name).toBe('__Host-lumi_admin');
		expect(cookie.options).toMatchObject({ httpOnly: true, secure: true, sameSite: 'strict', path: '/' });
		expect(cookie.value).not.toContain('lpa_');
		expect(sessions.get(cookie.value)?.token).toBe(TOKEN);
	});

	it('throttles repeated failures per address', async () => {
		fakeApi({ 'GET /status': () => json({ error: 'unauthorized' }, 401) });
		for (let i = 0; i < 5; i++) {
			await run(loginActions.token, actionEvent({ path: '/entrar', form: { token: TOKEN }, session: null }));
		}
		const api = fakeApi({ 'GET /status': () => json(status()) });
		const r = await run(loginActions.token, actionEvent({ path: '/entrar', form: { token: TOKEN }, session: null }));
		expect(r.value).toMatchObject({ status: 429 });
		expect(api.calls).toHaveLength(0);
	});
});

describe('401 from the API', () => {
	it('ends the panel session on a load and sends to the login', async () => {
		fakeApi({ 'GET /status': () => json({ error: 'unauthorized' }, 401) });
		const ev = actionEvent({ path: '/' });
		const id = ev.locals.session!.id;
		const r = await run(statusLoad, ev);
		expect(r.redirect).toEqual({ status: 303, location: '/entrar?motivo=token' });
		expect(sessions.get(id)).toBeNull();
		expect(ev.cookies.deleted).toContain('__Host-lumi_admin');
	});

	it('ends the panel session on an action too', async () => {
		fakeApi({ [`POST /users/${USER_ID}/disable`]: () => json({ error: 'unauthorized' }, 401) });
		const ev = actionEvent({ path: `/usuarios/${USER_ID}`, params: { id: USER_ID } });
		const id = ev.locals.session!.id;
		const r = await run(userActions.disable, ev);
		expect(r.redirect?.location).toBe('/entrar?motivo=token');
		expect(sessions.get(id)).toBeNull();
	});

	it('without a panel session, sends to the login and never calls the API', async () => {
		const api = fakeApi({});
		const r = await run(userLoad, actionEvent({ path: `/usuarios/${USER_ID}`, params: { id: USER_ID }, session: null }));
		expect(r.redirect?.location).toBe('/entrar?motivo=sessao');
		expect(api.calls).toHaveLength(0);
	});
});

describe('confirmation gates', () => {
	const del = `DELETE /users/${USER_ID}`;

	it('refuses a user delete without the exact username, server side', async () => {
		const api = fakeApi({ [`GET /users/${USER_ID}`]: () => json(user()), [del]: () => noContent() });
		for (const confirm of ['', 'Ana', 'an']) {
			const r = await run(userActions.delete, actionEvent({ path: `/usuarios/${USER_ID}`, params: { id: USER_ID }, form: { confirm } }));
			expect(r.value).toMatchObject({ status: 400 });
		}
		expect(api.calls.some((c) => c.method === 'DELETE')).toBe(false);
	});

	it('shows the vaults on 409 sole_admin_vaults and deletes them only with the acknowledgement', async () => {
		const api = fakeApi({
			[`GET /users/${USER_ID}`]: () => json(user({ owned_vaults: 1, owned_vault_ids: [VAULT_ID] })),
			[`GET /vaults/${VAULT_ID}`]: () => json(vault()),
			[del]: (c) =>
				c.url.searchParams.get('delete_owned_vaults') === 'true'
					? noContent()
					: json({ error: 'sole_admin_vaults', vault_ids: [VAULT_ID] }, 409)
		});
		const path = `/usuarios/${USER_ID}`;
		const first = await run(userActions.delete, actionEvent({ path, params: { id: USER_ID }, form: { confirm: 'ana' } }));
		expect(first.value).toMatchObject({
			status: 409,
			data: { soleAdminVaults: [{ id: VAULT_ID, slug: 'diario', name: 'Diário' }] }
		});
		const second = await run(userActions.delete, actionEvent({ path, params: { id: USER_ID }, form: { confirm: 'ana', delete_owned_vaults: 'true' } }));
		expect(second.redirect).toEqual({ status: 303, location: '/usuarios?apagado=ana' });
		expect(api.calls.filter((c) => c.method === 'DELETE').map((c) => c.url.search)).toEqual(['', '?delete_owned_vaults=true']);
	});

	it('refuses a vault delete without the exact slug', async () => {
		const api = fakeApi({ [`GET /vaults/${VAULT_ID}`]: () => json(vault()), [`DELETE /vaults/${VAULT_ID}`]: () => noContent() });
		const path = `/cofres/${VAULT_ID}`;
		const bad = await run(vaultActions.delete, actionEvent({ path, params: { id: VAULT_ID }, form: { confirm: 'Diário' } }));
		expect(bad.value).toMatchObject({ status: 400 });
		expect(api.calls.some((c) => c.method === 'DELETE')).toBe(false);
		const ok = await run(vaultActions.delete, actionEvent({ path, params: { id: VAULT_ID }, form: { confirm: 'diario' } }));
		expect(ok.redirect?.location).toBe('/cofres?apagado=diario');
	});

	it('revokes a token only with its name, and signs out when it is the one in use', async () => {
		const tok = { id: TOKEN_ID, name: 'painel', state: 'active', created_at: 'x', last_used_at: null, expires_at: 'y', revoked_at: null, current: true };
		const api = fakeApi({
			'GET /tokens': () => json({ items: [tok], more: false, next: null }),
			[`DELETE /tokens/${TOKEN_ID}`]: () => noContent()
		});
		const bad = await run(tokenActions.revoke, actionEvent({ path: '/tokens', form: { token: TOKEN_ID, confirm: 'x' } }));
		expect(bad.value).toMatchObject({ status: 400 });
		expect(api.calls.some((c) => c.method === 'DELETE')).toBe(false);
		const ev = actionEvent({ path: '/tokens', form: { token: TOKEN_ID, confirm: 'painel' } });
		const id = ev.locals.session!.id;
		const ok = await run(tokenActions.revoke, ev);
		expect(ok.redirect?.location).toBe('/entrar?motivo=token');
		expect(sessions.get(id)).toBeNull();
	});

	it('revokes a federation only with the vault slug and reports a 409 in Portuguese', async () => {
		const fid = '99999999-8888-4777-8666-555555555555';
		const fed = { id: fid, vault: { id: VAULT_ID, slug: 'diario', name: 'Diário' }, role: 'home', peer_url: 'https://outro', jurisdiction: null, status: 'active', last_acked_seq: 4, control_seq: 2, created_at: 'x', revoked_at: null };
		fakeApi({
			'GET /federations': () => json({ items: [fed], more: false, next: null }),
			[`DELETE /federations/${fid}`]: () => json({ error: 'conflict', detail: 'federation link is not active' }, 409)
		});
		const bad = await run(fedActions.revoke, actionEvent({ path: '/federacoes', form: { federation: fid, vault: VAULT_ID, confirm: '' } }));
		expect(bad.value).toMatchObject({ status: 400 });
		const r = await run(fedActions.revoke, actionEvent({ path: '/federacoes', form: { federation: fid, vault: VAULT_ID, confirm: 'diario' } }));
		expect(r.value).toMatchObject({ status: 409, data: { message: 'Esse vínculo de federação já não estava ativo.' } });
	});
});
