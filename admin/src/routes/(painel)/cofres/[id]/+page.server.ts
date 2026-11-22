import { error, redirect } from '@sveltejs/kit';
import { isUUID } from '#lib/admin.ts';
import { act, field, invalid, read } from '#lib/server/api.ts';
import { confirmed } from '#lib/rules.ts';
import type { Actions, PageServerLoad } from './$types';

function vaultId(raw: string): string {
	const id = raw.toLowerCase();
	if (!isUUID(id)) error(404, 'Cofre não encontrado: talvez já tenha sido apagado.');
	return id;
}

export const load: PageServerLoad = async (event) => {
	const id = vaultId(event.params.id);
	const [vault, federations] = await read(event, (api) =>
		Promise.all([api.vault(id), api.federations({ vault: id, limit: 200 })])
	);
	return { vault, federations: federations.items };
};

export const actions: Actions = {
	/** Deletes notes, roles, members, invites, federation links and the directory. The slug is checked here too. */
	delete: async (event) => {
		const id = vaultId(event.params.id);
		const vault = await read(event, (api) => api.vault(id));
		if (!confirmed(field(await event.request.formData(), 'confirm'), vault.slug)) {
			return invalid('Digite o identificador (slug) do cofre exatamente para confirmar.');
		}
		const result = await act(event, `Cofre “${vault.slug}” apagado.`, (api) => api.deleteVault(id));
		if ('ok' in result && result.ok) redirect(303, `/cofres?apagado=${encodeURIComponent(vault.slug)}`);
		return result;
	}
};
