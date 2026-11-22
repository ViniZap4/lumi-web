import type { Handle } from '@sveltejs/kit/hooks';
import { isPublic } from '#lib/server/guard.ts';
import { cookieName, sessions } from '#lib/server/sessions.ts';

const SECURITY_HEADERS: Record<string, string> = {
	'X-Content-Type-Options': 'nosniff',
	'X-Frame-Options': 'DENY',
	// Not no-referrer: with it browsers send `Origin: null` on form posts, and Kit's CSRF check refuses them.
	'Referrer-Policy': 'same-origin',
	'Cross-Origin-Opener-Policy': 'same-origin',
	'Cross-Origin-Resource-Policy': 'same-origin',
	'Permissions-Policy':
		'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), hid=(), midi=(), display-capture=(), browsing-topics=()',
	// Every page shows server state behind a token: nothing goes to a cache.
	'Cache-Control': 'no-store'
};

function secure(response: Response): Response {
	for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.headers.set(name, value);
	return response;
}

// Built here instead of thrown, so the redirect carries no-store and the security headers too.
function seeOther(location: string): Response {
	return secure(new Response(null, { status: 303, headers: { Location: location } }));
}

export const handle: Handle = async ({ event, resolve }) => {
	if (event.url.pathname === '/healthz') {
		return secure(new Response('ok\n', { headers: { 'Content-Type': 'text/plain' } }));
	}
	const cookie = event.cookies.get(cookieName(event.url));
	event.locals.session = sessions.get(cookie);
	if (!event.locals.session && !isPublic(event.url.pathname)) {
		return seeOther(cookie ? '/entrar?motivo=sessao' : '/entrar');
	}
	return secure(await resolve(event));
};
