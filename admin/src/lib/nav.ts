export interface NavItem {
	readonly href: string;
	readonly label: string;
	/** Second key of the "g <key>" shortcut. */
	readonly key: string;
}

export const NAV: readonly NavItem[] = [
	{ href: '/', label: 'Visão geral', key: 'i' },
	{ href: '/usuarios', label: 'Usuários', key: 'u' },
	{ href: '/sessoes', label: 'Sessões', key: 's' },
	{ href: '/cofres', label: 'Cofres', key: 'c' },
	{ href: '/federacoes', label: 'Federações', key: 'f' },
	{ href: '/tokens', label: 'Tokens', key: 't' },
	{ href: '/auditoria', label: 'Auditoria', key: 'a' }
];

/** Whether a key press belongs to a text field (shortcuts never steal typing). */
export function isTyping(target: EventTarget | null): boolean {
	if (!target || typeof (target as Element).closest !== 'function') return false;
	const el = target as HTMLElement;
	return !!el.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], dialog[open]');
}

/**
 * "g" then a letter, within a second, like the lumi client's leader keys. Returns the href to visit, or null.
 * Stateful: feed it every keydown.
 */
export class GoShortcut {
	#armedAt = -Infinity;
	constructor(
		readonly items: readonly NavItem[] = NAV,
		readonly windowMs = 1000,
		readonly now: () => number = Date.now
	) {}

	press(key: string, mods: { ctrl?: boolean; meta?: boolean; alt?: boolean } = {}): string | null {
		if (mods.ctrl || mods.meta || mods.alt) {
			this.#armedAt = -Infinity;
			return null;
		}
		const t = this.now();
		if (t - this.#armedAt <= this.windowMs) {
			this.#armedAt = -Infinity;
			return this.items.find((i) => i.key === key.toLowerCase())?.href ?? null;
		}
		if (key === 'g') this.#armedAt = t;
		return null;
	}
}

export function isCurrent(href: string, pathname: string): boolean {
	return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
}
