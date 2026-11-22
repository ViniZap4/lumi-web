import { redirect } from '@sveltejs/kit';
import { isLocalHost } from '#lib/server/sessions.ts';
import { THEME_COOKIE, backTo, themeOf } from '#lib/theme.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = () => redirect(303, '/');

export const actions: Actions = {
	default: async ({ request, cookies, url }) => {
		const data = await request.formData();
		const raw = data.get('tema');
		const theme = themeOf(typeof raw === 'string' ? raw : null);
		cookies.set(THEME_COOKIE, theme, {
			path: '/',
			httpOnly: true,
			sameSite: 'strict',
			secure: !isLocalHost(url.hostname),
			maxAge: 365 * 24 * 3600
		});
		const back = data.get('voltar');
		redirect(303, backTo(typeof back === 'string' ? back : null));
	}
};
