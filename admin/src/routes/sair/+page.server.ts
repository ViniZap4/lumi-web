import { redirect } from '@sveltejs/kit';
import { addressOf, clientFor } from '#lib/server/api.ts';
import { cookieName, cookieOptions, sessions } from '#lib/server/sessions.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = () => redirect(303, '/');

/**
 * Ends the panel session. A username + password login (an lps_ session) is also revoked on the server, so the
 * token is dead even if this process's memory leaked. An lpa_ token is a terminal token that scripts may use too:
 * it stays valid until it expires or is revoked (the tokens page or `lumi-server token revoke`).
 */
export const actions: Actions = {
	default: async (event) => {
		const { cookies, locals, url } = event;
		const session = locals.session;
		if (session?.meta.kind === 'session') {
			// Best effort: an already dead session (401) or an API outage still signs out of the panel; the
			// session then simply expires on the server (at most 12 h).
			await clientFor(session.token, addressOf(event))
				.logout()
				.catch(() => undefined);
		}
		sessions.delete(session?.id);
		locals.session = null;
		cookies.delete(cookieName(url), cookieOptions(url));
		redirect(303, '/entrar?motivo=saiu');
	}
};
