import { describe, expect, it } from 'vitest';
import { LoginThrottle, SESSION_TTL_MS, SessionStore, cookieName, cookieOptions, randomId } from './sessions.ts';

const meta = (expiresAt = Number.MAX_SAFE_INTEGER) => ({ id: 't1', name: 'painel', expiresAt });

describe('session store', () => {
	it('creates 256-bit random ids', () => {
		const a = randomId();
		expect(Buffer.from(a, 'base64url')).toHaveLength(32);
		expect(randomId()).not.toBe(a);
	});

	it('keeps a session 12 hours, not sliding, and never past the token', () => {
		let now = 1_000;
		const store = new SessionStore(() => now);
		const s = store.create('lpa_x', meta());
		expect(s.expiresAt).toBe(1_000 + SESSION_TTL_MS);
		now += SESSION_TTL_MS - 1;
		expect(store.get(s.id)?.token).toBe('lpa_x');
		now += 1;
		expect(store.get(s.id)).toBeNull();
		const short = store.create('lpa_y', meta(now + 60_000));
		expect(short.expiresAt).toBe(now + 60_000);
	});

	it('ignores unknown ids and drops every session of a revoked token', () => {
		const store = new SessionStore();
		const a = store.create('lpa_a', meta());
		const b = store.create('lpa_b', { ...meta(), id: 't2' });
		expect(store.get(undefined)).toBeNull();
		expect(store.get('short')).toBeNull();
		expect(store.get(randomId())).toBeNull();
		store.deleteToken('t1');
		expect(store.get(a.id)).toBeNull();
		expect(store.get(b.id)).not.toBeNull();
	});
});

describe('login throttle', () => {
	it('backs off after the free failures and forgets after a success', () => {
		let now = 0;
		const t = new LoginThrottle(3, 8_000, 60_000, 100, () => now);
		t.fail('ip');
		t.fail('ip');
		expect(t.retryAfter('ip')).toBe(0);
		t.fail('ip');
		expect(t.retryAfter('ip')).toBe(1);
		now = 1_000;
		t.fail('ip');
		expect(t.retryAfter('ip')).toBe(2);
		t.succeed('ip');
		expect(t.retryAfter('ip')).toBe(0);
	});
});

describe('cookie', () => {
	it('is HttpOnly, SameSite=Strict, Secure and __Host- outside localhost', () => {
		const remote = new URL('https://lumi-admin.tail1234.ts.net/');
		expect(cookieOptions(remote)).toMatchObject({ httpOnly: true, sameSite: 'strict', path: '/', secure: true });
		expect(cookieName(remote)).toBe('__Host-lumi_admin');
		const local = new URL('http://localhost:5174/');
		expect(cookieOptions(local).secure).toBe(false);
		expect(cookieName(local)).toBe('lumi_admin');
	});
});
