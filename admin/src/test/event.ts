import { sessions, type PanelSession } from '#lib/server/sessions.ts';
import { TOKEN, TOKEN_ID } from './fake-api.ts';

export interface FakeCookies {
	jar: Map<string, { value: string; options: Record<string, unknown> }>;
	deleted: string[];
	get(name: string): string | undefined;
	set(name: string, value: string, options: Record<string, unknown>): void;
	delete(name: string, options: Record<string, unknown>): void;
}

export function cookies(): FakeCookies {
	const jar = new Map<string, { value: string; options: Record<string, unknown> }>();
	const deleted: string[] = [];
	return {
		jar,
		deleted,
		get: (n) => jar.get(n)?.value,
		set: (n, value, options) => void jar.set(n, { value, options }),
		delete: (n) => {
			jar.delete(n);
			deleted.push(n);
		}
	};
}

export function liveSession(): PanelSession {
	return sessions.create(TOKEN, { id: TOKEN_ID, name: 'painel', expiresAt: Number.MAX_SAFE_INTEGER });
}

/** A request event for an action or load: form fields become the request body. */
export function actionEvent(opts: {
	path: string;
	params?: Record<string, string>;
	form?: Record<string, string>;
	session?: PanelSession | null;
	ip?: string;
}) {
	const body = new URLSearchParams(opts.form ?? {});
	return {
		url: new URL(`https://lumi-admin.tail1234.ts.net${opts.path}`),
		params: opts.params ?? {},
		request: new Request(`https://lumi-admin.tail1234.ts.net${opts.path}`, { method: 'POST', body }),
		locals: { session: opts.session === undefined ? liveSession() : opts.session },
		cookies: cookies(),
		getClientAddress: () => opts.ip ?? '100.64.0.7'
	};
}

/** Runs something that may throw a Kit redirect, and returns it instead. */
export async function outcome<T>(run: () => Promise<T> | T): Promise<{ value?: T; redirect?: { status: number; location: string }; error?: { status: number; body: unknown } }> {
	try {
		return { value: await run() };
	} catch (e) {
		const o = e as Record<string, unknown>;
		if (typeof o?.location === 'string') return { redirect: { status: o.status as number, location: o.location } };
		if (typeof o?.status === 'number' && 'body' in o) return { error: { status: o.status, body: o.body } };
		throw e;
	}
}
