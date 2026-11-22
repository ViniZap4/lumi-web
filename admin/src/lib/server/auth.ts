import type { Cookies } from '@sveltejs/kit';
import { clientFor } from './api.ts';
import { type PanelSession, cookieName, cookieOptions, sessions, tokenMeta } from './sessions.ts';

/** A panel session for a token that just worked: the API says what it is (id, name, expiry). */
export async function startSession(
	event: { cookies: Cookies; url: URL },
	token: string,
	address: string | undefined
): Promise<PanelSession> {
	const status = await clientFor(token, address).status();
	const session = sessions.create(token, tokenMeta(status.token));
	event.cookies.set(cookieName(event.url), session.id, {
		...cookieOptions(event.url),
		maxAge: Math.max(1, Math.floor((session.expiresAt - Date.now()) / 1000))
	});
	return session;
}
