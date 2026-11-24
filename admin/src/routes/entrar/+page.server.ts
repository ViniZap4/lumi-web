import { fail, redirect } from '@sveltejs/kit';
import { AdminError, adminErrorMessage } from '#lib/admin.ts';
import { addressOf, field } from '#lib/server/api.ts';
import { startPasswordSession, startSession } from '#lib/server/auth.ts';
import { TOKEN_RE } from '#lib/server/guard.ts';
import { loginThrottle } from '#lib/server/sessions.ts';
import type { Actions, PageServerLoad } from './$types';

const reasons: Record<string, string> = {
	sessao: 'Sua sessão no painel terminou. Entre de novo.',
	token: 'O acesso deixou de valer (expirou, foi revogado ou a conta perdeu a permissão). Entre de novo.',
	saiu: 'Você saiu do painel.'
};

export type Tab = 'usuario' | 'token';

function tabOf(raw: string | null): Tab {
	return raw === 'token' ? 'token' : 'usuario';
}

export const load: PageServerLoad = ({ locals, url }) => {
	if (locals.session) redirect(303, '/');
	const reason = url.searchParams.get('motivo');
	return { reason: reason ? (reasons[reason] ?? null) : null, tab: tabOf(url.searchParams.get('aba')) };
};

/** One generic answer for every refused password login: never whether the user exists, is locked or isn't admin. */
const BAD_LOGIN = 'Usuário ou senha inválidos, ou a conta não é administradora do servidor.';

/**
 * The registration rules of lumi-server (auth.CanonicaliseUsername: lower-case letters, digits, _ and -, no separator
 * at the ends, 3 to 32 bytes), so a typo never reaches the API.
 */
function canonicalUsername(raw: string): string | null {
	const u = raw.trim().toLowerCase();
	const bytes = new TextEncoder().encode(u).length;
	if (bytes < 3 || bytes > 32) return null;
	return /^[\p{Ll}\p{Nd}](?:[\p{Ll}\p{Nd}_-]*[\p{Ll}\p{Nd}])?$/u.test(u) ? u : null;
}

function wait(keys: string[]): number {
	return Math.max(0, ...keys.map((k) => loginThrottle.retryAfter(k)));
}

export const actions: Actions = {
	/** Username + password of a server admin (SPEC-PARTE2 §10): the API mints an lps_ session the panel keeps. */
	usuario: async (event) => {
		const ip = addressOf(event) ?? 'unknown';
		const data = await event.request.formData();
		const typed = field(data, 'username');
		const password = field(data, 'password');
		const username = canonicalUsername(typed);
		const keys = username ? [ip, `user:${username}`] : [ip];
		const left = wait(keys);
		const keep = { tab: 'usuario' as const, username: typed.trim().slice(0, 64) };
		if (left > 0) return fail(429, { ...keep, message: `Muitas tentativas. Tente de novo em ${left} s.` });
		// Same answer as a refusal from the API (and counted the same), so the form reveals nothing either.
		if (!username || password === '' || new TextEncoder().encode(password).length > 72) {
			loginThrottle.fail(ip);
			return fail(401, { ...keep, message: BAD_LOGIN });
		}
		try {
			await startPasswordSession(event, username, password, addressOf(event));
		} catch (error) {
			if (error instanceof AdminError && error.kind === 'unauthorized') {
				for (const k of keys) loginThrottle.fail(k);
				return fail(401, { ...keep, message: BAD_LOGIN });
			}
			const status = error instanceof AdminError && error.kind === 'rateLimited' ? 429 : 502;
			return fail(status, { ...keep, message: adminErrorMessage(error) });
		}
		for (const k of keys) loginThrottle.succeed(k);
		redirect(303, '/');
	},

	/** An lpa_ token made in the terminal (`lumi-server token create`). */
	token: async (event) => {
		const ip = addressOf(event) ?? 'unknown';
		const keep = { tab: 'token' as const };
		const left = loginThrottle.retryAfter(ip);
		if (left > 0) return fail(429, { ...keep, message: `Muitas tentativas. Tente de novo em ${left} s.` });
		const token = field(await event.request.formData(), 'token').trim();
		// A malformed token never reaches the API, so it costs nothing and isn't counted.
		if (!TOKEN_RE.test(token)) {
			return fail(400, {
				...keep,
				message: 'Isso não parece um token de administração do lumi (lpa_…, 47 caracteres).'
			});
		}
		try {
			await startSession(event, token, addressOf(event));
		} catch (error) {
			if (error instanceof AdminError && error.kind === 'unauthorized') {
				loginThrottle.fail(ip);
				return fail(401, { ...keep, message: 'Token inválido, expirado ou revogado.' });
			}
			const status = error instanceof AdminError && error.kind === 'rateLimited' ? 429 : 502;
			return fail(status, { ...keep, message: adminErrorMessage(error) });
		}
		loginThrottle.succeed(ip);
		redirect(303, '/');
	}
};
