import { isInviteId, isUUID } from '#lib/admin.ts';
import { act, field, invalid, read } from '#lib/server/api.ts';
import { cursorOf } from '#lib/server/guard.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const raw = event.url.searchParams.get('cofre')?.toLowerCase() ?? '';
	const vault = isUUID(raw) ? raw : undefined;
	const state = event.url.searchParams.get('estado') === 'todos' ? 'all' : 'active';
	const page = await read(event, (api) => api.invites({ vault, state, after: cursorOf(event.url), limit: 50 }));
	return { ...page, vault: vault ?? null, state };
};

export const actions: Actions = {
	revoke: async (event) => {
		const id = field(await event.request.formData(), 'invite');
		if (!isInviteId(id)) return invalid('Convite inválido.');
		return act(event, 'Convite revogado: o link deixa de valer.', (api) => api.revokeInvite(id));
	}
};
