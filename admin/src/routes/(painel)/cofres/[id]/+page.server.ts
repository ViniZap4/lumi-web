import { error, redirect } from '@sveltejs/kit';
import { isInviteId, isUUID } from '#lib/admin.ts';
import { act, field, invalid, read, readOptional } from '#lib/server/api.ts';
import { confirmed } from '#lib/rules.ts';
import type { Actions, PageServerLoad } from './$types';

function vaultId(raw: string): string {
	const id = raw.toLowerCase();
	if (!isUUID(id)) error(404, 'Cofre não encontrado: talvez já tenha sido apagado.');
	return id;
}

export const load: PageServerLoad = async (event) => {
	const id = vaultId(event.params.id);
	const [[vault, federations, members], invites, activity] = await Promise.all([
		read(event, (api) =>
			Promise.all([api.vault(id), api.federations({ vault: id, limit: 200 }), api.vaultMembers(id)])
		),
		readOptional(event, (api) => api.invites({ vault: id, state: 'all', limit: 50 })),
		readOptional(event, (api) => api.audit({ vault: id, limit: 12 }))
	]);
	return {
		vault,
		federations: federations.items,
		members: members.members,
		roles: members.roles,
		invites: invites?.items ?? null,
		activity: activity?.entries ?? null
	};
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
	},
	revokeInvite: async (event) => {
		vaultId(event.params.id);
		const invite = field(await event.request.formData(), 'invite');
		if (!isInviteId(invite)) return invalid('Convite inválido.');
		return act(event, 'Convite revogado: o link deixa de valer.', (api) => api.revokeInvite(invite));
	},
	/** The local vault stays; the link row is kept as revoked. The slug is the typed confirmation, checked here too. */
	revokeFederation: async (event) => {
		const id = vaultId(event.params.id);
		const data = await event.request.formData();
		const fid = field(data, 'federation').toLowerCase();
		if (!isUUID(fid)) return invalid('Vínculo inválido.');
		const [vault, page] = await read(event, (api) => Promise.all([api.vault(id), api.federations({ vault: id, limit: 200 })]));
		const fed = page.items.find((f) => f.id === fid);
		if (!fed) return invalid('Vínculo não encontrado neste cofre.');
		if (!confirmed(field(data, 'confirm'), vault.slug)) {
			return invalid('Digite o identificador do cofre exatamente para confirmar.');
		}
		return act(event, `Federação com ${fed.peerUrl} revogada.`, (api) => api.revokeFederation(fid));
	}
};
