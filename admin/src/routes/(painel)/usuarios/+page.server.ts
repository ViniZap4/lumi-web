import { fail, redirect } from '@sveltejs/kit';
import { AdminError, type AdminUser, adminErrorMessage } from '#lib/admin.ts';
import { addressOf, clientFor, field, invalid, read, signOut } from '#lib/server/api.ts';
import { cursorOf } from '#lib/server/guard.ts';
import { displayNameProblem, normalizeUsername, passwordProblem, usernameProblem } from '#lib/rules.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const page = await read(event, (api) => api.users({ after: cursorOf(event.url), limit: 50 }));
	const deleted = event.url.searchParams.get('apagado');
	return { ...page, deleted: deleted && /^[a-z0-9_-]{1,32}$/.test(deleted) ? deleted : null };
};

export const actions: Actions = {
	create: async (event) => {
		const data = await event.request.formData();
		const username = normalizeUsername(field(data, 'username'));
		const displayName = field(data, 'display_name').trim();
		const password = field(data, 'password');
		const repeat = field(data, 'password_repeat');
		const keep = { username, display_name: displayName };
		const problem = usernameProblem(username) ?? displayNameProblem(displayName) ?? passwordProblem(password);
		if (problem) return invalid(problem, keep);
		if (password !== repeat) return invalid('As senhas não conferem.', keep);
		const session = event.locals.session;
		if (!session) redirect(303, '/entrar?motivo=sessao');
		let user: AdminUser;
		try {
			user = await clientFor(session.token, addressOf(event)).createUser(username, password, displayName);
		} catch (error) {
			if (!(error instanceof AdminError)) throw error;
			if (error.kind === 'unauthorized') signOut(event, session);
			return fail(error.status && error.status < 600 ? error.status : 502, {
				ok: false,
				message: adminErrorMessage(error),
				...keep
			});
		}
		redirect(303, `/usuarios/${user.id}?criado=1`);
	}
};
