import { read } from '#lib/server/api.ts';
import { cursorOf } from '#lib/server/guard.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const page = await read(event, (api) => api.vaults({ after: cursorOf(event.url), limit: 50 }));
	const deleted = event.url.searchParams.get('apagado');
	return { ...page, deleted: deleted && deleted.length <= 128 ? deleted : null };
};
