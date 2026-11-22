import { type AdminClient, type AuditQuery, isUUID } from '../admin.ts';
import type { ParsedAuditFilters } from '../audit.ts';

export interface ResolvedFilters {
	query: AuditQuery;
	/** Names shown next to the filters (the username or slug the id belongs to). */
	userLabel: string | null;
	vaultLabel: string | null;
	/** A username or slug that matched nothing: the log would be empty, so the API isn't asked. */
	unknown: string[];
}

/**
 * Turns the page filters into an API query. A username or slug becomes its id through the search routes (exact
 * match only); an id is used as is and named when the lookup finds it.
 */
export async function resolveFilters(api: AdminClient, f: ParsedAuditFilters): Promise<ResolvedFilters> {
	const unknown: string[] = [];
	let user: string | undefined;
	let userLabel: string | null = null;
	if (f.user) {
		if (isUUID(f.user)) {
			user = f.user;
			userLabel = await api.user(f.user).then((u) => u.username, () => null);
		} else {
			const page = await api.users({ q: f.user, limit: 200 });
			const hit = page.items.find((u) => u.username === f.user);
			if (hit) {
				user = hit.id;
				userLabel = hit.username;
			} else unknown.push('usuario');
		}
	}
	let vault: string | undefined;
	let vaultLabel: string | null = null;
	if (f.vault) {
		if (isUUID(f.vault)) {
			vault = f.vault;
			vaultLabel = await api.vault(f.vault).then((v) => v.slug, () => null);
		} else {
			const page = await api.vaults({ q: f.vault, limit: 200 });
			const hit = page.items.find((v) => v.slug === f.vault);
			if (hit) {
				vault = hit.id;
				vaultLabel = hit.slug;
			} else unknown.push('cofre');
		}
	}
	return {
		query: {
			scope: f.scope,
			user,
			vault,
			action: f.action || undefined,
			since: f.since,
			until: f.until
		},
		userLabel,
		vaultLabel,
		unknown
	};
}
