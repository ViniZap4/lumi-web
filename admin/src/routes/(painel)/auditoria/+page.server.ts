import { filterQuery, filtersOf } from '#lib/audit.ts';
import { read } from '#lib/server/api.ts';
import { resolveFilters } from '#lib/server/audit.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const f = filtersOf(event.url);
	const result = await read(event, async (api) => {
		const r = await resolveFilters(api, f);
		const page =
			r.unknown.length > 0
				? { entries: [], more: false, next: null }
				: await api.audit({ ...r.query, before: f.before, limit: 50 });
		return { ...r, page };
	});
	return {
		...result.page,
		filters: { scope: f.scope, user: f.user, vault: f.vault, action: f.action, from: f.from, to: f.to },
		query: filterQuery(f),
		userId: result.query.user ?? null,
		vaultId: result.query.vault ?? null,
		userLabel: result.userLabel,
		vaultLabel: result.vaultLabel,
		unknown: result.unknown,
		invalid: f.invalid,
		paged: f.before !== undefined
	};
};
