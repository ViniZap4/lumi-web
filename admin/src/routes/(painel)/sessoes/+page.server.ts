import { isSessionId, isUUID } from '#lib/admin.ts';
import { act, field, invalid, read } from '#lib/server/api.ts';
import { cursorOf } from '#lib/server/guard.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const raw = event.url.searchParams.get('usuario')?.toLowerCase() ?? '';
	const user = isUUID(raw) ? raw : undefined;
	const page = await read(event, (api) => api.sessions({ user, after: cursorOf(event.url), limit: 50 }));
	return { ...page, user: user ?? null };
};

export const actions: Actions = {
	revoke: async (event) => {
		const id = field(await event.request.formData(), 'session');
		if (!isSessionId(id)) return invalid('Sessão inválida.');
		return act(event, 'Sessão encerrada.', (api) => api.revokeSession(id));
	}
};
