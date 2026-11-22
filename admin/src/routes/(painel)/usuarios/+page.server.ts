import { fail, redirect } from '@sveltejs/kit';
import { AdminError, type UserState, adminErrorMessage } from '#lib/admin.ts';
import { addressOf, clientFor, field, invalid, read, signOut } from '#lib/server/api.ts';
import { cursorOf, searchOf } from '#lib/server/guard.ts';
import { generatePassword } from '#lib/server/password.ts';
import { displayNameProblem, normalizeUsername, passwordProblem, usernameProblem } from '#lib/rules.ts';
import type { Actions, PageServerLoad } from './$types';

const STATES: readonly UserState[] = ['active', 'disabled', 'locked'];

export const load: PageServerLoad = async (event) => {
	const q = searchOf(event.url);
	const raw = event.url.searchParams.get('estado') ?? '';
	const state = (STATES as readonly string[]).includes(raw) ? (raw as UserState) : undefined;
	const page = await read(event, (api) => api.users({ q, state, after: cursorOf(event.url), limit: 50 }));
	const deleted = event.url.searchParams.get('apagado');
	return {
		...page,
		q: q ?? '',
		state: state ?? null,
		paged: cursorOf(event.url) !== undefined,
		deleted: deleted && /^[a-z0-9_-]{1,32}$/.test(deleted) ? deleted : null
	};
};

export const actions: Actions = {
	/**
	 * With "gerar" the panel picks a temporary password and hands it back once, in this answer only (no-store): the
	 * operator passes it on and the person changes it after signing in.
	 */
	create: async (event) => {
		const data = await event.request.formData();
		const username = normalizeUsername(field(data, 'username'));
		const displayName = field(data, 'display_name').trim();
		const generate = field(data, 'mode') === 'gerar';
		const password = generate ? generatePassword() : field(data, 'password');
		const keep = { username, display_name: displayName };
		const problem = usernameProblem(username) ?? displayNameProblem(displayName) ?? passwordProblem(password);
		if (problem) return invalid(problem, keep);
		if (!generate && password !== field(data, 'password_repeat')) return invalid('As senhas não conferem.', keep);
		const session = event.locals.session;
		if (!session) redirect(303, '/entrar?motivo=sessao');
		try {
			const user = await clientFor(session.token, addressOf(event)).createUser(username, password, displayName);
			return {
				ok: true,
				message: `Usuário “${user.username}” criado.`,
				created: { id: user.id, username: user.username },
				generated: generate ? password : null
			};
		} catch (error) {
			if (!(error instanceof AdminError)) throw error;
			if (error.kind === 'unauthorized') signOut(event, session);
			return fail(error.status && error.status < 600 ? error.status : 502, {
				ok: false,
				message: adminErrorMessage(error),
				...keep
			});
		}
	}
};
