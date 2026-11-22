import { redirect } from '@sveltejs/kit';
import { cookieName, cookieOptions, sessions } from '#lib/server/sessions.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = () => redirect(303, '/');

// Ends the panel session only: the token is a terminal token that scripts may use too, so it stays valid until it
// expires or is revoked (the tokens page or `lumi-server token revoke`).
export const actions: Actions = {
	default: ({ cookies, locals, url }) => {
		sessions.delete(locals.session?.id);
		locals.session = null;
		cookies.delete(cookieName(url), cookieOptions(url));
		redirect(303, '/entrar?motivo=saiu');
	}
};
