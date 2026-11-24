import type { Cookies } from '@sveltejs/kit';
import { LUMI_ADMIN_API_URL } from '$app/env/private';
import { AdminClient, type TokenRef } from '../admin.ts';
import { clientFor } from './api.ts';
import { type PanelSession, cookieName, cookieOptions, sessions, tokenMeta } from './sessions.ts';

function begin(event: { cookies: Cookies; url: URL }, token: string, ref: TokenRef): PanelSession {
	const session = sessions.create(token, tokenMeta(ref));
	event.cookies.set(cookieName(event.url), session.id, {
		...cookieOptions(event.url),
		maxAge: Math.max(1, Math.floor((session.expiresAt - Date.now()) / 1000))
	});
	return session;
}

/** A panel session for a token that just worked: the API says what it is (id, name, expiry). */
export async function startSession(
	event: { cookies: Cookies; url: URL },
	token: string,
	address: string | undefined
): Promise<PanelSession> {
	const status = await clientFor(token, address).status();
	return begin(event, token, status.token);
}

/**
 * A panel session from a server admin's username + password (POST /admin/v1/session). The lps_ token it returns
 * stays in this process's memory like an lpa_ token; the browser gets only the random cookie id.
 */
export async function startPasswordSession(
	event: { cookies: Cookies; url: URL },
	username: string,
	password: string,
	address: string | undefined
): Promise<PanelSession> {
	const login = await new AdminClient(LUMI_ADMIN_API_URL, '', { forwardedFor: address }).login(username, password);
	return begin(event, login.token, login.ref);
}
