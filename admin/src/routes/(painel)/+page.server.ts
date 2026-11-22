import { read, readOptional } from '#lib/server/api.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	event.depends('admin:overview');
	const [status, recent, failures, locked, vaults] = await Promise.all([
		read(event, (api) => api.status()),
		readOptional(event, (api) => api.audit({ limit: 8 })),
		readOptional(event, (api) => api.audit({ action: 'auth.login_failed', limit: 5 })),
		readOptional(event, (api) => api.users({ state: 'locked', limit: 10 })),
		readOptional(event, (api) => api.vaults({ limit: 200 }))
	]);
	const top = vaults
		? [...vaults.items]
				.sort((a, b) => b.crdtBytes - a.crdtBytes || b.notes - a.notes)
				.slice(0, 6)
				.map((v) => ({ id: v.id, slug: v.slug, name: v.name, notes: v.notes, crdtBytes: v.crdtBytes, lastChangeAt: v.lastChangeAt }))
		: null;
	return {
		status,
		recent: recent?.entries ?? null,
		failures: failures?.entries ?? null,
		locked: locked?.items.map((u) => ({ id: u.id, username: u.username, lockedUntil: u.lockedUntil, failedLogins: u.failedLogins })) ?? null,
		top,
		topPartial: vaults?.more ?? false,
		fetchedAt: Date.now()
	};
};
