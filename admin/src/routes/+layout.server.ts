import { isLocalHost } from '#lib/server/sessions.ts';
import { THEME_COOKIE, themeOf } from '#lib/theme.ts';
import type { LayoutServerLoad } from './$types';

// Only the credential's name, kind, user and expiry reach the page: never the token itself.
export const load: LayoutServerLoad = ({ locals, url, cookies }) => ({
	theme: themeOf(cookies.get(THEME_COOKIE)),
	token: locals.session
		? {
				name: locals.session.meta.name,
				expiresAt: locals.session.meta.expiresAt,
				kind: locals.session.meta.kind ?? 'token',
				username: locals.session.meta.username ?? null
			}
		: null,
	insecure: url.protocol === 'http:' && !isLocalHost(url.hostname)
});
