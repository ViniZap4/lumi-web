import { fail, redirect } from '@sveltejs/kit';
import { AdminError, adminErrorMessage } from '#lib/admin.ts';
import { addressOf, field } from '#lib/server/api.ts';
import { startSession } from '#lib/server/auth.ts';
import { TOKEN_RE } from '#lib/server/guard.ts';
import { loginThrottle } from '#lib/server/sessions.ts';
import type { Actions, PageServerLoad } from './$types';

const reasons: Record<string, string> = {
	sessao: 'Sua sessão no painel terminou. Entre de novo.',
	token: 'O token deixou de valer (expirou ou foi revogado). Entre com outro.',
	saiu: 'Você saiu do painel.'
};

export const load: PageServerLoad = ({ locals, url }) => {
	if (locals.session) redirect(303, '/');
	const reason = url.searchParams.get('motivo');
	return { reason: reason ? (reasons[reason] ?? null) : null };
};

export const actions: Actions = {
	default: async (event) => {
		const ip = addressOf(event) ?? 'unknown';
		const wait = loginThrottle.retryAfter(ip);
		if (wait > 0) return fail(429, { message: `Muitas tentativas. Tente de novo em ${wait} s.` });
		const token = field(await event.request.formData(), 'token').trim();
		// A malformed token never reaches the API, so it costs nothing and isn't counted.
		if (!TOKEN_RE.test(token)) {
			return fail(400, { message: 'Isso não parece um token de administração do lumi (lpa_…, 47 caracteres).' });
		}
		try {
			await startSession(event, token, addressOf(event));
		} catch (error) {
			if (error instanceof AdminError && error.kind === 'unauthorized') {
				loginThrottle.fail(ip);
				return fail(401, { message: 'Token inválido, expirado ou revogado.' });
			}
			const status = error instanceof AdminError && error.kind === 'rateLimited' ? 429 : 502;
			return fail(status, { message: adminErrorMessage(error) });
		}
		loginThrottle.succeed(ip);
		redirect(303, '/');
	}
};
