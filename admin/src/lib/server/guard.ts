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

/** The token format of lumi-server (internal/admin/token.go): lpa_ + base64url of 32 bytes. */
export const TOKEN_RE = /^lpa_[A-Za-z0-9_-]{43}$/;
