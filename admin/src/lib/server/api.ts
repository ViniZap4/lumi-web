import { LUMI_ADMIN_API_URL } from '$app/env/private';
import { type ActionFailure, type Cookies, error as httpError, fail, redirect } from '@sveltejs/kit';
import { AdminClient, AdminError, type AdminErrorKind, adminErrorMessage } from '../admin.ts';
import { type PanelSession, cookieName, cookieOptions, sessions } from './sessions.ts';

/** The person's address goes along, so the API's audit and failure budget are theirs, not the panel's. */
export function clientFor(token: string, address?: string): AdminClient {
	return new AdminClient(LUMI_ADMIN_API_URL, token, { forwardedFor: address });
}

export interface Context {
	locals: App.Locals;
	cookies: Cookies;
	url: URL;
	getClientAddress: () => string;
}

export function addressOf(event: Pick<Context, 'getClientAddress'>): string | undefined {
	try {
		return event.getClientAddress();
	} catch {
		return undefined;
	}
}

function requireSession(event: Context): PanelSession {
	if (!event.locals.session) redirect(303, '/entrar?motivo=sessao');
	return event.locals.session;
}

/**
 * The token stopped working (revoked or expired): the panel session goes with it on the very first 401, so a dead
 * token is never retried.
 */
export function signOut(event: Context, session: PanelSession, reason = 'token'): never {
	sessions.delete(session.id);
	event.cookies.delete(cookieName(event.url), cookieOptions(event.url));
	event.locals.session = null;
	redirect(303, `/entrar?motivo=${reason}`);
}

/** Runs a read for a `load`; an API failure becomes the error page, a dead token a new login. */
export async function read<T>(event: Context, run: (api: AdminClient) => Promise<T>): Promise<T> {
	const session = requireSession(event);
	try {
		return await run(clientFor(session.token, addressOf(event)));
	} catch (error) {
		if (!(error instanceof AdminError)) throw error;
		if (error.kind === 'unauthorized') signOut(event, session);
		const status =
			error.kind === 'notFound' ? 404 : error.kind === 'invalid' ? 400 : error.kind === 'offline' ? 503 : 502;
		httpError(status, adminErrorMessage(error));
	}
}

export type Failure = { ok: false; message: string; [key: string]: unknown };
export type ActResult = { ok: true; message: string } | ActionFailure<Failure>;

/**
 * Runs a change for an action. Success and failure both carry a Portuguese message; failures keep the API's status,
 * so a form without JavaScript shows the error too.
 */
export async function act(
	event: Context,
	success: string,
	run: (api: AdminClient) => Promise<unknown>,
	overrides: Partial<Record<AdminErrorKind, string>> = {},
	onError?: (error: AdminError) => Promise<ActionFailure<Failure> | undefined> | ActionFailure<Failure> | undefined
): Promise<ActResult> {
	const session = requireSession(event);
	try {
		await run(clientFor(session.token, addressOf(event)));
		return { ok: true, message: success };
	} catch (error) {
		if (!(error instanceof AdminError)) throw error;
		if (error.kind === 'unauthorized') signOut(event, session);
		const custom = await onError?.(error);
		if (custom) return custom;
		const status = error.status && error.status >= 400 && error.status < 600 ? error.status : 502;
		return fail(status, { ok: false, message: adminErrorMessage(error, overrides) });
	}
}

export function invalid(message: string, extra: Record<string, unknown> = {}): ActionFailure<Failure> {
	return fail(400, { ok: false, message, ...extra });
}

export function field(data: FormData, name: string): string {
	const value = data.get(name);
	return typeof value === 'string' ? value : '';
}
