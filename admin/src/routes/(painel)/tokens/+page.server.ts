import { redirect } from '@sveltejs/kit';
import { isUUID } from '#lib/admin.ts';
import { act, field, invalid, read } from '#lib/server/api.ts';
import { cursorOf } from '#lib/server/guard.ts';
import { cookieName, cookieOptions, sessions } from '#lib/server/sessions.ts';
import { confirmed } from '#lib/rules.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) =>
	read(event, (api) => api.tokens({ after: cursorOf(event.url), limit: 50 }));

export const actions: Actions = {
	/** Revoking is idempotent; revoking the token in use ends this panel session right after. */
	revoke: async (event) => {
		const data = await event.request.formData();
		const id = field(data, 'token').toLowerCase();
		if (!isUUID(id)) return invalid('Token inválido.');
		const page = await read(event, (api) => api.tokens({ limit: 200 }));
		const token = page.items.find((t) => t.id === id);
		if (!token) return invalid('Token não encontrado na primeira página da lista.');
		if (!confirmed(field(data, 'confirm'), token.name)) {
			return invalid('Digite o nome do token exatamente para confirmar.');
		}
		const result = await act(event, `Token “${token.name}” revogado.`, (api) => api.revokeToken(id));
		if ('ok' in result && result.ok) {
			sessions.deleteToken(id);
			if (token.current) {
				event.cookies.delete(cookieName(event.url), cookieOptions(event.url));
				redirect(303, '/entrar?motivo=token');
			}
		}
		return result;
	}
};
