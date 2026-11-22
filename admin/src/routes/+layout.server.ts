import { isLocalHost } from '#lib/server/sessions.ts';
import type { LayoutServerLoad } from './$types';

// Only the token's name and expiry reach the page: never the token itself.
export const load: LayoutServerLoad = ({ locals, url }) => ({
	token: locals.session ? { name: locals.session.meta.name, expiresAt: locals.session.meta.expiresAt } : null,
	insecure: url.protocol === 'http:' && !isLocalHost(url.hostname)
});
