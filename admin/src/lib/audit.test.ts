import { describe, expect, it } from 'vitest';
import { csvCell, csvRow, filterQuery, filtersOf } from './audit.ts';
import { passwordProblem } from './rules.ts';
import { generatePassword } from './server/password.ts';
import { backTo, themeOf } from './theme.ts';

const url = (q: string) => new URL(`http://x/auditoria?${q}`);

describe('audit filters', () => {
	it('accepts a username or slug, to be resolved later', () => {
		expect(filtersOf(url('usuario=Ana&cofre=diario'))).toMatchObject({ user: 'ana', vault: 'diario', invalid: [] });
	});

	it('takes exact actions and prefix groups, nothing else', () => {
		expect(filtersOf(url('acao=auth.login_failed')).action).toBe('auth.login_failed');
		expect(filtersOf(url('acao=admin.*')).action).toBe('admin.*');
		for (const bad of ['auth.%', 'Auth.login', "x'; drop", 'a.*.b', '*']) {
			const f = filtersOf(url(`acao=${encodeURIComponent(bad)}`));
			expect(f.action, bad).toBe('');
			expect(f.invalid, bad).toEqual(['acao']);
		}
	});

	it('turns days into a Brasília-time range with an inclusive end', () => {
		const f = filtersOf(url('de=2026-11-01&ate=2026-11-30'));
		expect(f.since).toBe('2026-11-01T00:00:00-03:00');
		expect(f.until).toBe('2026-12-01T00:00:00-03:00');
		expect(filtersOf(url('de=2026-02-30')).invalid).toEqual(['de']);
		expect(filtersOf(url('de=2026-11-10&ate=2026-11-01'))).toMatchObject({ from: '2026-11-10', to: '', invalid: ['ate'] });
	});

	it('round-trips the filters into a query string without the cursor', () => {
		const f = filtersOf(url('escopo=admin&acao=auth.*&de=2026-11-01&antes=9'));
		expect(new URLSearchParams(filterQuery(f)).toString()).toBe(
			new URLSearchParams({ escopo: 'admin', acao: 'auth.*', de: '2026-11-01' }).toString()
		);
	});
});

describe('csv', () => {
	it('quotes every cell and defuses spreadsheet formulas', () => {
		expect(csvCell('ana')).toBe('"ana"');
		expect(csvCell('a "b"')).toBe('"a ""b"""');
		expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
		for (const lead of ['+', '-', '@', '\t', '\r']) expect(csvCell(`${lead}1`).startsWith(`"'`)).toBe(true);
		expect(csvCell(null)).toBe('""');
		expect(csvCell(42)).toBe('"42"');
	});

	it('writes one row per entry, with the label and the payload as JSON', () => {
		const row = csvRow({
			id: 7,
			createdAt: '2026-11-01T10:00:00Z',
			action: 'auth.login_failed',
			userId: null,
			vaultId: null,
			ip: '1.2.3.4',
			userAgent: '=cmd',
			payload: { reason: 'bad' }
		});
		expect(row).toBe(
			`"7","2026-11-01T10:00:00Z","auth.login_failed","Falha de login","","","1.2.3.4","'=cmd","{""reason"":""bad""}"`
		);
	});
});

describe('generated passwords', () => {
	it('always fit the server rules and do not repeat', () => {
		const seen = new Set<string>();
		for (let i = 0; i < 200; i++) {
			const pw = generatePassword();
			expect(pw).toMatch(/^[A-Za-z2-9]{5}(-[A-Za-z2-9]{5}){3}$/);
			expect(passwordProblem(pw)).toBeNull();
			seen.add(pw);
		}
		expect(seen.size).toBe(200);
	});
});

describe('theme', () => {
	it('keeps only known values and paths of this panel', () => {
		expect(themeOf('dark')).toBe('dark');
		expect(themeOf('light')).toBe('light');
		expect(themeOf('"><script>')).toBe('auto');
		expect(themeOf(undefined)).toBe('auto');
		expect(backTo('/usuarios?estado=locked')).toBe('/usuarios?estado=locked');
		for (const bad of ['//evil.example', 'https://evil.example', '/\\evil', '', null, '/a b']) {
			expect(backTo(bad), String(bad)).toBe('/');
		}
	});
});
