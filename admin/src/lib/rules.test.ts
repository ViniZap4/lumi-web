import { describe, expect, it } from 'vitest';
import { confirmed, passwordProblem, usernameProblem } from './rules.ts';
import { filtersOf } from './audit.ts';
import { GoShortcut } from './nav.ts';

describe('typed confirmation', () => {
	it('needs the exact target, ignoring only surrounding spaces', () => {
		expect(confirmed('ana', 'ana')).toBe(true);
		expect(confirmed('  ana ', 'ana')).toBe(true);
		expect(confirmed('Ana', 'ana')).toBe(false);
		expect(confirmed('an', 'ana')).toBe(false);
		expect(confirmed('', '')).toBe(false);
	});
});

describe('registration rules', () => {
	it('mirrors the server username rules', () => {
		expect(usernameProblem('ana')).toBeNull();
		expect(usernameProblem(' Ana_1 ')).toBeNull();
		expect(usernameProblem('ab')).not.toBeNull();
		expect(usernameProblem('_ana')).not.toBeNull();
		expect(usernameProblem('ana.b')).not.toBeNull();
	});
	it('mirrors the server password rules', () => {
		expect(passwordProblem('abc12345')).toBeNull();
		expect(passwordProblem('12345678')).not.toBeNull();
		expect(passwordProblem('abcdefgh')).not.toBeNull();
		expect(passwordProblem('abcdefghij')).toBeNull();
		expect(passwordProblem('a1'.repeat(37))).not.toBeNull();
	});
});

describe('audit filters', () => {
	it('keeps valid filters and drops malformed ones', () => {
		const f = filtersOf(new URL('http://x/auditoria?escopo=admin&usuario=NOPE&cofre=0A1B2C3D-4E5F-4A6B-8C7D-9E0F1A2B3C4D&antes=12'));
		expect(f).toMatchObject({ scope: 'admin', user: '', vault: '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d', before: 12, invalid: ['usuario'] });
		expect(filtersOf(new URL('http://x/auditoria?antes=-1&escopo=x'))).toMatchObject({ scope: 'all', before: undefined });
	});
});

describe('g shortcuts', () => {
	it('goes on "g" then a letter within a second', () => {
		let now = 0;
		const go = new GoShortcut(undefined, 1000, () => now);
		expect(go.press('g')).toBeNull();
		now = 500;
		expect(go.press('u')).toBe('/usuarios');
		expect(go.press('u')).toBeNull();
		go.press('g');
		now = 2000;
		expect(go.press('t')).toBeNull();
		go.press('g', { ctrl: true });
		expect(go.press('a')).toBeNull();
	});
});
