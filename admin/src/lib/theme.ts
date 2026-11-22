export type ThemeChoice = 'auto' | 'light' | 'dark';

export const THEME_COOKIE = 'lumi_admin_theme';
export const THEMES: readonly ThemeChoice[] = ['auto', 'light', 'dark'];

/** Only the three known values reach the page: the cookie is attacker-settable on a shared host, the HTML is not. */
export function themeOf(raw: string | null | undefined): ThemeChoice {
	return raw === 'light' || raw === 'dark' ? raw : 'auto';
}

/** Where to go back after the theme form posts without JavaScript: only a path of this panel, never another origin. */
export function backTo(raw: string | null): string {
	return raw && raw.length <= 512 && /^\/(?![/\\])[^\s\\]*$/.test(raw) ? raw : '/';
}
