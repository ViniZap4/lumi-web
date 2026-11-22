import { isUUID } from './admin.ts';

export interface AuditFilters {
	scope: 'all' | 'admin';
	user: string;
	vault: string;
}

/** The filters from the query string; anything malformed is dropped, so a bad link shows the unfiltered log. */
export function filtersOf(url: URL): AuditFilters & { before?: number; invalid: string[] } {
	const invalid: string[] = [];
	const q = url.searchParams;
	const scope = q.get('escopo') === 'admin' ? 'admin' : 'all';
	const uuid = (name: string) => {
		const raw = (q.get(name) ?? '').trim().toLowerCase();
		if (raw === '') return '';
		if (isUUID(raw)) return raw;
		invalid.push(name);
		return '';
	};
	const user = uuid('usuario');
	const vault = uuid('cofre');
	const n = Number(q.get('antes'));
	const before = Number.isSafeInteger(n) && n > 0 ? n : undefined;
	return { scope, user, vault, before, invalid };
}
