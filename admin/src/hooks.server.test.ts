import { describe, expect, it } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import { handle } from './hooks.server.ts';
import { isPublic } from '#lib/server/guard.ts';
import { sessions } from '#lib/server/sessions.ts';

function event(url: string, cookie?: string, theme?: string): RequestEvent {
	return {
		url: new URL(url),
		cookies: { get: (name: string) => (name === 'lumi_admin' ? cookie : name === 'lumi_admin_theme' ? theme : undefined) },
		locals: {}
	} as unknown as RequestEvent;
}

describe('auth guard', () => {
	it('lets only the login, the healthcheck and static build files through without a session', () => {
		for (const p of ['/entrar', '/entrar/__data.json', '/healthz', '/_app/immutable/a.js', '/_app/version.json']) {
			expect(isPublic(p), p).toBe(true);
		}
		for (const p of ['/', '/usuarios', '/tokens', '/_app/remote/x', '/_app/env.js', '/entrar/x', '/sair']) {
			expect(isPublic(p), p).toBe(false);
		}
	});

	it('redirects to the login with no-store and the security headers', async () => {
		let resolved = false;
		const resolve = async () => {
			resolved = true;
			return new Response('page');
		};
		for (const [cookie, location] of [
			[undefined, '/entrar'],
			['stale', '/entrar?motivo=sessao']
		] as const) {
			const res = await handle({ event: event('http://localhost/usuarios', cookie), resolve });
			expect(res.status).toBe(303);
			expect(res.headers.get('Location')).toBe(location);
			expect(res.headers.get('Cache-Control')).toBe('no-store');
			expect(res.headers.get('X-Frame-Options')).toBe('DENY');
		}
		expect(resolved).toBe(false);
	});

	it('serves a page with a live session, and the healthcheck without one', async () => {
		const s = sessions.create('lpa_x', { id: 't', name: 'painel', expiresAt: Number.MAX_SAFE_INTEGER });
		const resolve = async () => new Response('page');
		const ev = event('http://localhost/usuarios', s.id);
		const res = await handle({ event: ev, resolve });
		expect(await res.text()).toBe('page');
		expect(ev.locals.session?.id).toBe(s.id);
		expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
		const health = await handle({ event: event('http://localhost/healthz'), resolve });
		expect(health.status).toBe(200);
		sessions.delete(s.id);
	});

	it('puts only a known theme on <html>, from the cookie', async () => {
		const s = sessions.create('lpa_x', { id: 't', name: 'painel', expiresAt: Number.MAX_SAFE_INTEGER });
		const html = '<html data-theme="%lumi.theme%">';
		const resolve = async (_e: unknown, opts?: { transformPageChunk?: (i: { html: string; done: boolean }) => string }) =>
			new Response(opts?.transformPageChunk?.({ html, done: true }) ?? html);
		for (const [cookie, want] of [['light', 'light'], ['"><script>', 'auto'], [undefined, 'auto']] as const) {
			const res = await handle({ event: event('http://localhost/', s.id, cookie), resolve: resolve as never });
			expect(await res.text()).toBe(`<html data-theme="${want}">`);
		}
		sessions.delete(s.id);
	});
});
