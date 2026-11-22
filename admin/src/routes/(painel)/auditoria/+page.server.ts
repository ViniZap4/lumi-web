import { filtersOf } from '#lib/audit.ts';
import { read } from '#lib/server/api.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const f = filtersOf(event.url);
	const page = await read(event, (api) =>
		api.audit({
			before: f.before,
			limit: 50,
			scope: f.scope,
			user: f.user || undefined,
			vault: f.vault || undefined
		})
	);
	return {
		...page,
		filters: { scope: f.scope, user: f.user, vault: f.vault },
		paged: f.before !== undefined,
		invalid: f.invalid
	};
};
