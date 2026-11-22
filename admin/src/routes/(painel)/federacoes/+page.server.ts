import { isUUID } from '#lib/admin.ts';
import { act, field, invalid, read } from '#lib/server/api.ts';
import { cursorOf } from '#lib/server/guard.ts';
import { confirmed } from '#lib/rules.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const raw = event.url.searchParams.get('cofre')?.toLowerCase() ?? '';
	const vault = isUUID(raw) ? raw : undefined;
	const page = await read(event, (api) => api.federations({ vault, after: cursorOf(event.url), limit: 50 }));
	return { ...page, vault: vault ?? null };
};

export const actions: Actions = {
	/** The local vault stays; the link row is kept with status "revoked". The vault slug is the typed confirmation. */
	revoke: async (event) => {
		const data = await event.request.formData();
		const id = field(data, 'federation').toLowerCase();
		if (!isUUID(id)) return invalid('Vínculo inválido.');
		const fed = await read(event, async (api) => {
			// No GET /federations/{id}: find it among the vault's links.
			const vault = field(data, 'vault').toLowerCase();
			if (!isUUID(vault)) return undefined;
			const page = await api.federations({ vault, limit: 200 });
			return page.items.find((f) => f.id === id);
		});
		if (!fed) return invalid('Vínculo não encontrado: talvez já tenha sido revogado.');
		if (!confirmed(field(data, 'confirm'), fed.vault.slug)) {
			return invalid('Digite o identificador do cofre exatamente para confirmar.');
		}
		return act(event, `Federação do cofre “${fed.vault.slug}” com ${fed.peerUrl} revogada.`, (api) =>
			api.revokeFederation(id)
		);
	}
};
