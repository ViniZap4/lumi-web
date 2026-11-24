import { error, fail, redirect } from '@sveltejs/kit';
import { type AdminVault, isSessionId, isUUID } from '#lib/admin.ts';
import { act, field, invalid, read, readOptional, signOut } from '#lib/server/api.ts';
import { generatePassword } from '#lib/server/password.ts';
import { confirmed, passwordProblem } from '#lib/rules.ts';
import type { Actions, PageServerLoad } from './$types';

type VaultRef = Pick<AdminVault, 'id' | 'slug' | 'name'>;

function userId(raw: string): string {
	const id = raw.toLowerCase();
	if (!isUUID(id)) error(404, 'Usuário não encontrado: talvez já tenha sido apagado.');
	return id;
}

export const load: PageServerLoad = async (event) => {
	const id = userId(event.params.id);
	const [[user, sessions, vaults], activity] = await Promise.all([
		read(event, (api) =>
			Promise.all([api.user(id), api.sessions({ user: id, limit: 200 }), api.vaults({ user: id, limit: 200 })])
		),
		readOptional(event, (api) => api.audit({ user: id, limit: 12 }))
	]);
	return {
		user,
		sessions: sessions.items,
		sessionsMore: sessions.more,
		vaults: vaults.items,
		vaultsMore: vaults.more,
		activity: activity?.entries ?? null
	};
};

export const actions: Actions = {
	/** With "gerar", the panel picks a temporary password and returns it once, in this answer only (no-store). */
	password: async (event) => {
		const id = userId(event.params.id);
		const data = await event.request.formData();
		const generate = field(data, 'mode') === 'gerar';
		const password = generate ? generatePassword() : field(data, 'password');
		const problem = passwordProblem(password);
		if (problem) return invalid(problem);
		if (!generate && password !== field(data, 'password_repeat')) return invalid('As senhas não conferem.');
		const result = await act(event, 'Senha redefinida. Bloqueio zerado e sessões do usuário encerradas.', (api) =>
			api.setPassword(id, password)
		);
		return 'ok' in result && result.ok ? { ...result, generated: generate ? password : null } : result;
	},
	/** Force logout: every session of the user, on every device. */
	logoutAll: async (event) => {
		const id = userId(event.params.id);
		let n = 0;
		const result = await act(event, '', async (api) => {
			n = await api.revokeUserSessions(id);
		});
		if ('ok' in result && result.ok) {
			return { ok: true, message: n === 1 ? '1 sessão encerrada.' : `${n} sessões encerradas.` };
		}
		return result;
	},
	disable: (event) =>
		act(event, 'Usuário desativado. As sessões dele foram encerradas.', (api) =>
			api.disableUser(userId(event.params.id))
		),
	enable: (event) => act(event, 'Usuário reativado.', (api) => api.enableUser(userId(event.params.id))),
	/**
	 * The server_admin flag (SPEC-PARTE2 §10): lets the account sign in to this panel with its password. The API
	 * refuses to clear the last active server admin (409), whoever asks.
	 */
	serverAdmin: async (event) => {
		const id = userId(event.params.id);
		const raw = field(await event.request.formData(), 'enabled');
		if (raw !== 'true' && raw !== 'false') return invalid('Valor inválido.');
		const enabled = raw === 'true';
		const result = await act(
			event,
			enabled
				? 'Agora a conta é administradora do servidor e pode entrar no painel com a senha.'
				: 'A conta deixou de ser administradora do servidor; as sessões dela no painel foram encerradas.',
			(api) => api.setServerAdmin(id, enabled)
		);
		// Losing the flag ends this panel's own session too when it was that account's (the API revoked it).
		const self = event.locals.session;
		if (!enabled && 'ok' in result && result.ok && self?.meta.kind === 'session' && self.meta.userId === id) {
			signOut(event, self);
		}
		return result;
	},
	unlock: (event) =>
		act(event, 'Usuário desbloqueado: falhas de login zeradas.', (api) => api.unlockUser(userId(event.params.id))),
	revokeSession: async (event) => {
		const session = field(await event.request.formData(), 'session');
		if (!isSessionId(session)) return invalid('Sessão inválida.');
		return act(event, 'Sessão encerrada.', (api) => api.revokeSession(session));
	},
	/**
	 * LGPD erasure (ADMIN.md). The typed username is checked here too, not only in the dialog. An owner of vaults is
	 * refused by the API with 409 sole_admin_vaults unless the second, explicit acknowledgement came along.
	 */
	delete: async (event) => {
		const id = userId(event.params.id);
		const data = await event.request.formData();
		const user = await read(event, (api) => api.user(id));
		if (!confirmed(field(data, 'confirm'), user.username)) {
			return invalid('Digite o nome de usuário exatamente para confirmar.');
		}
		const withVaults = field(data, 'delete_owned_vaults') === 'true';
		const result = await act(
			event,
			`Usuário “${user.username}” apagado.`,
			(api) => api.deleteUser(id, withVaults),
			{},
			async (err) => {
				if (err.kind !== 'soleAdminVaults') return undefined;
				const ids = (err.details.vaultIds ?? []).slice(0, 50);
				const vaults: VaultRef[] = await read(event, (api) =>
					Promise.all(
						ids.map((v) =>
							api.vault(v).then(
								(x) => ({ id: x.id, slug: x.slug, name: x.name }),
								() => ({ id: v, slug: v, name: '' })
							)
						)
					)
				);
				return fail(409, {
					ok: false,
					message: `“${user.username}” é dono de ${vaults.length} ${vaults.length === 1 ? 'cofre' : 'cofres'}. Para apagar, confirme que os cofres também serão apagados.`,
					soleAdminVaults: vaults
				});
			}
		);
		if ('ok' in result && result.ok) redirect(303, `/usuarios?apagado=${encodeURIComponent(user.username)}`);
		return result;
	}
};
