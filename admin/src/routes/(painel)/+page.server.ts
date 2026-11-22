import { read } from '#lib/server/api.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => ({ status: await read(event, (api) => api.status()) });
