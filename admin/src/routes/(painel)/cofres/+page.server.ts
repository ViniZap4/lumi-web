import { read } from '#lib/server/api.ts';
import { cursorOf, searchOf } from '#lib/server/guard.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const q = searchOf(event.url);
	const page = await read(event, (api) => api.vaults({ q, after: cursorOf(event.url), limit: 50 }));
	const deleted = event.url.searchParams.get('apagado');
	return {
		...page,
		q: q ?? '',
		deleted: deleted && deleted.length <= 128 ? deleted : null
	};
};
