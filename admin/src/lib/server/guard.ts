/** The build's static files: they answer without a session, so the login page can load. */
export function isStatic(pathname: string): boolean {
	return pathname.startsWith('/_app/immutable/') || pathname === '/_app/version.json';
}

export function pagePath(pathname: string): string {
	return pathname.replace(/\/__data\.json$/, '') || '/';
}

/**
 * What a visitor without a session may reach: the login page, the container healthcheck and the build's static
 * files. Everything else (including the rest of /_app/) needs a session.
 */
export function isPublic(pathname: string): boolean {
	return pagePath(pathname) === '/entrar' || pathname === '/healthz' || isStatic(pathname);
}

/** The list cursor in ?apos=: opaque to the panel (base64url), so only its size and alphabet are checked. */
export function cursorOf(url: URL): string | undefined {
	const raw = url.searchParams.get('apos');
	return raw && /^[0-9A-Za-z_-]{1,512}$/.test(raw) ? raw : undefined;
}

/** A search box (?busca=): trimmed, at most 64 characters, no control characters; empty means no filter. */
export function searchOf(url: URL): string | undefined {
	const raw = (url.searchParams.get('busca') ?? '').trim();
	if (raw === '' || raw.length > 64 || /\p{Cc}/u.test(raw)) return undefined;
	return raw;
}

/** The token format of lumi-server (internal/admin/token.go): lpa_ + base64url of 32 bytes. */
export const TOKEN_RE = /^lpa_[A-Za-z0-9_-]{43}$/;

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Every state-changing request must come from this panel's own pages. Kit checks the Origin of form posts already;
 * this covers every other content type too, and the login (which has no session cookie yet for SameSite to guard).
 */
export function sameOrigin(request: Request, url: URL): boolean {
	if (SAFE_METHODS.has(request.method)) return true;
	return request.headers.get('origin') === url.origin;
}
